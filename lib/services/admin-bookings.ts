import type { PrismaClient } from "@prisma/client"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"
import {
  REVERSAL_BLOCKED,
  REVERSAL_SENT,
} from "@/lib/services/refund-settlement"

export type AdminBookingItem = {
  id: string
  productName: string
  listingTitle: string
  vendorName: string
  quantity: number
  subtotal: number
  status: string
  /** Pence still refundable: subtotal less refunds that have not failed. */
  refundable: number
}

export type AdminBooking = {
  id: string
  status: string
  total: number
  createdAt: Date
  tourist: { name: string; email: string }
  paymentStatus: string | null
  items: AdminBookingItem[]
  refunds: {
    id: string
    bookingItemId: string
    amount: number
    status: string
    reason: string | null
    createdAt: Date
    /**
     * The vendor's balance could not cover this refund's reversal, and no retry
     * has succeeded since (E10-S1-08). Read from the audit log's latest entry.
     */
    flagged: boolean
  }[]
}

export type AdminBookingDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "booking" | "auditLog">
}

/** One booking as an admin sees it, for refunds (E10-S1-07). Admin only. */
export async function getBookingForAdmin(
  bookingId: string,
  deps: AdminBookingDeps = {}
): Promise<AdminBooking> {
  await requireAdmin(deps.session)

  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      total: true,
      createdAt: true,
      tourist: { select: { name: true, email: true } },
      payment: { select: { status: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantity: true,
          subtotal: true,
          status: true,
          product: { select: { name: true } },
          vendor: { select: { name: true } },
          availability: {
            select: {
              product: { select: { listing: { select: { title: true } } } },
            },
          },
          refunds: {
            select: {
              id: true,
              amount: true,
              status: true,
              reason: true,
              createdAt: true,
              bookingItemId: true,
            },
          },
        },
      },
    },
  })

  if (!booking) throw new NotFoundError("Booking not found")

  const items = booking.items.map((item) => {
    const committed = item.refunds
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount, 0)

    return {
      id: item.id,
      productName: item.product.name,
      listingTitle: item.availability.product.listing.title,
      vendorName: item.vendor.name,
      quantity: item.quantity,
      subtotal: item.subtotal,
      status: item.status,
      refundable: item.subtotal - committed,
    }
  })

  const refundIds = booking.items.flatMap((item) =>
    item.refunds.map((r) => r.id)
  )
  const reversalLog = refundIds.length
    ? await db.auditLog.findMany({
        where: {
          entityType: "Refund",
          entityId: { in: refundIds },
          action: { in: [REVERSAL_BLOCKED, REVERSAL_SENT] },
        },
        orderBy: { at: "desc" },
        select: { entityId: true, action: true },
      })
    : []
  const latestByRefund = new Map<string, string>()
  for (const entry of reversalLog) {
    if (!latestByRefund.has(entry.entityId)) {
      latestByRefund.set(entry.entityId, entry.action)
    }
  }

  return {
    id: booking.id,
    status: booking.status,
    total: booking.total,
    createdAt: booking.createdAt,
    tourist: booking.tourist,
    paymentStatus: booking.payment?.status ?? null,
    items,
    refunds: booking.items
      .flatMap((item) => item.refunds)
      .map((refund) => ({
        ...refund,
        flagged:
          refund.status === "pending" &&
          latestByRefund.get(refund.id) === REVERSAL_BLOCKED,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  }
}
