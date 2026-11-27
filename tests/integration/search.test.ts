import type { PrismaClient, VendorStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { searchListings } from "@/lib/search/service"
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
