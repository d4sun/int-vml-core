import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { londonDayBounds } from "@/lib/time/london"
import { ledgerFilterSchema, type LedgerFilter } from "@/lib/validation/ledger"

export type LedgerKind = "payment" | "transfer" | "refund"

export type LedgerRow = {
  kind: LedgerKind
  id: string
  at: Date
  /** Pence. Refunds and transfers are shown as recorded, not signed. */
  amount: number
  status: string
  bookingId: string
  /** The vendor for a transfer or refund; null for a payment (it covers the whole booking). */
  vendorName: string | null
  /** A transfer's failure reason, when it failed. */
  note: string | null
}

export type LedgerTotal = {
  kind: LedgerKind
  status: string
  count: number
  amount: number
}

export type Ledger = {
  totals: LedgerTotal[]
  rows: LedgerRow[]
  /** True when more rows matched than are shown. */
  truncated: boolean
}

export type LedgerDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "payment" | "transfer" | "refund">
}

const ROW_LIMIT = 200

/**
 * Money movements across payments, vendor transfers and refunds, for admins
 * (E10-S2-01). Read only: nothing here changes a payment, transfer or refund.
 *
 * The totals are per kind and status over the filter, so they reconcile with
 * the rows; the rows are the newest first, up to 200 across all kinds.
 */
export async function getLedger(
  filterInput: unknown,
  deps: LedgerDeps = {}
): Promise<Ledger> {
  await requireAdmin(deps.session)

  const parsed = ledgerFilterSchema.safeParse(filterInput)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const filter: LedgerFilter = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const window = dateWindow(filter)
  const wants = (kind: LedgerKind) =>
    filter.kind === "all" || filter.kind === kind

  const [payments, transfers, refunds] = await Promise.all([
    wants("payment")
      ? db.payment.findMany({
          where: { createdAt: window },
          orderBy: { createdAt: "desc" },
          take: ROW_LIMIT + 1,
          select: {
            id: true,
            createdAt: true,
            amount: true,
            status: true,
            bookingId: true,
          },
        })
      : [],
    wants("transfer")
      ? db.transfer.findMany({
          where: { createdAt: window },
          orderBy: { createdAt: "desc" },
          take: ROW_LIMIT + 1,
          select: {
            id: true,
            createdAt: true,
            amount: true,
            status: true,
            failureReason: true,
            bookingItem: {
              select: { bookingId: true, vendor: { select: { name: true } } },
            },
          },
        })
      : [],
    wants("refund")
      ? db.refund.findMany({
          where: { createdAt: window },
          orderBy: { createdAt: "desc" },
          take: ROW_LIMIT + 1,
          select: {
            id: true,
            createdAt: true,
            amount: true,
            status: true,
            bookingItem: {
              select: { bookingId: true, vendor: { select: { name: true } } },
            },
          },
        })
      : [],
  ])

  const rows: LedgerRow[] = [
    ...payments.map((p) => ({
      kind: "payment" as const,
      id: p.id,
      at: p.createdAt,
      amount: p.amount,
      status: p.status,
      bookingId: p.bookingId,
      vendorName: null,
      note: null,
    })),
    ...transfers.map((t) => ({
      kind: "transfer" as const,
      id: t.id,
      at: t.createdAt,
      amount: t.amount,
      status: t.status,
      bookingId: t.bookingItem.bookingId,
      vendorName: t.bookingItem.vendor.name,
      note: t.failureReason,
    })),
    ...refunds.map((r) => ({
      kind: "refund" as const,
      id: r.id,
      at: r.createdAt,
      amount: r.amount,
      status: r.status,
      bookingId: r.bookingItem.bookingId,
      vendorName: r.bookingItem.vendor.name,
      note: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())

  const totals = await totalsFor(db, filter, window)

  return {
    totals,
    rows: rows.slice(0, ROW_LIMIT),
    truncated: rows.length > ROW_LIMIT,
  }
}

function dateWindow(filter: LedgerFilter): { gte: Date; lt: Date } | undefined {
  if (!filter.from || !filter.to) return undefined

  const [fy, fm, fd] = filter.from.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  const [ty, tm, td] = filter.to.split("-").map(Number) as [
    number,
    number,
    number,
  ]

  return {
    gte: londonDayBounds({ year: fy, month: fm, day: fd }).from,
    lt: londonDayBounds({ year: ty, month: tm, day: td }).to,
  }
}

async function totalsFor(
  db: Pick<PrismaClient, "payment" | "transfer" | "refund">,
  filter: LedgerFilter,
  window: { gte: Date; lt: Date } | undefined
): Promise<LedgerTotal[]> {
  const wants = (kind: LedgerKind) =>
    filter.kind === "all" || filter.kind === kind

  const groups = await Promise.all([
    wants("payment")
      ? db.payment.groupBy({
          by: ["status"],
          where: { createdAt: window },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : [],
    wants("transfer")
      ? db.transfer.groupBy({
          by: ["status"],
          where: { createdAt: window },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : [],
    wants("refund")
      ? db.refund.groupBy({
          by: ["status"],
          where: { createdAt: window },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : [],
  ])

  const kinds: LedgerKind[] = ["payment", "transfer", "refund"]

  return groups.flatMap((rows, i) =>
    rows.map((row) => ({
      kind: kinds[i]!,
      status: row.status,
      count: row._count._all,
      amount: row._sum.amount ?? 0,
    }))
  )
}
