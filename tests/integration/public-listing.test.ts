import type { PrismaClient, VendorStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getPublicListing } from "@/lib/listings/public"
import { searchListings } from "@/lib/search/service"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let categoryId: string

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  categoryId = (
    await prisma.category.create({
      data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
    })
  ).id
})

let n = 0
async function make(
  slug: string,
  opts: {
    status?: "PUBLISHED" | "DRAFT" | "PENDING_REVIEW"
    vendorStatus?: VendorStatus
  } = {}
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `Vendor ${n}`,
      slug: `vendor-${n}`,
      status: opts.vendorStatus ?? "APPROVED",
      stripeOnboardingComplete: true,
    },
  })

  return prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId,
      title: `Title ${slug}`,
      slug,
      status: opts.status ?? "PUBLISHED",
      description: "Desc",
      lat: 51.5,
      lng: -0.1,
      products: {
        create: [
          { name: "Dear", basePrice: 3000, policy: { cancelWindowHours: 48 } },
          { name: "Cheap", basePrice: 1000, policy: { cancelWindowHours: 0 } },
          { name: "Gone", basePrice: 500, policy: {}, active: false },
        ],
      },
    },
  })
}

describe("public listing read model (Postgres)", () => {
  it("a published listing of an approved vendor is returned with its active products, cheapest first", async () => {
    await make("visible")

    const found = await getPublicListing("visible", { db: prisma })

    expect(found?.slug).toBe("visible")
    expect(found?.products.map((product) => product.name)).toEqual([
      "Cheap",
      "Dear",
    ])
    expect(found?.products[1]?.cancelWindowHours).toBe(48)
    expect(found?.products[0]?.cancelWindowHours).toBe(0)
  })

  it("a draft, a pending listing and a suspended vendor's listing are not found", async () => {
    await make("draft", { status: "DRAFT" })
    await make("pending", { status: "PENDING_REVIEW" })
    await make("suspended", { vendorStatus: "SUSPENDED" })

    expect(await getPublicListing("draft", { db: prisma })).toBeNull()
    expect(await getPublicListing("pending", { db: prisma })).toBeNull()
    expect(await getPublicListing("suspended", { db: prisma })).toBeNull()
  })

  it("an unknown slug is not found", async () => {
    expect(await getPublicListing("nope", { db: prisma })).toBeNull()
  })

  it("search results carry the first picture's key in position order", async () => {
    const l = await make("pictures")
    await prisma.listingImage.createMany({
      data: [
        {
          listingId: l.id,
          key: "second",
          position: 1,
          contentType: "image/jpeg",
          sizeBytes: 10,
        },
        {
          listingId: l.id,
          key: "first",
          position: 0,
          contentType: "image/jpeg",
          sizeBytes: 10,
        },
      ],
    })

    const page = await searchListings({}, { db: prisma })

    expect(page.listings[0]?.imageKey).toBe("first")
  })
})
