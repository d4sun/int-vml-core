import type { PrismaClient, PlatformRole } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors"
import { requestRefund } from "@/lib/services/refund"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness

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

let n = 0
/** A booking item with the given status and subtotal (pence). */
async function bookingItem(
  status: "PENDING" | "CONFIRMED" | "FULFILLED",
  subtotal = 1000
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: { name: `V${n}`, slug: `v-${n}`, status: "APPROVED" },
  })
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `L${n}`,
      slug: `l-${n}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Slot",
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
  const tourist = await prisma.user.create({
    data: {
      email: `t${n}@example.com`,
      name: "T",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const booking = await prisma.booking.create({
    data: {
      touristUserId: tourist.id,
      status: status === "PENDING" ? "PENDING" : "CONFIRMED",
      total: subtotal,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId: vendor.id,
          quantity: 1,
          unitPrice: subtotal,
          subtotal,
          commissionAmount: subtotal / 10,
          status,
        },
      },
    },
    include: { items: true },
  })

  return booking.items[0]!.id
}

describe("requesting a refund (Postgres)", () => {
  it("an admin's partial refund is stored as pending, leaves the rest refundable, and is audited", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await bookingItem("CONFIRMED", 1000)

    const result = await requestRefund(
      { bookingItemId: itemId, amount: 400, reason: "Vendor cancelled" },
      { session: admin.session, db: prisma }
    )

    expect(result).toMatchObject({ amount: 400, remaining: 600 })
    const row = await prisma.refund.findUniqueOrThrow({
      where: { id: result.id },
    })
    expect(row).toMatchObject({
      amount: 400,
      status: "pending",
      reason: "Vendor cancelled",
    })
    expect(
      await prisma.auditLog.count({ where: { action: "refund.requested" } })
    ).toBe(1)
  })

  it("a tourist cannot request a refund and nothing is recorded", async () => {
    const tourist = await account("TOURIST", "Tourist")
    const itemId = await bookingItem("CONFIRMED")

    await expect(
      requestRefund(
        { bookingItemId: itemId, amount: 100 },
        { session: tourist.session, db: prisma }
      )
    ).rejects.toThrow(ForbiddenError)
    expect(await prisma.refund.count()).toBe(0)
  })

  it("refunds cannot add up to more than the item's subtotal", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await bookingItem("CONFIRMED", 1000)
    await requestRefund(
      { bookingItemId: itemId, amount: 600 },
      { session: admin.session, db: prisma }
    )

    const error = await requestRefund(
      { bookingItemId: itemId, amount: 500 },
      { session: admin.session, db: prisma }
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "EXCEEDS_REMAINING",
      remaining: 400,
    })
    expect(await prisma.refund.count()).toBe(1)
  })

  it("a refund that failed gives its amount back to the refundable total", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await bookingItem("CONFIRMED", 1000)
    const first = await requestRefund(
      { bookingItemId: itemId, amount: 1000 },
      { session: admin.session, db: prisma }
    )
    await prisma.refund.update({
      where: { id: first.id },
      data: { status: "failed" },
    })

    const again = await requestRefund(
      { bookingItemId: itemId, amount: 1000 },
      { session: admin.session, db: prisma }
    )

    expect(again.remaining).toBe(0)
  })

  it("an item that was never paid for cannot be refunded", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await bookingItem("PENDING")

    const error = await requestRefund(
      { bookingItemId: itemId, amount: 100 },
      { session: admin.session, db: prisma }
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "NOT_REFUNDABLE",
    })
  })

  it("an unknown booking item is not found", async () => {
    const admin = await account("ADMIN", "Admin")

    await expect(
      requestRefund(
        { bookingItemId: "00000000-0000-4000-8000-000000000000", amount: 100 },
        { session: admin.session, db: prisma }
      )
    ).rejects.toThrow(NotFoundError)
  })

  it("two refunds for the same money at once: only one fits and is stored", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await bookingItem("CONFIRMED", 1000)

    const results = await Promise.allSettled([
      requestRefund(
        { bookingItemId: itemId, amount: 600 },
        { session: admin.session, db: prisma }
      ),
      requestRefund(
        { bookingItemId: itemId, amount: 600 },
        { session: admin.session, db: prisma }
      ),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await prisma.refund.count()).toBe(1)
  })
})
