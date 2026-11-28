import type {
  BookingItemStatus,
  BookingStatus,
  PrismaClient,
} from "@prisma/client"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"

export type MyBookingItem = {
  id: string
  listingTitle: string
  listingSlug: string
  productName: string
  startAt: Date
  quantity: number
  subtotal: number
  status: BookingItemStatus
}

export type MyBooking = {
  id: string
  ref: string
  status: BookingStatus
  total: number
  createdAt: Date
  items: MyBookingItem[]
}

export type MyBookingsDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "booking">
}

const SELECT = {
  id: true,
  status: true,
  total: true,
  createdAt: true,
  items: {
    orderBy: { availability: { startAt: "asc" as const } },
    select: {
      id: true,
      quantity: true,
      subtotal: true,
      status: true,
      availability: { select: { startAt: true } },
      product: {
        select: {
          name: true,
          listing: { select: { title: true, slug: true } },
        },
      },
    },
  },
} as const

type Row = {
  id: string
  status: BookingStatus
  total: number
  createdAt: Date
  items: {
    id: string
    quantity: number
    subtotal: number
    status: BookingItemStatus
    availability: { startAt: Date }
    product: { name: string; listing: { title: string; slug: string } }
  }[]
}

function toBooking(row: Row): MyBooking {
  return {
    id: row.id,
    ref: row.id.slice(0, 8).toUpperCase(),
    status: row.status,
    total: row.total,
    createdAt: row.createdAt,
    items: row.items.map((item) => ({
      id: item.id,
      listingTitle: item.product.listing.title,
      listingSlug: item.product.listing.slug,
      productName: item.product.name,
      startAt: item.availability.startAt,
      quantity: item.quantity,
      subtotal: item.subtotal,
      status: item.status,
    })),
  }
}

/** The signed-in visitor's own bookings, newest first (CR-1: nobody else's). */
export async function listMyBookings(
  deps: MyBookingsDeps = {}
): Promise<MyBooking[]> {
  const user = await requireUser(deps.session)
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)

  const rows = await db.booking.findMany({
    where: { touristUserId: user.id },
    orderBy: { createdAt: "desc" },
    select: SELECT,
  })

  return rows.map(toBooking)
}

/** One of the visitor's bookings. Someone else's booking is "not found", as a missing one is. */
export async function getMyBooking(
  bookingId: string,
  deps: MyBookingsDeps = {}
): Promise<MyBooking> {
  const user = await requireUser(deps.session)
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)

  const row = await db.booking.findFirst({
    where: { id: bookingId, touristUserId: user.id },
    select: SELECT,
  })

  if (!row) throw new NotFoundError("That booking was not found")

  return toBooking(row)
}

/** Slot times are shown in London time, as the site always does (CR-6). */
export function londonTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  })
}
