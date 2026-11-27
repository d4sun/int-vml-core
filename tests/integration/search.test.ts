import type { PrismaClient, VendorStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { searchListings } from "@/lib/search/service"
import { londonParts } from "@/lib/time/london"
import { SEARCH_PAGE_SIZE } from "@/lib/validation/search"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let tours: string
let events: string

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  tours = (
    await prisma.category.create({
      data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
    })
  ).id
  events = (
    await prisma.category.create({
      data: { name: "Events", slug: "events", type: "TIMED_SLOT" },
    })
  ).id
})

let n = 0
async function vendor(status: VendorStatus = "APPROVED") {
  n += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${n}`,
      slug: `vendor-${n}`,
      status,
      stripeOnboardingComplete: true,
    },
  })
}

async function listing(opts: {
  title: string
  description?: string
  status?: "PUBLISHED" | "PENDING_REVIEW" | "DRAFT"
  vendorStatus?: VendorStatus
  categoryId?: string
  prices?: number[]
  inactivePrices?: number[]
}) {
  n += 1
  const v = await vendor(opts.vendorStatus ?? "APPROVED")

  return prisma.listing.create({
    data: {
      vendorId: v.id,
      categoryId: opts.categoryId ?? tours,
      title: opts.title,
      slug: `listing-${n}`,
      description: opts.description ?? null,
      status: opts.status ?? "PUBLISHED",
      products: {
        create: [
          ...(opts.prices ?? []).map((basePrice) => ({
            name: "Slot",
            basePrice,
            policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
            active: true,
          })),
          ...(opts.inactivePrices ?? []).map((basePrice) => ({
            name: "Old slot",
            basePrice,
            policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
            active: false,
          })),
        ],
      },
    },
  })
}

const titles = async (input: unknown) =>
  (await searchListings(input, { db: prisma })).listings.map((row) => row.title)

describe("public search (Postgres)", () => {
  it("TC-E1S1-01: a draft or pending listing is never in the results", async () => {
    await listing({ title: "Thames Walk live", status: "PUBLISHED" })
    await listing({ title: "Thames Walk pending", status: "PENDING_REVIEW" })
    await listing({ title: "Thames Walk draft", status: "DRAFT" })

    expect(await titles({ q: "thames" })).toEqual(["Thames Walk live"])
    expect(await titles({})).toEqual(["Thames Walk live"])
  })

  it("TC-E1S1-02: a listing of a suspended vendor is excluded, even when published", async () => {
    await listing({ title: "Open Walk", vendorStatus: "APPROVED" })
    await listing({ title: "Suspended Walk", vendorStatus: "SUSPENDED" })

    expect(await titles({ q: "walk" })).toEqual(["Open Walk"])
  })

  it("TC-E1S1-04: category and price both apply, together", async () => {
    await listing({ title: "Cheap Tour", categoryId: tours, prices: [1500] })
    await listing({ title: "Dear Tour", categoryId: tours, prices: [9000] })
    await listing({ title: "Cheap Event", categoryId: events, prices: [1500] })

    const results = await titles({ category: "tours", maxPrice: 5000 })

    expect(results).toEqual(["Cheap Tour"])
  })

  it("the price filter reads active products only", async () => {
    await listing({
      title: "Old price only",
      prices: [],
      inactivePrices: [1000],
    })

    expect(await titles({ maxPrice: 5000 })).toEqual([])
  })

  it("finds words in the title and the description", async () => {
    await listing({
      title: "Riverside stroll",
      description: "Explore the old docks",
    })
    await listing({ title: "Castle visit", description: "Tower and moat" })

    expect(await titles({ q: "docks" })).toEqual(["Riverside stroll"])
    expect(await titles({ q: "riverside" })).toEqual(["Riverside stroll"])
  })

  it("ranks a title match above a description-only match", async () => {
    await listing({
      title: "Ghost walk",
      description: "Lantern tour of the city",
    })
    await listing({ title: "City lanterns", description: "A quiet evening" })

    expect(await titles({ q: "lantern" })).toEqual([
      "City lanterns",
      "Ghost walk",
    ])
  })

  it("returns the cheapest active price as the from-price", async () => {
    await listing({ title: "Priced", prices: [3000, 1200, 2500] })

    const [row] = (await searchListings({}, { db: prisma })).listings

    expect(row?.fromPrice).toBe(1200)
  })

  it("pages the results and reports the total", async () => {
    for (let i = 0; i < SEARCH_PAGE_SIZE + 2; i++) {
      await listing({ title: `Walk ${String(i).padStart(2, "0")}` })
    }

    const first = await searchListings({}, { db: prisma })
    const second = await searchListings({ page: 2 }, { db: prisma })

    expect(first.total).toBe(SEARCH_PAGE_SIZE + 2)
    expect(first.listings).toHaveLength(SEARCH_PAGE_SIZE)
    expect(second.listings).toHaveLength(2)
    expect(
      new Set([...first.listings, ...second.listings].map((l) => l.id)).size
    ).toBe(SEARCH_PAGE_SIZE + 2)
  })

  it("rejects an invalid price range before querying", async () => {
    await expect(
      searchListings({ minPrice: 5000, maxPrice: 1000 }, { db: prisma })
    ).rejects.toThrow()
  })
})

type Slot = { startAt: Date; remaining?: number; closed?: boolean }

/** A published listing with one product whose slots are set up as given. */
async function datedListing(title: string, cutoffHours: number, slots: Slot[]) {
  n += 1
  const v = await vendor("APPROVED")

  return prisma.listing.create({
    data: {
      vendorId: v.id,
      categoryId: tours,
      title,
      slug: `dated-${n}`,
      status: "PUBLISHED",
      products: {
        create: {
          name: "Dated slot",
          basePrice: 1000,
          policy: { cancelWindowHours: 24, bookingCutoffHours: cutoffHours },
          availability: {
            create: slots.map((slot) => ({
              startAt: slot.startAt,
              endAt: new Date(slot.startAt.getTime() + 60 * 60 * 1000),
              capacity: 10,
              remaining: slot.remaining ?? 10,
              closed: slot.closed ?? false,
            })),
          },
        },
      },
    },
  })
}

/** The London calendar date (YYYY-MM-DD) a moment falls on. */
function londonDate(at: Date): string {
  const p = londonParts(at)

  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

const HOUR = 60 * 60 * 1000

describe("availability-aware date filter (Postgres)", () => {
  it("TC-E1S1-03: a slot inside the booking cutoff is not returned for its date", async () => {
    const soon = new Date(Date.now() + 1 * HOUR) // cutoff is 2 hours

    await datedListing("Too soon", 2, [{ startAt: soon }])

    expect(await titles({ date: londonDate(soon) })).toEqual([])
  })

  it("a slot past the cutoff is returned for its date", async () => {
    const later = new Date(Date.now() + 5 * HOUR)

    await datedListing("Bookable later", 2, [{ startAt: later }])

    expect(await titles({ date: londonDate(later) })).toEqual([
      "Bookable later",
    ])
  })

  it("a sold-out or closed slot does not count", async () => {
    const later = new Date(Date.now() + 5 * HOUR)

    await datedListing("Sold out", 2, [{ startAt: later, remaining: 0 }])
    await datedListing("Closed", 2, [{ startAt: later, closed: true }])

    expect(await titles({ date: londonDate(later) })).toEqual([])
  })

  it("a date with no slots returns nothing, and no date returns everything", async () => {
    const later = new Date(Date.now() + 5 * HOUR)

    await datedListing("Dated", 2, [{ startAt: later }])
    await listing({ title: "Undated" })

    expect(await titles({ date: "2031-03-01" })).toEqual([])
    expect(await titles({})).toEqual(
      expect.arrayContaining(["Dated", "Undated"])
    )
  })

  it("rejects a date that is not real", async () => {
    await expect(
      searchListings({ date: "2026-02-31" }, { db: prisma })
    ).rejects.toThrow()
  })
})

async function located(title: string, lat: number | null, lng: number | null) {
  n += 1
  const v = await vendor("APPROVED")

  return prisma.listing.create({
    data: {
      vendorId: v.id,
      categoryId: tours,
      title,
      slug: `geo-${n}`,
      status: "PUBLISHED",
      lat,
      lng,
    },
  })
}

describe("map viewport search (Postgres)", () => {
  it("TC-E1S1-05: only listings inside the viewport are returned, nearest the centre first", async () => {
    await located("Centre", 51.5, -0.12) // inside
    await located("Edge", 51.52, -0.05) // inside but further from the centre
    await located("Far north", 52.4, -0.1) // outside
    await located("Unlocated", null, null) // cannot be on a map

    const box = { south: 51.4, north: 51.6, west: -0.3, east: 0 }
    const got = await titles(box)

    expect(got).toEqual(["Centre", "Edge"])
  })

  it("an area with nothing in it returns nothing", async () => {
    await located("Centre", 51.5, -0.12)

    expect(await titles({ south: 10, north: 11, west: 10, east: 11 })).toEqual(
      []
    )
  })
})
