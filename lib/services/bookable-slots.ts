import type { PrismaClient } from "@prisma/client"

export type BookableSlot = {
  availabilityId: string
  productName: string
  startAt: Date
  /** Pence per place: the slot's own price if set, otherwise the product's. */
  unitPrice: number
  remaining: number
}

/**
 * The open slots of a listing that a visitor may book right now: the product is
 * active, the slot is not closed, has places left, and starts after the
 * product's booking cutoff (measured from `now`, in UTC). The one definition of
 * "bookable" shared by the listing page, the cart and trip offers.
 */
export async function bookableSlotsForListing(
  listingId: string,
  now: Date,
  db: Pick<PrismaClient, "availability">
): Promise<BookableSlot[]> {
  const rows = await db.availability.findMany({
    where: {
      closed: false,
      remaining: { gt: 0 },
      startAt: { gt: now },
      product: { active: true, listingId },
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

  return rows
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
}
