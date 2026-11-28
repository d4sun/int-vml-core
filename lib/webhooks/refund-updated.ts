import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { audit } from "@/lib/services/audit"
import { restockItem } from "@/lib/services/restock"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"
import type { StripeEventHandler } from "@/lib/webhooks/stripe"

/** The parts of Stripe's Refund this handler reads. */
const refundSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullish(),
  amount: z.number().int().nonnegative(),
  metadata: z.object({ refundId: z.string().min(1).optional() }).nullish(),
})

/**
 * `refund.updated` (E10-S1-03): Stripe tells us a refund succeeded or failed.
 * The webhook decides the outcome (CR-4), not the request that asked for it.
 *
 * Runs inside the event's own transaction, so a repeat is recorded once.
 *
 * - `succeeded`: the refund becomes succeeded. A refund is `REFUNDED` once the
 *   refunds on its item cover its subtotal, and the booking becomes
 *   `REFUNDED` when every item is, or `PARTIALLY_REFUNDED` otherwise.
 * - `failed` or `canceled`: a pending refund becomes failed, which frees its
 *   amount. A refund that already succeeded is never changed back.
 * - Other statuses (pending, requires_action) change nothing.
 * - An amount other than the one we asked for is recorded and not applied.
 * - A refund we have no record of is an error, so Stripe retries once our
 *   write has committed (the refund id is saved just after Stripe answers).
 *
 * A refunded item gives its places back to its slot, once (E10-S1-05).
 */
export const handleRefundUpdated: StripeEventHandler = (event, tx) =>
  applyRefundUpdate(event, tx)

async function applyRefundUpdate(
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient
): Promise<void> {
  const refund = refundSchema.parse(event.data.object)

  const row = await tx.refund.findFirst({
    where: {
      OR: [
        { stripeRefundId: refund.id },
        ...(refund.metadata?.refundId
          ? [{ id: refund.metadata.refundId }]
          : []),
      ],
    },
    select: { id: true, amount: true, status: true, bookingItemId: true },
  })

  if (!row) {
    throw new Error(`refund ${refund.id} is not one we recorded`)
  }

  if (refund.amount !== row.amount) {
    await audit.record(tx, {
      actorId: null,
      action: "refund.amount_mismatch",
      entityType: "Refund",
      entityId: row.id,
      meta: {
        stripeRefundId: refund.id,
        expected: row.amount,
        got: refund.amount,
      },
    })

    return
  }

  if (refund.status === "succeeded") {
    if (row.status === "succeeded") return

    if (row.status !== "pending") return

    await tx.refund.update({
      where: { id: row.id },
      data: { status: "succeeded", stripeRefundId: refund.id },
    })

    await audit.record(tx, {
      actorId: null,
      action: "refund.succeeded",
      entityType: "Refund",
      entityId: row.id,
      meta: { stripeRefundId: refund.id, amount: row.amount },
    })

    await settleItemAndBooking(tx, row.bookingItemId)

    return
  }

  if (refund.status === "failed" || refund.status === "canceled") {
    if (row.status !== "pending") return

    await tx.refund.update({
      where: { id: row.id },
      data: { status: "failed", stripeRefundId: refund.id },
    })

    await audit.record(tx, {
      actorId: null,
      action: "refund.failed",
      entityType: "Refund",
      entityId: row.id,
      meta: { stripeRefundId: refund.id, status: refund.status },
    })
  }
}

/** Moves the item to REFUNDED once its succeeded refunds cover it, then the booking. */
async function settleItemAndBooking(
  tx: Prisma.TransactionClient,
  bookingItemId: string
): Promise<void> {
  const item = await tx.bookingItem.findUniqueOrThrow({
    where: { id: bookingItemId },
    select: {
      id: true,
      status: true,
      subtotal: true,
      bookingId: true,
      refunds: { select: { amount: true, status: true } },
    },
  })

  const refunded = item.refunds
    .filter((r) => r.status === "succeeded")
    .reduce((sum, r) => sum + r.amount, 0)

  if (refunded >= item.subtotal && item.status !== "REFUNDED") {
    await tx.bookingItem.update({
      where: { id: item.id },
      data: { status: "REFUNDED" },
    })

    // Once per item: the places come back only in the write that marks it REFUNDED.
    await restockItem(tx, item.id)
  }

  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: item.bookingId },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          status: true,
          refunds: { select: { status: true } },
        },
      },
    },
  })

  const everyItemRefunded = booking.items.every((i) => i.status === "REFUNDED")
  const anyRefund = booking.items.some((i) =>
    i.refunds.some((r) => r.status === "succeeded")
  )

  if (everyItemRefunded && booking.status !== "REFUNDED") {
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: "REFUNDED" },
    })
  } else if (
    !everyItemRefunded &&
    anyRefund &&
    booking.status === "CONFIRMED"
  ) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: "PARTIALLY_REFUNDED" },
    })
  }
}
