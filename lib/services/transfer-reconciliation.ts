import type { PrismaClient } from "@prisma/client"
import { audit } from "@/lib/services/audit"
import {
  settleTransfer,
  TRANSFER_FAILED,
  type SettleOutcome,
} from "@/lib/services/transfers"
import type { StripeAdapter } from "@/lib/stripe/adapter"

/**
 * How many times a vendor transfer is sent in all (the first send and its
 * retries). A transfer that has failed this many times is flagged for an
 * admin and not retried again (E10-S2-02).
 */
export const MAX_TRANSFER_ATTEMPTS = 3

/** The audit action written once when a transfer is flagged. */
export const TRANSFER_UNRESOLVED = "transfer.unresolved"

export type ReconcileDeps = {
  db?: Pick<PrismaClient, "transfer" | "auditLog" | "vendor">
  stripe?: StripeAdapter
  now?: () => Date
}

export type ReconcileSummary = {
  retried: number
  sent: number
  stillFailing: number
  flagged: number
}

/**
 * Retries failed vendor transfers, a bounded number of times (E10-S2-02).
 *
 * Each failed transfer is counted by its `transfer.failed` audit rows. Below
 * the limit it is reset to pending and sent again, through the same keyed
 * path as the first send, so a retry can never pay twice. At the limit it is
 * flagged once with `transfer.unresolved`, and left failed: the ledger shows
 * it, and nothing sends it again without a person looking.
 */
export async function reconcileFailedTransfers(
  limit: number,
  deps: ReconcileDeps = {}
): Promise<ReconcileSummary> {
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()

  const failed = await db.transfer.findMany({
    where: { status: "failed" },
    orderBy: { settledAt: "asc" },
    take: limit,
    select: { id: true },
  })

  const summary: ReconcileSummary = {
    retried: 0,
    sent: 0,
    stillFailing: 0,
    flagged: 0,
  }

  for (const row of failed) {
    const attempts = await db.auditLog.count({
      where: {
        action: TRANSFER_FAILED,
        entityType: "Transfer",
        entityId: row.id,
      },
    })

    if (attempts >= MAX_TRANSFER_ATTEMPTS) {
      const already = await db.auditLog.count({
        where: {
          action: TRANSFER_UNRESOLVED,
          entityType: "Transfer",
          entityId: row.id,
        },
      })

      if (already === 0) {
        await audit.record(db, {
          actorId: null,
          action: TRANSFER_UNRESOLVED,
          entityType: "Transfer",
          entityId: row.id,
          meta: { attempts },
        })
        summary.flagged += 1
      }

      continue
    }

    // Only a transfer that is still failed is reset; a concurrent success is left alone.
    const reset = await db.transfer.updateMany({
      where: { id: row.id, status: "failed" },
      data: { status: "pending" },
    })

    if (reset.count === 0) continue

    summary.retried += 1
    const outcome: SettleOutcome = await settleTransfer(row.id, {
      db,
      stripe,
      now: deps.now,
    })

    if (outcome.outcome === "created") summary.sent += 1
    else if (outcome.outcome === "failed") summary.stillFailing += 1
  }

  return summary
}
