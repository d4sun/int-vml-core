import type { PrismaClient } from "@prisma/client"
import {
  prismaMembershipStore,
  requireUser,
  type MembershipStore,
  type SessionSource,
} from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"
import { londonParts } from "@/lib/time/london"

/** Booking statuses that mean the sale was paid and confirmed (E6-S2-01). */
const PAID_BOOKING_STATUSES = [
  "CONFIRMED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const

export type EarningsRow = {
  /** London calendar month, "YYYY-MM". */
  period: string
  /** Sales paid and confirmed, pence (the vendor's subtotals). */
  gross: number
  /** Commission on those sales, pence. */
  commission: number
  /** Refunds confirmed by Stripe on those sales, pence. */
  refunds: number
  net: number
}

export type VendorEarnings = {
  periods: EarningsRow[]
  totals: Omit<EarningsRow, "period">
}

/**
 * Net earnings: `gross − commission − refunds`, in integer pence (E6-S2-01).
 * Pure, so the arithmetic is tested on its own.
 */
export function netOf(
  gross: number,
  commission: number,
  refunds: number
): number {
  return gross - commission - refunds
}

/** Adds `amounts` into per-period buckets, then totals them. */
export function buildEarnings(
  sales: { period: string; subtotal: number; commission: number }[],
  refunds: { period: string; amount: number }[]
): VendorEarnings {
  const byPeriod = new Map<
    string,
    { gross: number; commission: number; refunds: number }
  >()
  const bucket = (period: string) => {
    let row = byPeriod.get(period)
    if (!row) {
      row = { gross: 0, commission: 0, refunds: 0 }
      byPeriod.set(period, row)
    }
    return row
  }

  for (const sale of sales) {
    const row = bucket(sale.period)
    row.gross += sale.subtotal
    row.commission += sale.commission
  }
  for (const refund of refunds) {
    bucket(refund.period).refunds += refund.amount
  }

  const periods: EarningsRow[] = [...byPeriod.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([period, row]) => ({
      period,
      ...row,
      net: netOf(row.gross, row.commission, row.refunds),
    }))

  const totals = periods.reduce(
    (t, r) => ({
      gross: t.gross + r.gross,
      commission: t.commission + r.commission,
      refunds: t.refunds + r.refunds,
      net: t.net + r.net,
    }),
    { gross: 0, commission: 0, refunds: 0, net: 0 }
  )

  return { periods, totals }
}

function monthOf(date: Date): string {
  const p = londonParts(date)

  return `${p.year}-${String(p.month).padStart(2, "0")}`
}

export type EarningsDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "bookingItem" | "refund" | "vendorMember">
  memberships?: MembershipStore
}

/**
 * A vendor's earnings by London month (E6-S2-01). Read only. The caller must
 * belong to the vendor (CR-2); a vendor they do not belong to is not found.
 */
export async function getVendorEarnings(
  input: { vendorId: string },
  deps: EarningsDeps = {}
): Promise<VendorEarnings> {
  const user = await requireUser(deps.session)
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const memberships = deps.memberships ?? prismaMembershipStore(db)

  if (!(await memberships.findMembership(user.id, input.vendorId))) {
    throw new NotFoundError("Vendor not found")
  }

  const items = await db.bookingItem.findMany({
    where: {
      vendorId: input.vendorId,
      booking: { status: { in: [...PAID_BOOKING_STATUSES] } },
    },
    select: {
      subtotal: true,
      commissionAmount: true,
      booking: { select: { createdAt: true } },
    },
  })

  const refunds = await db.refund.findMany({
    where: {
      status: "succeeded",
      bookingItem: { vendorId: input.vendorId },
    },
    select: {
      amount: true,
      createdAt: true,
    },
  })

  return buildEarnings(
    items.map((i) => ({
      period: monthOf(i.booking.createdAt),
      subtotal: i.subtotal,
      commission: i.commissionAmount,
    })),
    refunds.map((r) => ({ period: monthOf(r.createdAt), amount: r.amount }))
  )
}
