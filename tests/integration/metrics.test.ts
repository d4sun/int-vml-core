import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError } from "@/lib/errors"
import { getMetrics } from "@/lib/services/metrics"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness
let n = 0

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
})

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  await prisma.user.update({ where: { email }, data: { platformRole, name } })

  return { session: await h.sessionFor(email, password) }
}

/** A booking of the given status and total, made on `day`, with one item of commission `commission`. */
async function booking(
  status: "PENDING" | "CONFIRMED" | "CANCELLED",
  total: number,
  commission: number,
  day: Date
) {
  n += 1
  const user = await prisma.user.create({
    data: {
      email: `m${n}@example.com`,
      name: "M",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: { name: `MV${n}`, slug: `mv-${n}`, status: "APPROVED" },
  })
  const category = await prisma.category.create({
    data: { name: `MC${n}`, slug: `mc-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "M",
      slug: `ml-${n}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "P",
      basePrice: total,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const startAt = new Date(day.getTime() + 5 * 24 * 3600 * 1000)
  const avail = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      capacity: 5,
      remaining: 4,
    },
  })
  const created = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status,
      total,
      createdAt: day,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId: vendor.id,
          quantity: 1,
          unitPrice: total,
          subtotal: total,
          commissionAmount: commission,
          status: "CONFIRMED",
        },
      },
    },
    include: { items: true },
  })

  return created.items[0]!.id
}

describe("metrics over confirmed bookings (Postgres)", () => {
  it("GMV is the sum of confirmed totals in the range, and pending or cancelled bookings are left out (TC-E10S2-02)", async () => {
    const admin = await account("ADMIN", "Admin")
    const inRange = new Date(Date.UTC(2026, 10, 10, 12))
    await booking("CONFIRMED", 1500, 150, inRange)
    await booking("CONFIRMED", 3000, 300, inRange)
    await booking("PENDING", 9999, 999, inRange)
    await booking("CANCELLED", 8888, 888, inRange)
    await booking("CONFIRMED", 7777, 777, new Date(Date.UTC(2026, 9, 1, 12)))

    const s = await getMetrics(
      { from: "2026-11-01", to: "2026-11-30" },
      { session: admin.session, db: prisma }
    )

    expect(s).toMatchObject({
      gmv: 4500,
      feeRevenue: 450,
      bookings: 2,
      items: 2,
    })
  })

  it("refunds confirmed by Stripe count; a pending refund does not", async () => {
    const admin = await account("ADMIN", "Admin")
    const day = new Date(Date.UTC(2026, 10, 10, 12))
    const itemId = await booking("CONFIRMED", 1500, 150, day)
    await prisma.refund.create({
      data: {
        bookingItemId: itemId,
        amount: 400,
        status: "succeeded",
        createdAt: day,
      },
    })
    await prisma.refund.create({
      data: {
        bookingItemId: itemId,
        amount: 600,
        status: "pending",
        createdAt: day,
      },
    })

    const s = await getMetrics({}, { session: admin.session, db: prisma })

    expect(s.refunded).toBe(400)
  })

  it("metrics are for admins only", async () => {
    const tourist = await account("TOURIST", "Tourist")

    await expect(
      getMetrics({}, { session: tourist.session, db: prisma })
    ).rejects.toThrow(ForbiddenError)
  })
})
