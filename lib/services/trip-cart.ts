import type { PrismaClient } from "@prisma/client"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"
import { londonParts } from "@/lib/time/london"

export type BookableSlot = {
  availabilityId: string
  productName: string
  startAt: Date
  /** Pence per place: the slot's own price if set, otherwise the product's. */
  unitPrice: number
  remaining: number
}

export type TripItemOffer = {
  tripItemId: string
  listingTitle: string
  plannedDate: string | null
  slots: BookableSlot[]
  /** The slot the cart should start with; null when nothing is bookable. */
  preselectedAvailabilityId: string | null
}

export type TripCartDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "tripItem" | "availability">
  now?: () => Date
}

/** The London calendar date (YYYY-MM-DD) a moment falls on. */
export function londonDateOf(at: Date): string {
  const p = londonParts(at)

  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/**
 * The slot to start a cart with: the earliest bookable slot on the trip item's
 * planned date when there is one, otherwise the earliest bookable slot. Pure,
 * so the rule is tested without a database.
 */
export function chooseSlot(
  slots: BookableSlot[],
  plannedDate: string | null
): string | null {
  const ordered = [...slots].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime()
  )

  if (plannedDate) {
    const onDay = ordered.find(
      (slot) => londonDateOf(slot.startAt) === plannedDate
    )

    if (onDay) return onDay.availabilityId
  }

  return ordered[0]?.availabilityId ?? null
}

/**
 * What the cart needs to take a trip item: its listing's open slots, bookable
 * now (not closed, places left, and starting after the product's booking
 * cutoff, measured in UTC). Only the item's owner gets an answer; anyone else
 * gets the same not-found as a missing item.
 */
export async function offerForTripItem(
  tripItemId: string,
  deps: TripCartDeps = {}
): Promise<TripItemOffer> {
  const user = await requireUser(deps.session)
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const now = deps.now?.() ?? new Date()

  const item = await db.tripItem.findFirst({
    where: { id: tripItemId, trip: { touristUserId: user.id } },
    select: {
      id: true,
      plannedDate: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  })

  if (!item) throw new NotFoundError("That item was not found")

  const rows = await db.availability.findMany({
    where: {
      closed: false,
      remaining: { gt: 0 },
      startAt: { gt: now },
      product: { active: true, listingId: item.listingId },
    },
    orderBy: { startAt: "asc" },
    take: 200,
    select: {
      id: true,
      startAt: true,
      remaining: true,
      priceOverride: true,
      product: { select: { name: true, basePrice: true, policy: true } },
    },
  })

  const slots: BookableSlot[] = rows
    .filter((row) => {
      const hours = (
        row.product.policy as { bookingCutoffHours?: unknown } | null
      )?.bookingCutoffHours
      const cutoff =
        typeof hours === "number" && Number.isFinite(hours) ? hours : 0

      return row.startAt.getTime() > now.getTime() + cutoff * 60 * 60 * 1000
    })
    .map((row) => ({
      availabilityId: row.id,
      productName: row.product.name,
      startAt: row.startAt,
      unitPrice: row.priceOverride ?? row.product.basePrice,
      remaining: row.remaining,
    }))

  const plannedDate = item.plannedDate
    ? item.plannedDate.toISOString().slice(0, 10)
    : null

  return {
    tripItemId: item.id,
    listingTitle: item.listing.title,
    plannedDate,
    slots,
    preselectedAvailabilityId: chooseSlot(slots, plannedDate),
  }
}
