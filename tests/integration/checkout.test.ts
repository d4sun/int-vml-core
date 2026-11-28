import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors"
import { checkout } from "@/lib/services/checkout"
import { placeHold } from "@/lib/services/hold"
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
async function slot(
  opts: {
    basePrice?: number
    priceOverride?: number | null
    categoryDefault?: number
    vendorOverride?: number | null
    onboarded?: boolean
    startAt?: Date
    cutoffHours?: number
    capacity?: number
  } = {}
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}`,
      status: "APPROVED",
      stripeOnboardingComplete: opts.onboarded ?? true,
      commissionBpsOverride: opts.vendorOverride ?? null,
    },
  })
  const category = await prisma.category.create({
    data: {
      name: `C${n}`,
      slug: `c-${n}`,
      type: "TIMED_SLOT",
      commissionBpsDefault: opts.categoryDefault ?? 1000,
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `Walk ${n}`,
      slug: `walk-${n}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Morning",
      basePrice: opts.basePrice ?? 1000,
      policy: {
        cancelWindowHours: 24,
        bookingCutoffHours: opts.cutoffHours ?? 2,
      },
    },
  })
  const startAt = opts.startAt ?? new Date(NOW.getTime() + 5 * HOUR)
  const availability = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + HOUR),
      capacity: opts.capacity ?? 10,
      remaining: opts.capacity ?? 10,
      priceOverride: opts.priceOverride ?? null,
    },
  })
  return {
    availabilityId: availability.id,
    vendorId: vendor.id,
    productId: product.id,
  }
}

const remainingOf = async (id: string) =>
  (await prisma.availability.findUniqueOrThrow({ where: { id } })).remaining

async function hold(
  u: { session: () => Promise<unknown> },
  availabilityId: string,
  quantity = 1
) {
  return placeHold(
    { availabilityId, quantity },
    { session: u.session as never, db: prisma, now: () => NOW }
  )
}

const co = (
  u: { session: () => Promise<unknown> },
  holdIds: string[],
  deps: Record<string, unknown> = {}
) =>
  checkout(
    { holdIds },
    { session: u.session as never, db: prisma, now: () => NOW, ...deps }
  )

