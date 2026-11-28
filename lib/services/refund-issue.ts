import type { PrismaClient } from "@prisma/client"
import type { SessionSource } from "@/lib/auth/guards"
import type { StripeAdapter } from "@/lib/stripe/adapter"
import { requestRefund, type RequestedRefund } from "@/lib/services/refund"
import {
  settleRefund,
  type SettlementOutcome,
} from "@/lib/services/refund-settlement"

export type IssueRefundDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction" | "refund">
  stripe?: StripeAdapter
}

export type IssuedRefund = {
  refund: RequestedRefund
  /** What Stripe was asked for; `refunded` means the calls were accepted, not that money moved. */
  settlement: SettlementOutcome
}

/**
 * An admin's refund, end to end (E10-S1-07): the refund is recorded
 * (E10-S1-01) and then sent to Stripe (E10-S1-02). The booking and item are
 * marked refunded only when Stripe's `refund.updated` webhook confirms it.
 */
export async function issueRefund(
  input: unknown,
  deps: IssueRefundDeps = {}
): Promise<IssuedRefund> {
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()

  const refund = await requestRefund(input, { session: deps.session, db })
  const settlement = await settleRefund(refund.id, { db, stripe })

  return { refund, settlement }
}
