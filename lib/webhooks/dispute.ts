import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { audit } from "@/lib/services/audit"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"
import type { StripeEventHandler } from "@/lib/webhooks/stripe"

/** The parts of Stripe's Dispute this handler reads. */
const disputeSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  reason: z.string().nullish(),
  status: z.string().min(1),
  payment_intent: z.string().min(1),
})

/**
 * `charge.dispute.created|updated|closed` (E10-S2-03): a chargeback Stripe
 * opened against a payment. It is recorded so an admin can see it. It does not
 * move money, change the booking or the payment, or contact the visitor; the
 * dispute is handled in Stripe.
 *
 * - The dispute is stored once per Stripe dispute id; later events update its
 *   status and reason.
 * - A dispute for a payment we have no record of is an error, so Stripe
 *   retries once our write has committed.
 * - Runs inside the event's transaction, so a repeat is recorded once.
 */
export const handleDispute: StripeEventHandler = (event, tx) =>
  recordDispute(event, tx)

async function recordDispute(
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient
): Promise<void> {
  const dispute = disputeSchema.parse(event.data.object)

  const payment = await tx.payment.findUnique({
    where: { stripePaymentIntentId: dispute.payment_intent },
    select: { id: true, bookingId: true },
  })

  if (!payment) {
    throw new Error(
      `dispute ${dispute.id} is for a payment we have not recorded yet; Stripe will retry`
    )
  }

  const existing = await tx.dispute.findUnique({
    where: { stripeDisputeId: dispute.id },
    select: { id: true, status: true },
  })

  if (!existing) {
    const created = await tx.dispute.create({
      data: {
        stripeDisputeId: dispute.id,
        paymentId: payment.id,
        amount: dispute.amount,
        reason: dispute.reason ?? null,
        status: dispute.status,
      },
      select: { id: true },
    })

    await audit.record(tx, {
      actorId: null,
      action: "dispute.recorded",
      entityType: "Dispute",
      entityId: created.id,
      meta: {
        stripeDisputeId: dispute.id,
        bookingId: payment.bookingId,
        amount: dispute.amount,
      },
    })

    return
  }

  if (existing.status === dispute.status) return

  await tx.dispute.update({
    where: { id: existing.id },
    data: { status: dispute.status, reason: dispute.reason ?? null },
  })

  await audit.record(tx, {
    actorId: null,
    action: "dispute.updated",
    entityType: "Dispute",
    entityId: existing.id,
    meta: { from: existing.status, to: dispute.status },
  })
}