describe("checkout: cart to pending booking (Postgres)", () => {
  it("TC-E2S2-06 and IT-19: the total and the vendor come from the database, and a sent total is refused", async () => {
    const u = await tourist("olive@example.com")
    const a = await slot({ basePrice: 1000 })
    const b = await slot({ basePrice: 500, priceOverride: 750 })
    const h1 = await hold(u, a.availabilityId, 2)
    const h2 = await hold(u, b.availabilityId, 1)

    const result = await co(u, [h1.id, h2.id])

    expect(result.total).toBe(2000 + 750)
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: result.bookingId },
      include: { items: true },
    })
    expect(booking.status).toBe("PENDING")
    expect(booking.total).toBe(2750)
    const vendors = booking.items.map((i) => i.vendorId).sort()
    expect(vendors).toEqual([a.vendorId, b.vendorId].sort())
    await expect(
      checkout(
        { holdIds: [h1.id], total: 1 },
        { session: u.session as never, db: prisma }
      )
    ).rejects.toThrow(ValidationError)
    await expect(
      checkout(
        { holdIds: [h1.id], vendorId: a.vendorId },
        { session: u.session as never, db: prisma }
      )
    ).rejects.toThrow(ValidationError)
  })

  it("each item's commission is the rate in force: vendor override first, then the category default", async () => {
    const u = await tourist("olive@example.com")
    const withOverride = await slot({
      basePrice: 1000,
      vendorOverride: 1500,
      categoryDefault: 1000,
    })
    const byCategory = await slot({ basePrice: 1000, categoryDefault: 2000 })
    const h1 = await hold(u, withOverride.availabilityId, 1)
    const h2 = await hold(u, byCategory.availabilityId, 1)

    const result = await co(u, [h1.id, h2.id])

    const byVendor = new Map(
      result.items.map((i) => [i.vendorId, i.commissionAmount])
    )
    expect(byVendor.get(withOverride.vendorId)).toBe(150)
    expect(byVendor.get(byCategory.vendorId)).toBe(200)
  })

  it("TC-E2S2-03: a vendor that is not onboarded blocks the checkout, with the reason, and nothing is booked", async () => {
    const u = await tourist("olive@example.com")
    const ok = await slot()
    const blocked = await slot({ onboarded: false })
    const h1 = await hold(u, ok.availabilityId, 1)
    const h2 = await hold(u, blocked.availabilityId, 1)

    const error = await co(u, [h1.id, h2.id]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ForbiddenError)
    expect((error as ForbiddenError).details).toMatchObject({
      reason: "NOT_ONBOARDED",
    })
    expect(await prisma.booking.count()).toBe(0)
    expect(await prisma.hold.count()).toBe(2)
  })

  it("TC-E2S2-04: an expired hold whose places are still held is taken again, with a fresh window", async () => {
    const u = await tourist("olive@example.com")
    const a = await slot()
    const h = await hold(u, a.availabilityId, 1)

    const later = new Date(NOW.getTime() + 11 * 60 * 1000)
    const result = await checkout(
      { holdIds: [h.id] },
      { session: u.session as never, db: prisma, now: () => later }
    )

    expect(result.reheld).toBe(1)
    expect(await prisma.booking.count()).toBe(1)
  })

  it("TC-E2S2-04: an expired hold that was already released is not in the cart any more", async () => {
    const u = await tourist("olive@example.com")
    const a = await slot()
    const h = await hold(u, a.availabilityId, 1)
    await prisma.hold.delete({ where: { id: h.id } })
    await prisma.availability.update({
      where: { id: a.availabilityId },
      data: { remaining: 10 },
    })

    await expect(co(u, [h.id])).rejects.toThrow(NotFoundError)
  })

  it("IT-04: if one item cannot be written, nothing is booked and the holds and places are unchanged", async () => {
    const u = await tourist("olive@example.com")
    const a = await slot({ capacity: 5 })
    const b = await slot({ capacity: 5 })
    const h1 = await hold(u, a.availabilityId, 2)
    const h2 = await hold(u, b.availabilityId, 2)
    const before = await remainingOf(a.availabilityId)

    await expect(
      co(u, [h1.id, h2.id], {
        beforeItemWrite: (index: number) => {
          if (index === 1) throw new Error("simulated write failure")
        },
      })
    ).rejects.toThrow("simulated write failure")

    expect(await prisma.booking.count()).toBe(0)
    expect(await prisma.bookingItem.count()).toBe(0)
    expect(await prisma.hold.count()).toBe(2)
    expect(await remainingOf(a.availabilityId)).toBe(before)
  })

  it("a hold that belongs to someone else is not in your cart", async () => {
    const owner = await tourist("owner@example.com")
    const other = await tourist("other@example.com")
    const a = await slot()
    const h = await hold(owner, a.availabilityId, 1)

    await expect(co(other, [h.id])).rejects.toThrow(NotFoundError)
    expect(await prisma.booking.count()).toBe(0)
  })

  it("a slot inside its booking cutoff by checkout time is refused", async () => {
    const u = await tourist("olive@example.com")
    const soon = await slot({
      startAt: new Date(NOW.getTime() + 3 * HOUR),
      cutoffHours: 2,
    })
    const h = await hold(u, soon.availabilityId, 1)

    // Checkout an hour later: the slot now starts inside its 2-hour cutoff.
    const error = await co(u, [h.id], {
      now: () => new Date(NOW.getTime() + 1.5 * HOUR),
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "PAST_CUTOFF",
    })
  })

  it("on success the holds are removed and the places stay taken by the booking", async () => {
    const u = await tourist("olive@example.com")
    const a = await slot({ capacity: 4 })
    const h = await hold(u, a.availabilityId, 3)

    await co(u, [h.id])

    expect(await prisma.hold.count()).toBe(0)
    expect(await remainingOf(a.availabilityId)).toBe(1)
  })
})
