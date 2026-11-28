import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { NotFoundError } from "@/lib/errors"
import { addToCart } from "@/lib/services/cart"
import { addTripItem, createTrip } from "@/lib/services/trip"
import { offerForTripItem } from "@/lib/services/trip-cart"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
const HOUR = 60 * 60 * 1000
const NOW = new Date("2030-06-01T10:00:00Z")

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
})

async function tourist(email: string) {
  const u = await prisma.user.create({
    data: { email, name: email, emailVerified: true, platformRole: "TOURIST" },
  })
  return {
    id: u.id,
    session: async () => ({
      user: {
        id: u.id,
        email,
        name: email,
        emailVerified: true,
        platformRole: "TOURIST",
      },
    }),
  }
}

let n = 0
/** A published listing with one product and the given slots. */
async function listingWith(
  slots: {
    startAt: Date
    remaining?: number
    closed?: boolean
    priceOverride?: number | null
  }[],
  opts: { cutoffHours?: number; productActive?: boolean } = {}
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
    },
  })
  const category = await prisma.category.create({
    data: { name: "Tours", slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  return prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `Walk ${n}`,
      slug: `walk-${n}`,
      status: "PUBLISHED",
      products: {
        create: {
          name: "Morning",
          basePrice: 1200,
          active: opts.productActive ?? true,
          policy: {
            cancelWindowHours: 24,
            bookingCutoffHours: opts.cutoffHours ?? 2,
          },
          availability: {
            create: slots.map((s) => ({
              startAt: s.startAt,
              endAt: new Date(s.startAt.getTime() + HOUR),
              capacity: 5,
              remaining: s.remaining ?? 5,
              closed: s.closed ?? false,
              priceOverride: s.priceOverride ?? null,
            })),
          },
        },
      },
    },
  })
}

const deps = (u: { session: () => Promise<unknown> }) => ({
  session: u.session as never,
  db: prisma,
  now: () => NOW,
})

describe("taking a trip item to the cart (Postgres)", () => {
  it("TC-E1S2-04: the offer lists only bookable slots and preselects the planned day", async () => {
    const u = await tourist("olive@example.com")
    const listing = await listingWith([
      { startAt: new Date(NOW.getTime() + 5 * HOUR) }, // bookable, not the planned day
      { startAt: new Date("2030-06-05T10:00:00Z"), priceOverride: 1500 }, // planned day
      { startAt: new Date(NOW.getTime() + 6 * HOUR), closed: true },
      { startAt: new Date(NOW.getTime() + 7 * HOUR), remaining: 0 },
      { startAt: new Date(NOW.getTime() + 1 * HOUR) }, // inside the 2-hour cutoff
    ])
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const withItem = await addTripItem(
      { tripId: trip.id, listingId: listing.id, plannedDate: "2030-06-05" },
      deps(u)
    )
    const itemId = withItem.items[0]!.id

    const offer = await offerForTripItem(itemId, deps(u))

    expect(offer.slots).toHaveLength(2)
    expect(offer.preselectedAvailabilityId).toBe(
      offer.slots.find((s) => s.unitPrice === 1500)?.availabilityId
    )
    expect(offer.slots.map((s) => s.remaining).every((r) => r > 0)).toBe(true)
  })

  it("the preselected slot is one the cart accepts", async () => {
    const u = await tourist("olive@example.com")
    const listing = await listingWith([
      { startAt: new Date(NOW.getTime() + 5 * HOUR) },
    ])
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const withItem = await addTripItem(
      { tripId: trip.id, listingId: listing.id },
      deps(u)
    )

    const offer = await offerForTripItem(withItem.items[0]!.id, deps(u))
    const cart = await addToCart(
      { availabilityId: offer.preselectedAvailabilityId, quantity: 1 },
      deps(u)
    )

    expect(cart.total).toBe(1200)
  })

  it("a product that is switched off offers nothing", async () => {
    const u = await tourist("olive@example.com")
    const listing = await listingWith(
      [{ startAt: new Date(NOW.getTime() + 5 * HOUR) }],
      { productActive: false }
    )
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const withItem = await addTripItem(
      { tripId: trip.id, listingId: listing.id },
      deps(u)
    )

    const offer = await offerForTripItem(withItem.items[0]!.id, deps(u))

    expect(offer.slots).toEqual([])
    expect(offer.preselectedAvailabilityId).toBeNull()
  })

  it("another visitor's trip item gets the same not-found as a missing one", async () => {
    const owner = await tourist("owner@example.com")
    const other = await tourist("other@example.com")
    const listing = await listingWith([
      { startAt: new Date(NOW.getTime() + 5 * HOUR) },
    ])
    const trip = await createTrip({ name: "Mine" }, deps(owner))
    const withItem = await addTripItem(
      { tripId: trip.id, listingId: listing.id },
      deps(owner)
    )

    await expect(
      offerForTripItem(withItem.items[0]!.id, deps(other))
    ).rejects.toThrow(NotFoundError)
  })
})
