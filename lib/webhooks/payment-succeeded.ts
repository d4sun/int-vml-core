import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { audit } from "@/lib/services/audit"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"

/** The parts of Stripe's PaymentIntent this handler reads. */
const intentSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  metadata: z.object({ bookingId: z.string().min(1) }).nullish(),
})

/**
 * `payment_intent.succeeded` (CR-4: the webhook decides, not the browser).
 *
 * Runs inside the event's own transaction (see `handleStripeWebhook`), so a
 * repeat of the same event is recorded once and never reaches this code twice.
 * The payment and its booking are changed only if they are still in their
 * pending state, so a late or out-of-order event cannot undo a later decision.
 *
 * - The booking and its items become CONFIRMED. The places were taken when the
 *   hold was made, so nothing is decremented here (the holds were removed at
 *   checkout).
 * - An amount that does not match what we asked for is recorded and not
 *   confirmed, so money that did not come from this booking never confirms it.
 * - A payment that is recorded after the booking was cancelled (its unpaid
 *   window passed) is written to the audit log for review, not confirmed.
 * - A payment we have no record of yet is an error, so Stripe retries the
 *   event once our own write has committed.
 */
export async function handlePaymentSucceeded(
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient
): Promise<void> {
  const intent = intentSchema.parse(event.data.object)

  let [payment] = await tx.$queryRaw<
    { id: string; bookingId: string; amount: number; status: string }[]
  >`
    SELECT "id", "bookingId", "amount", "status"
    FROM "Payment" WHERE "stripePaymentIntentId" = ${intent.id} FOR UPDATE
  `

  // Stripe Checkout creates the intent when the visitor pays, so the first event
  // for a payment may be the first we hear of its intent. Its metadata names the
  // booking; that payment takes this intent id, once.
  if (!payment && intent.metadata?.bookingId) {
    const [unlinked] = await tx.$queryRaw<
      { id: string; bookingId: string; amount: number; status: string }[]
    >`
      SELECT "id", "bookingId", "amount", "status"
      FROM "Payment"
      WHERE "bookingId" = ${intent.metadata.bookingId} AND "stripePaymentIntentId" IS NULL
      FOR UPDATE
    `

    if (unlinked) {
      await tx.payment.update({
        where: { id: unlinked.id },
        data: { stripePaymentIntentId: intent.id },
      })
      payment = unlinked
    }
  }

  if (!payment) {
    throw new Error(
      `payment ${intent.id} is not recorded yet; Stripe will retry`
    )
  }

  if (payment.status === "succeeded") return

  if (payment.amount !== intent.amount) {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "amount_mismatch" },
    })
    await audit.record(tx, {
      actorId: null,
      action: "payment.amount_mismatch",
      entityType: "Payment",
      entityId: payment.id,
      meta: { expected: payment.amount, received: intent.amount },
    })

    return
  }

  const [booking] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT "id", "status" FROM "Booking" WHERE "id" = ${payment.bookingId} FOR UPDATE
  `

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "succeeded" },
  })

  if (booking?.status !== "PENDING") {
    await audit.record(tx, {
      actorId: null,
      action: "booking.paid_after_close",
      entityType: "Booking",
      entityId: payment.bookingId,
      meta: { status: booking?.status ?? null, paymentIntentId: intent.id },
    })

    return
  }

  await tx.booking.update({
    where: { id: payment.bookingId },
    data: { status: "CONFIRMED" },
  })
  await tx.bookingItem.updateMany({
    where: { bookingId: payment.bookingId, status: "PENDING" },
    data: { status: "CONFIRMED" },
  })

  // Several vendors: the platform holds the money, so each item's share (its
  // subtotal less its commission) is recorded as a pending transfer. The
  // transfers are sent to Stripe afterwards, never from inside this handler
  // (E2-S3-02). A single-vendor booking is a destination charge: nothing to split.
  const items = await tx.bookingItem.findMany({
    where: { bookingId: payment.bookingId },
    select: {
      id: true,
      vendorId: true,
      subtotal: true,
      commissionAmount: true,
    },
  })

  if (new Set(items.map((item) => item.vendorId)).size > 1) {
    await tx.transfer.createMany({
      data: items.map((item) => ({
        bookingItemId: item.id,
        amount: item.subtotal - item.commissionAmount,
        status: "pending",
      })),
    })
  }
}
