import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { refundIssuedEmail, refundReversalEmail } from "@/lib/email/templates"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { EmailMessage } from "@/lib/email/types"
import { deterministicUuid } from "@/lib/jobs/deterministic-id"
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

export type RefundUpdatedDeps = {
  /** The queue the refund emails go to; defaults to the app's transactional queue. */
  emailQueue?: TransactionalEmailQueue
  /** Public origin for email links; defaults to `BETTER_AUTH_URL`. */
  appUrl?: string
}

/**
 * `refund.updated` (E10-S1-03): Stripe tells us a refund succeeded or failed.
 * The webhook decides the outcome (CR-4), not the request that asked for it.
 *
 * Runs inside the event's own transaction, so a repeat is recorded once.
 *
 * - `succeeded`: the refund becomes succeeded. A refund is `REFUNDED` once the
 *   refunds on its item cover its subtotal, and the booking becomes
 *   `REFUNDED` when every item is, or `PARTIALLY_REFUNDED` otherwise. The
 *   visitor and each vendor owner get an email, queued in this transaction
 *   (E10-S1-06, CR-7).
 * - `failed` or `canceled`: a pending refund becomes failed, which frees its
 *   amount. A refund that already succeeded is never changed back.
 * - Other statuses (pending, requires_action) change nothing.
 * - An amount other than the one we asked for is recorded and not applied.
 * - A refund we have no record of is an error, so Stripe retries once our
 *   write has committed (the refund id is saved just after Stripe answers).
 * - A refunded item gives its places back to its slot, once (E10-S1-05).
 */
export function refundUpdatedHandler(
  deps: RefundUpdatedDeps = {}
): StripeEventHandler {
  return (event, tx) => applyRefundUpdate(event, tx, deps)
}

/** The handler as registered in the webhook table. */
export const handleRefundUpdated: StripeEventHandler = (event, tx) =>
  applyRefundUpdate(event, tx, {})

async function applyRefundUpdate(
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient,
  deps: RefundUpdatedDeps
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
    await queueRefundEmails(tx, row.id, deps)

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

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

const bookingRef = (bookingId: string) => bookingId.slice(0, 8).toUpperCase()

/**
 * The visitor's refund email, and one reversal notice per vendor owner of the
 * refunded item (E10-S1-06). Queued in this transaction (CR-7); each has a
 * deterministic id, so a repeated event cannot send it twice.
 */
async function queueRefundEmails(
  tx: Prisma.TransactionClient,
  refundId: string,
  deps: RefundUpdatedDeps
): Promise<void> {
  const queue =
    deps.emailQueue ??
    (await (
      await import("@/lib/jobs/transactional")
    ).getTransactionalEmailQueue())
  const appUrl = (
    deps.appUrl ?? (await import("@/lib/env")).getEnv().BETTER_AUTH_URL
  ).replace(/\/+$/, "")

  const refund = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    select: {
      amount: true,
      bookingItem: {
        select: {
          vendorId: true,
          vendor: { select: { name: true } },
          booking: {
            select: {
              id: true,
              tourist: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  })

  const booking = refund.bookingItem.booking
  const ref = bookingRef(booking.id)
  const amount = pounds(refund.amount)

  const issued = refundIssuedEmail({
    name: booking.tourist.name,
    bookingRef: ref,
    amount,
    bookingsUrl: `${appUrl}/account/bookings`,
  })

  await queue.enqueueInTransaction(
    tx,
    {
      to: booking.tourist.email,
      subject: issued.subject,
      html: issued.html,
      text: issued.text,
      tags: { kind: "refund-issued" },
    } satisfies EmailMessage,
    deterministicUuid(
      `refund-issued:${refundId}:${booking.tourist.email.toLowerCase()}`
    )
  )

  const owners = await tx.vendorMember.findMany({
    where: { vendorId: refund.bookingItem.vendorId, role: "OWNER" },
    select: { user: { select: { name: true, email: true } } },
  })

  for (const { user } of owners) {
    const notice = refundReversalEmail({
      name: user.name,
      vendorName: refund.bookingItem.vendor.name,
      bookingRef: ref,
      amount,
      dashboardUrl: `${appUrl}/vendor/bookings`,
    })

    await queue.enqueueInTransaction(
      tx,
      {
        to: user.email,
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
        tags: { kind: "refund-reversal" },
      } satisfies EmailMessage,
      deterministicUuid(
        `refund-reversal:${refundId}:${user.email.toLowerCase()}`
      )
    )
  }
}
