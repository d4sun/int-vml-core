import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import { audit } from "@/lib/services/audit"
import { requestRefundSchema } from "@/lib/validation/refund"

/** Refund statuses. A `failed` refund gives its amount back to the refundable total. */
export const REFUND_STATUS = {
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
} as const

export type RequestedRefund = {
  id: string
  bookingItemId: string
  amount: number
  /** What is still refundable on the item after this refund. */
  remaining: number
}

export type RequestRefundDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  record?: typeof audit.record
}

/** Item statuses that were paid for and can still be refunded. */
const REFUNDABLE_ITEM_STATUSES = ["CONFIRMED", "FULFILLED"]

/**
 * Records an admin's request to refund part of one booking item (E10-S1-01).
 * The refund is stored as `pending`; the Stripe refund and the transfer
 * reversal are separate steps (E10-S1-02), so nothing is sent to Stripe here.
 *
 * - Admin only; the tourist and the vendor cannot start a refund.
 * - The item is locked while it is checked, so two refunds at once cannot
 *   both fit the same money (no over-refund).
 * - Refunds that are not `failed` count against the item's subtotal, pending
 *   ones included, so money promised but not yet returned is not refunded twice.
 */
export async function requestRefund(
  input: unknown,
  deps: RequestRefundDeps = {}
): Promise<RequestedRefund> {
  const actor = await requireAdmin(deps.session)

  const parsed = requestRefundSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { bookingItemId, amount, reason } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    // Lock the item for the rest of the transaction, as the other money writers do.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "BookingItem" WHERE "id" = ${bookingItemId} FOR UPDATE
    `

    if (locked.length === 0) throw new NotFoundError("Booking item not found")

    const item = await tx.bookingItem.findUniqueOrThrow({
      where: { id: bookingItemId },
      select: {
        id: true,
        status: true,
        subtotal: true,
        refunds: { select: { amount: true, status: true } },
      },
    })

    if (!REFUNDABLE_ITEM_STATUSES.includes(item.status)) {
      throw new ConflictError("This item cannot be refunded.", {
        details: { reason: "NOT_REFUNDABLE", status: item.status },
      })
    }

    const committed = item.refunds
      .filter((r) => r.status !== REFUND_STATUS.failed)
      .reduce((sum, r) => sum + r.amount, 0)
    const remaining = item.subtotal - committed

    if (amount > remaining) {
      throw new ConflictError("That is more than is left to refund.", {
        details: { reason: "EXCEEDS_REMAINING", remaining },
      })
    }

    const refund = await tx.refund.create({
      data: {
        bookingItemId: item.id,
        amount,
        reason: reason ?? null,
        status: REFUND_STATUS.pending,
      },
      select: { id: true },
    })

    await record(tx, {
      actorId: actor.id,
      action: "refund.requested",
      entityType: "BookingItem",
      entityId: item.id,
      meta: { refundId: refund.id, amount, remainingBefore: remaining },
    })

    return {
      id: refund.id,
      bookingItemId: item.id,
      amount,
      remaining: remaining - amount,
    }
  })
}
