import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { placeHold } from "@/lib/services/hold"
import { releaseHold } from "@/lib/services/hold-release"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let userId: string
let slotId: string
const MIN = 60 * 1000
const NOW = new Date("2030-06-01T10:00:00Z")

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  const u = await prisma.user.create({
    data: {
      email: "holder@example.com",
      name: "Olive",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  userId = u.id
  const vendor = await prisma.vendor.create({
    data: {
      name: "V",
      slug: "v",
      status: "APPROVED",
      stripeOnboardingComplete: true,
    },
  })
  const category = await prisma.category.create({
    data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Walk",
      slug: "walk",
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Slot",
      basePrice: 1000,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const availability = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt: new Date(NOW.getTime() + 5 * 60 * MIN),
      endAt: new Date(NOW.getTime() + 6 * 60 * MIN),
      capacity: 5,
      remaining: 5,
    },
  })
  slotId = availability.id
})

const session = async () => ({
  user: {
    id: userId,
    email: "holder@example.com",
    name: "Olive",
    emailVerified: true,
    platformRole: "TOURIST",
  },
})

const remaining = async () =>
  (await prisma.availability.findUniqueOrThrow({ where: { id: slotId } }))
    .remaining

async function holdTwo(): Promise<string> {
  const hold = await placeHold(
    { availabilityId: slotId, quantity: 2 },
    { session, db: prisma, now: () => NOW }
  )

  return hold.id
}

describe("releasing an expired hold (Postgres)", () => {
  it("TC-E2S1-03: a hold is not released before its ten minutes are up", async () => {
    const holdId = await holdTwo()

    const outcome = await releaseHold(holdId, {
      db: prisma,
      now: () => new Date(NOW.getTime() + 9 * MIN),
    })

    expect(outcome).toEqual({ released: false, reason: "NOT_EXPIRED" })
    expect(await remaining()).toBe(3)
    expect(await prisma.hold.count({ where: { id: holdId } })).toBe(1)
  })

  it("IT-02: once the ten minutes have passed, the places come back and the hold is gone", async () => {
    const holdId = await holdTwo()

    const outcome = await releaseHold(holdId, {
      db: prisma,
      now: () => new Date(NOW.getTime() + 11 * MIN),
    })

    expect(outcome).toEqual({ released: true, places: 2 })
    expect(await remaining()).toBe(5)
    expect(await prisma.hold.count({ where: { id: holdId } })).toBe(0)
  })

  it("releasing twice returns the places once, never twice", async () => {
    const holdId = await holdTwo()
    const later = () => new Date(NOW.getTime() + 11 * MIN)

    await releaseHold(holdId, { db: prisma, now: later })
    const second = await releaseHold(holdId, { db: prisma, now: later })

    expect(second).toEqual({ released: false, reason: "NOT_FOUND" })
    expect(await remaining()).toBe(5)
  })

  it("a job for a hold that no longer exists does nothing", async () => {
    expect(
      await releaseHold("00000000-0000-0000-0000-000000000000", {
        db: prisma,
        now: () => NOW,
      })
    ).toEqual({ released: false, reason: "NOT_FOUND" })
    expect(await remaining()).toBe(5)
  })
})
