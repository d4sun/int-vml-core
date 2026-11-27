import { PrismaClient, type PlatformRole } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors"
import { placeHold } from "@/lib/services/hold"
import {
  createTestPrismaClient,
  testDatabaseUrl,
  truncatePublicSchema,
} from "../helpers/db"

let prisma: PrismaClient
let slotId: string
let userId: string
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
  userId = (await user("TOURIST")).id
  slotId = await slot({
    remaining: 3,
    startAt: new Date(NOW.getTime() + 5 * HOUR),
  })
})

async function user(platformRole: PlatformRole) {
  return prisma.user.create({
    data: {
      email: `u-${Math.random().toString(36).slice(2)}@example.com`,
      name: "Olive",
      emailVerified: true,
      platformRole,
    },
  })
}

async function slot(opts: {
  remaining: number
  startAt: Date
  closed?: boolean
  active?: boolean
  cutoffHours?: number
}) {
  const vendor = await prisma.vendor.create({
    data: {
      name: "V",
      slug: `v-${Math.random().toString(36).slice(2)}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
    },
  })
  const category = await prisma.category.create({
    data: {
      name: "Tours",
      slug: `t-${Math.random().toString(36).slice(2)}`,
      type: "TIMED_SLOT",
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Walk",
      slug: `w-${Math.random().toString(36).slice(2)}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Slot",
      basePrice: 1000,
      active: opts.active ?? true,
      policy: {
        cancelWindowHours: 24,
        bookingCutoffHours: opts.cutoffHours ?? 2,
      },
    },
  })
  const availability = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt: opts.startAt,
      endAt: new Date(opts.startAt.getTime() + HOUR),
      capacity: 10,
      remaining: opts.remaining,
      closed: opts.closed ?? false,
    },
  })

  return availability.id
}

const asUser = (id: string) => async () => ({
  user: {
    id,
    email: "x@example.com",
    name: "X",
    emailVerified: true,
    platformRole: "TOURIST",
  },
})

const remainingOf = async (id: string) =>
  (await prisma.availability.findUniqueOrThrow({ where: { id } })).remaining

const holdsOf = (id: string) =>
  prisma.hold.count({ where: { availabilityId: id } })

const place = (quantity: number, id = slotId) =>
  placeHold(
    { availabilityId: id, quantity },
    { session: asUser(userId), db: prisma, now: () => NOW }
  )

describe("placing a hold (Postgres)", () => {
  it("TC-E2S1-01: a hold within the places left is created, takes the places, and expires in ten minutes", async () => {
    const hold = await place(2)

    expect(await remainingOf(slotId)).toBe(1)
    expect(await holdsOf(slotId)).toBe(1)
    expect(hold.expiresAt.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000)
  })

  it("TC-E2S1-02: asking for more than is left is refused, with the count, and changes nothing", async () => {
    const error = await place(4).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "NOT_ENOUGH",
      remaining: 3,
    })
    expect(await remainingOf(slotId)).toBe(3)
    expect(await holdsOf(slotId)).toBe(0)
  })

  it("IT-01: two holds on the last place, at the same time, give exactly one success and no negative capacity", async () => {
    const last = await slot({
      remaining: 1,
      startAt: new Date(NOW.getTime() + 5 * HOUR),
    })
    // A pool of several connections, so the two holds really run at once.
    const pooled = new PrismaClient({
      datasourceUrl: testDatabaseUrl().replace(
        "connection_limit=1",
        "connection_limit=5"
      ),
    })
    const second = await user("TOURIST")

    try {
      const attempt = (who: string) =>
        placeHold(
          { availabilityId: last, quantity: 1 },
          { session: asUser(who), db: pooled, now: () => NOW }
        ).then(
          () => "ok" as const,
          () => "refused" as const
        )

      const results = await Promise.all([attempt(userId), attempt(second.id)])

      expect(results.filter((r) => r === "ok")).toHaveLength(1)
      expect(await remainingOf(last)).toBe(0)
      expect(await holdsOf(last)).toBe(1)
    } finally {
      await pooled.$disconnect()
    }
  })

  it("the database refuses a negative capacity even if the service were wrong", async () => {
    await expect(
      prisma.availability.update({
        where: { id: slotId },
        data: { remaining: -1 },
      })
    ).rejects.toThrow()
  })

  it("a sold-out slot is refused with a clear reason", async () => {
    const empty = await slot({
      remaining: 0,
      startAt: new Date(NOW.getTime() + 5 * HOUR),
    })

    expect(
      (await place(1, empty).catch((e: unknown) => e)) as ConflictError
    ).toMatchObject({
      details: { reason: "NOT_ENOUGH" },
    })
  })

  it("a closed slot and a slot of an inactive product are refused", async () => {
    const closed = await slot({
      remaining: 3,
      startAt: new Date(NOW.getTime() + 5 * HOUR),
      closed: true,
    })
    const inactive = await slot({
      remaining: 3,
      startAt: new Date(NOW.getTime() + 5 * HOUR),
      active: false,
    })

    expect(
      (await place(1, closed).catch((e: unknown) => e)) as ConflictError
    ).toMatchObject({
      details: { reason: "CLOSED" },
    })
    expect(
      (await place(1, inactive).catch((e: unknown) => e)) as ConflictError
    ).toMatchObject({
      details: { reason: "CLOSED" },
    })
  })

  it("a slot inside the booking cutoff is refused", async () => {
    const soon = await slot({
      remaining: 3,
      startAt: new Date(NOW.getTime() + 1 * HOUR),
      cutoffHours: 2,
    })

    expect(
      (await place(1, soon).catch((e: unknown) => e)) as ConflictError
    ).toMatchObject({
      details: { reason: "PAST_CUTOFF" },
    })
  })

  it("an unknown slot is not found, and a bad quantity is a validation error before anything is read", async () => {
    await expect(
      place(1, "00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(NotFoundError)
    await expect(place(0)).rejects.toThrow(ValidationError)
  })
})
