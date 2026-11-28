import type { BookingStatus, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { londonDayBounds } from "@/lib/time/london"
import { metricsRangeSchema, type MetricsRange } from "@/lib/validation/metrics"

/** Money a booking brought in: what visitors paid and the commission on it. */
export type MetricsBooking = {
  total: number
  items: { commissionAmount: number }[]
}

export type MetricsSummary = {
  /** Gross merchandise value: the sum of confirmed booking totals, pence. */
  gmv: number
  /** Commission on those bookings (gross, before refunds), pence. */
  feeRevenue: number
  bookings: number
  items: number
  /** Refunds that Stripe has confirmed, pence. */
  refunded: number
}

/**
 * The totals for a set of confirmed bookings and the refunds confirmed on
 * them. Pure: no database, so the arithmetic is tested on its own (E10-S2-04).
 */
export function summarize(
  bookings: MetricsBooking[],
  refunds: { amount: number }[]
): MetricsSummary {
  return {
    gmv: bookings.reduce((sum, b) => sum + b.total, 0),
    feeRevenue: bookings.reduce(
      (sum, b) => sum + b.items.reduce((s, i) => s + i.commissionAmount, 0),
      0
    ),
    bookings: bookings.length,
    items: bookings.reduce((sum, b) => sum + b.items.length, 0),
    refunded: refunds.reduce((sum, r) => sum + r.amount, 0),
  }
}

/** Statuses that mean the booking was confirmed (it may later be refunded). */
export const CONFIRMED_BOOKING_STATUSES: BookingStatus[] = [
  "CONFIRMED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]

export type MetricsDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "booking" | "refund">
}

/**
 * GMV, commission and counts for bookings confirmed in a London date range,
 * for admins (E10-S2-04). A booking counts by the day it was made.
 */
export async function getMetrics(
  rangeInput: unknown,
  deps: MetricsDeps = {}
): Promise<MetricsSummary> {
  await requireAdmin(deps.session)

  const parsed = metricsRangeSchema.safeParse(rangeInput)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const window = dateWindow(parsed.data)

  const bookings = await db.booking.findMany({
    where: { status: { in: CONFIRMED_BOOKING_STATUSES }, createdAt: window },
    select: {
      total: true,
      items: { select: { commissionAmount: true } },
    },
  })
  const refunds = await db.refund.findMany({
    where: { status: "succeeded", createdAt: window },
    select: { amount: true },
  })

  return summarize(bookings, refunds)
}

function dateWindow(range: MetricsRange): { gte: Date; lt: Date } | undefined {
  if (!range.from || !range.to) return undefined

  const [fy, fm, fd] = range.from.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  const [ty, tm, td] = range.to.split("-").map(Number) as [
    number,
    number,
    number,
  ]

  return {
    gte: londonDayBounds({ year: fy, month: fm, day: fd }).from,
    lt: londonDayBounds({ year: ty, month: tm, day: td }).to,
  }
}
