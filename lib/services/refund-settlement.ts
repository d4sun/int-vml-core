import type { PrismaClient } from "@prisma/client"
import { ConflictError, NotFoundError } from "@/lib/errors"
import { refundCommissionShare } from "@/lib/money/commission"
import type { StripeAdapter } from "@/lib/stripe/adapter"

export type SettlementDeps = {
  db?: Pick<PrismaClient, "refund">
  stripe: StripeAdapter
}

export type SettlementOutcome =
  /** Stripe refunded (and, for a platform charge, reversed the vendor's share). */
  | { outcome: "refunded"; refundId: string; transferReversalId: string | null }
  /** Already settled, or no longer pending: nothing was sent. */
  | { outcome: "skipped"; refundId: string }
  /** The vendor's transfer has not been sent yet, so the refund waits. Nothing was sent. */
  | { outcome: "blocked"; refundId: string; reason: "TRANSFER_NOT_SENT" }
  /** Stripe declined the refund. The refund is marked failed and frees its amount. */
  | { outcome: "failed"; refundId: string }
  /**
   * The refund went through but the vendor's reversal did not. The refund is
   * left pending with its Stripe id, so a retry sends only the reversal.
   */
  | { outcome: "partial"; refundId: string }

/**
 * Sends one refund to Stripe and the matching vendor reversal, each keyed so
 * that a retry cannot send it twice (E10-S1-02).
 *
 * - Destination charge (one vendor): Stripe reverses the vendor's transfer in
 *   the refund call (`reverse_transfer`); no separate reversal is sent.
 * - Platform charge (several vendors): the platform refunds the visitor and
 *   reverses the vendor's transfer by the refund less its commission part, so
 *   the platform keeps exactly its commission on the refunded share.
 * - No network call is made inside a database transaction.
 *
 * Webhooks (`refund.*`, `transfer.reversed`) later confirm these results
 * (E10-S1-03); this call records the Stripe ids it was given.
 */
export async function settleRefund(
  refundId: string,
  deps: SettlementDeps
): Promise<SettlementOutcome> {
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: {
      bookingItem: {
        include: {
          transfers: { select: { status: true, stripeTransferId: true } },
          booking: {
            select: {
              payment: { select: { stripePaymentIntentId: true } },
              items: { select: { vendorId: true } },
            },
          },
        },
      },
    },
  })

  if (!refund) throw new NotFoundError("Refund not found")

  // Only a pending refund is sent. Settled means both Stripe calls have been
  // answered: the refund id is stored, and (for a platform charge) the
  // reversal id too. A refund with its refund id but no reversal is finished
  // by sending only the reversal (below).
  if (refund.status !== "pending") {
    return { outcome: "skipped", refundId }
  }

  const item = refund.bookingItem
  const intentId = item.booking.payment?.stripePaymentIntentId

  if (!intentId) {
    throw new ConflictError("This booking has no payment to refund.", {
      details: { reason: "NO_PAYMENT_INTENT" },
    })
  }

  const vendorCount = new Set(item.booking.items.map((i) => i.vendorId)).size
  const destination = vendorCount === 1

  // Both Stripe calls already answered (for this kind of charge): nothing to send.
  if (refund.stripeRefundId && (destination || refund.transferReversalId)) {
    return { outcome: "skipped", refundId }
  }

  const sent = item.transfers.find(
    (t) => t.status === "created" && t.stripeTransferId
  )

  if (!destination && !sent) {
    return { outcome: "blocked", refundId, reason: "TRANSFER_NOT_SENT" }
  }

  let stripeRefundId = refund.stripeRefundId

  if (!stripeRefundId) {
    try {
      const stripeRefund = await deps.stripe.createRefund(
        {
          paymentIntentId: intentId,
          amount: refund.amount,
          refundId,
          reverseTransfer: destination,
        },
        { idempotencyKey: `refund:${refundId}` }
      )
      stripeRefundId = stripeRefund.id
      await db.refund.update({
        where: { id: refundId },
        data: { stripeRefundId },
      })
    } catch {
      await db.refund.update({
        where: { id: refundId },
        data: { status: "failed" },
      })

      return { outcome: "failed", refundId }
    }
  }

  let transferReversalId: string | null = null

  if (!destination && sent?.stripeTransferId) {
    // Refunds made earlier on this item (not failed) take their share first,
    // so the commission on the item is kept to the penny across all refunds.
    const earlier = await db.refund.findMany({
      where: {
        bookingItemId: item.id,
        status: { not: "failed" },
        createdAt: { lt: refund.createdAt },
      },
      select: { amount: true },
    })
    const refundedBefore = earlier.reduce((sum, r) => sum + r.amount, 0)
    const commissionPart = refundCommissionShare(
      refundedBefore,
      refund.amount,
      item.subtotal,
      item.commissionAmount
    )

    try {
      const reversal = await deps.stripe.reverseTransfer(
        {
          transferId: sent.stripeTransferId,
          amount: refund.amount - commissionPart,
          refundId,
        },
        { idempotencyKey: `reversal:${refundId}` }
      )
      transferReversalId = reversal.id
    } catch {
      return { outcome: "partial", refundId }
    }
  }

  // The refund stays pending: Stripe's `refund.updated` webhook decides it
  // succeeded (CR-4), and that is what marks the item and booking refunded.
  if (transferReversalId) {
    await db.refund.update({
      where: { id: refundId },
      data: { transferReversalId },
    })
  }

  return { outcome: "refunded", refundId, transferReversalId }
}
