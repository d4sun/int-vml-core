import type { BookingItemStatus, PrismaClient } from "@prisma/client"
import {
  requireUser,
  prismaMembershipStore,
  type MembershipStore,
  type SessionSource,
} from "@/lib/auth/guards"
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors"
import { nextItemStatus, noShowAllowed } from "@/lib/bookings/transitions"
import { londonDayBounds } from "@/lib/time/london"

/** Items a vendor sees: only those that were settled (paid and confirmed or later). Pending items are not listed. */
const SETTLED: BookingItemStatus[] = [
  "CONFIRMED",
  "FULFILLED",
  "NO_SHOW",
  "REFUNDED",
  "CANCELLED",
]

export type VendorBookingItem = {
  id: string
  bookingRef: string
  listingTitle: string
  productName: string
  startAt: Date
  quantity: number
  subtotal: number
  status: BookingItemStatus
  fulfilledAt: Date | null
}

export type VendorBookingDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "bookingItem" | "vendorMember" | "$transaction">
  memberships?: MembershipStore
  now?: () => Date
}

async function resolve(deps: VendorBookingDeps) {
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const memberships = deps.memberships ?? prismaMembershipStore(db)
  const now = deps.now?.() ?? new Date()

  return { db, memberships, now }
}

/**
 * The settled items of one vendor, soonest first, optionally on one London
 * day. The caller must be a member of that vendor (CR-2); a vendor the caller
 * does not belong to has no list, not an empty one.
 */
export async function listVendorBookings(
  input: { vendorId: string; date?: string },
  deps: VendorBookingDeps = {}
): Promise<VendorBookingItem[]> {
  const user = await requireUser(deps.session)
  const { db, memberships } = await resolve(deps)

  if (!(await memberships.findMembership(user.id, input.vendorId))) {
    throw new NotFoundError("That vendor was not found")
  }

  let dayFilter = {}

  if (input.date) {
    const [year, month, day] = input.date.split("-").map(Number)
    if (!year || !month || !day) throw new ValidationError("Choose a real date")
    const { from, to } = londonDayBounds({ year, month, day })
    dayFilter = { availability: { startAt: { gte: from, lt: to } } }
  }

  const rows = await db.bookingItem.findMany({
    where: { vendorId: input.vendorId, status: { in: SETTLED }, ...dayFilter },
    orderBy: { availability: { startAt: "asc" } },
    select: {
      id: true,
      quantity: true,
      subtotal: true,
      status: true,
      fulfilledAt: true,
      booking: { select: { id: true } },
      product: { select: { name: true, listing: { select: { title: true } } } },
      availability: { select: { startAt: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    bookingRef: row.booking.id.slice(0, 8).toUpperCase(),
    listingTitle: row.product.listing.title,
    productName: row.product.name,
    startAt: row.availability.startAt,
    quantity: row.quantity,
    subtotal: row.subtotal,
    status: row.status,
    fulfilledAt: row.fulfilledAt,
  }))
}

/**
 * Loads an item the caller may act on. An item whose vendor the caller is not a
 * member of is "not found", exactly as a missing item is (CR-2, IT-18).
 */
async function ownedItem(itemId: string, deps: VendorBookingDeps) {
  const user = await requireUser(deps.session)
  const { db, memberships } = await resolve(deps)

  const item = await db.bookingItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      vendorId: true,
      status: true,
      availability: { select: { startAt: true } },
    },
  })

  if (!item || !(await memberships.findMembership(user.id, item.vendorId))) {
    throw new NotFoundError("That booking item was not found")
  }

  return item
}

/** Marks a confirmed item as fulfilled (sets `fulfilledAt`). */
export async function markFulfilled(
  itemId: string,
  deps: VendorBookingDeps = {}
): Promise<void> {
  const item = await ownedItem(itemId, deps)
  const next = nextItemStatus(item.status, "fulfil")
  const { db, now } = await resolve(deps)

  const { count } = await db.bookingItem.updateMany({
    where: { id: itemId, status: item.status },
    data: { status: next, fulfilledAt: now },
  })

  if (count === 0)
    throw new ConflictError(
      "This booking changed just now. Refresh and try again."
    )
}

/** Marks a confirmed item as a no-show, once its slot has started. */
export async function markNoShow(
  itemId: string,
  deps: VendorBookingDeps = {}
): Promise<void> {
  const item = await ownedItem(itemId, deps)
  const next = nextItemStatus(item.status, "noShow")
  const { db, now } = await resolve(deps)

  if (!noShowAllowed(item.availability.startAt, now)) {
    throw new ConflictError(
      "You can mark a no-show once the time has started.",
      {
        details: { reason: "NOT_STARTED" },
      }
    )
  }

  const { count } = await db.bookingItem.updateMany({
    where: { id: itemId, status: item.status },
    data: { status: next },
  })

  if (count === 0)
    throw new ConflictError(
      "This booking changed just now. Refresh and try again."
    )
}
