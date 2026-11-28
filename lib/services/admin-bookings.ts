import type { PrismaClient } from "@prisma/client"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"

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
  }[]
}

export type AdminBookingDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "booking">
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
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  }
}
