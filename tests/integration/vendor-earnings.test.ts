import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { NotFoundError } from "@/lib/errors"
import { getVendorEarnings } from "@/lib/services/vendor-earnings"
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

/** A vendor with an owner who can sign in. */
async function vendorWithOwner() {
  n += 1
  const { email, password } = await h.registerVerified()
  const owner = await prisma.user.update({
    where: { email },
    data: { platformRole: "VENDOR", name: `Owner ${n}` },
  })
  const vendor = await prisma.vendor.create({
    data: { name: `EV${n}`, slug: `ev-${n}`, status: "APPROVED" },
  })
  await prisma.vendorMember.create({
    data: { userId: owner.id, vendorId: vendor.id, role: "OWNER" },
  })

  return { vendorId: vendor.id, session: await h.sessionFor(email, password) }
}

/** One item for a vendor on a booking with the given status; returns the item id. */
async function saleFor(
  vendorId: string,
  status: "PENDING" | "CONFIRMED" | "CANCELLED",
  subtotal: number,
  commission: number
) {
  n += 1
  const user = await prisma.user.create({
    data: {
      email: `ve${n}@example.com`,
      name: "V",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const category = await prisma.category.create({
    data: { name: `EC${n}`, slug: `ec-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId,
      categoryId: category.id,
      title: "E",
      slug: `el-${n}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "P",
      basePrice: subtotal,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const startAt = new Date(Date.now() + 5 * 24 * 3600 * 1000)
  const avail = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      capacity: 5,
      remaining: 4,
    },
  })
  const booking = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status,
      total: subtotal,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId,
          quantity: 1,
          unitPrice: subtotal,
          subtotal,
          commissionAmount: commission,
          status: "CONFIRMED",
        },
      },
    },
    include: { items: true },
  })

  return booking.items[0]!.id
}

describe("vendor earnings (Postgres)", () => {
  it("a member sees gross, commission, refunds and net for their paid sales only (TC-E6S2-01)", async () => {
    const v = await vendorWithOwner()
    const paid = await saleFor(v.vendorId, "CONFIRMED", 1500, 150)
    await saleFor(v.vendorId, "PENDING", 9000, 900)
    await saleFor(v.vendorId, "CANCELLED", 7000, 700)
    await prisma.refund.create({
      data: { bookingItemId: paid, amount: 500, status: "succeeded" },
    })

    const e = await getVendorEarnings(
      { vendorId: v.vendorId },
      { session: v.session, db: prisma, memberships: undefined }
    )

    expect(e.totals).toEqual({
      gross: 1500,
      commission: 150,
      refunds: 500,
      net: 850,
    })
  })

  it("another vendor's sales are not counted", async () => {
    const mine = await vendorWithOwner()
    const other = await vendorWithOwner()
    await saleFor(other.vendorId, "CONFIRMED", 4000, 400)

    const e = await getVendorEarnings(
      { vendorId: mine.vendorId },
      { session: mine.session, db: prisma }
    )

    expect(e.totals.gross).toBe(0)
  })

  it("a vendor the caller does not belong to is not found, not shown as empty (TC-E6S2-02)", async () => {
    const mine = await vendorWithOwner()
    const other = await vendorWithOwner()

    await expect(
      getVendorEarnings(
        { vendorId: other.vendorId },
        { session: mine.session, db: prisma }
      )
    ).rejects.toThrow(NotFoundError)
  })
})
