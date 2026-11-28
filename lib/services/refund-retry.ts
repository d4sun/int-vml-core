import type { PrismaClient } from "@prisma/client"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import type { StripeAdapter } from "@/lib/stripe/adapter"
import {
  settleRefund,
  type SettlementOutcome,
} from "@/lib/services/refund-settlement"

export type RetryReversalDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "refund" | "auditLog">
  stripe?: StripeAdapter
}

/**
 * An admin sends a refund's reversal again, after the vendor's balance has
 * been topped up (E10-S1-08). Only a pending refund can be retried; the
 * Stripe calls are keyed, so a retry cannot send a reversal twice.
 */
export async function retryReversal(
  refundId: string,
  deps: RetryReversalDeps = {}
): Promise<SettlementOutcome> {
  await requireAdmin(deps.session)

  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()

  const refund = await db.refund.findUnique({
    where: { id: refundId },
    select: { id: true, status: true },
  })

  if (!refund) throw new NotFoundError("Refund not found")

  if (refund.status !== "pending") {
    throw new ConflictError("Only a pending refund can be retried.", {
      details: { reason: "NOT_PENDING" },
    })
  }

  return settleRefund(refundId, { db, stripe })
}
