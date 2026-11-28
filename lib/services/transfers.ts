import type { PrismaClient } from "@prisma/client"
import { assertVendorCanSell } from "@/lib/catalog/visibility"
import { ForbiddenError } from "@/lib/errors"
import type { StripeAdapter } from "@/lib/stripe/adapter"

export type SettleOutcome =
  | { transferId: string; outcome: "created"; stripeTransferId: string }
  | { transferId: string; outcome: "failed"; reason: string }
  | { transferId: string; outcome: "skipped" }

export type SettleDeps = {
  db?: Pick<PrismaClient, "transfer" | "vendor">
  stripe?: StripeAdapter
  now?: () => Date
}

/** A reason short enough to store and show, with no secrets in it. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error"

  return message.slice(0, 200)
}

/**
 * Sends one pending transfer to the vendor's connected account (E2-S3-02).
 *
 * - A transfer that is not pending is skipped: a repeat never sends twice.
 * - The vendor must still be able to sell (`sellBlockReason`); if not, the
 *   transfer fails with NOT_PAYABLE and is not sent.
 * - Stripe is called with the key `transfer:<id>`, so a retry after a timeout
 *   reaches the same transfer.
 * - A failure is recorded on the transfer and does not touch the booking,
 *   which stays paid. Reconciliation (E10-S2) retries it later.
 */
export async function settleTransfer(
  transferId: string,
  deps: SettleDeps = {}
): Promise<SettleOutcome> {
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()
  const now = deps.now?.() ?? new Date()

  const transfer = await db.transfer.findUnique({
    where: { id: transferId },
    select: {
      id: true,
      amount: true,
      status: true,
      bookingItem: {
        select: {
          bookingId: true,
          vendorId: true,
          vendor: { select: { stripeAccountId: true } },
        },
      },
    },
  })

  if (!transfer || transfer.status !== "pending")
    return { transferId, outcome: "skipped" }

  const vendor = transfer.bookingItem.vendor

  // The sell gate (CR-4 / E4-S2-05): a vendor that cannot be paid right now is
  // not paid, and the transfer records why.
  try {
    await assertVendorCanSell(transfer.bookingItem.vendorId, db)
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error

    const reason = `NOT_PAYABLE: ${(error.details as { reason?: string } | undefined)?.reason ?? "FORBIDDEN"}`
    await db.transfer.updateMany({
      where: { id: transfer.id, status: "pending" },
      data: { status: "failed", failureReason: reason, settledAt: now },
    })

    return { transferId, outcome: "failed", reason }
  }

  if (!vendor.stripeAccountId) {
    const reason = "NOT_PAYABLE: NO_ACCOUNT"
    await db.transfer.updateMany({
      where: { id: transfer.id, status: "pending" },
      data: { status: "failed", failureReason: reason, settledAt: now },
    })

    return { transferId, outcome: "failed", reason }
  }

  try {
    const sent = await stripe.createTransfer(
      {
        amount: transfer.amount,
        destinationAccountId: vendor.stripeAccountId,
        transferGroup: `booking:${transfer.bookingItem.bookingId}`,
        transferId: transfer.id,
      },
      { idempotencyKey: `transfer:${transfer.id}` }
    )

    await db.transfer.updateMany({
      where: { id: transfer.id, status: "pending" },
      data: { status: "created", stripeTransferId: sent.id, settledAt: now },
    })

    return { transferId, outcome: "created", stripeTransferId: sent.id }
  } catch (error) {
    const reason = reasonOf(error)

    await db.transfer.updateMany({
      where: { id: transfer.id, status: "pending" },
      data: { status: "failed", failureReason: reason, settledAt: now },
    })

    return { transferId, outcome: "failed", reason }
  }
}

/** Settles the oldest pending transfers, up to `limit`, one at a time. */
export async function settlePendingTransfers(
  limit: number,
  deps: SettleDeps = {}
): Promise<SettleOutcome[]> {
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const pending = await db.transfer.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  })

  const outcomes: SettleOutcome[] = []

  for (const row of pending) {
    outcomes.push(await settleTransfer(row.id, { ...deps, db }))
  }

  return outcomes
}
