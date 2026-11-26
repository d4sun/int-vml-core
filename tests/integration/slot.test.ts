import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  createSlots,
  deleteSlot,
  listSlots,
  setSlotClosed,
  updateSlot,
} from "@/lib/services/slot"
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

const NOW = new Date("2026-10-01T09:00:00Z")

async function user(platformRole: PlatformRole = "VENDOR") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

let n = 0
async function setup(
  options: {
    listingStatus?: "DRAFT" | "PENDING_REVIEW"
    vendorStatus?: "APPROVED" | "SUSPENDED"
  } = {}
) {
  n += 1

  const owner = await user()
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}-${Date.now()}`, type: "TIMED_SLOT" },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}-${Date.now()}`,
      status: options.vendorStatus ?? "APPROVED",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Walk",
      slug: `walk-${n}-${Date.now()}`,
      status: options.listingStatus ?? "DRAFT",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Ticket",
      basePrice: 2500,
      policy: {},
    },
  })

  return {
    owner,
    vendor,
    listing,
    product,
    deps: { session: owner.session, db: prisma, now: () => NOW },
  }
}

type S = Awaited<ReturnType<typeof setup>>

const weekly = (over: Record<string, unknown> = {}) => ({
  kind: "weekly",
  startDate: "2026-10-03",
  weekdays: ["SAT"],
  count: 8,
  startTime: "10:00",
  durationMinutes: 120,
  capacity: 20,
  ...over,
})

const single = (date: string, over: Record<string, unknown> = {}) => ({
  kind: "single",
  date,
  startTime: "10:00",
  durationMinutes: 120,
  capacity: 20,
  ...over,
})

const make = (s: S, rule: unknown) =>
  createSlots({ productId: s.product.id, rule }, s.deps)
const rows = (s: S) =>
  prisma.availability.findMany({
    where: { productId: s.product.id },
    orderBy: { startAt: "asc" },
  })

async function book(s: S, slotId: string, quantity = 1) {
  const tourist = await user("TOURIST")

  await prisma.availability.update({
    where: { id: slotId },
    data: { remaining: { decrement: quantity } },
  })
  await prisma.booking.create({
    data: {
      touristUserId: tourist.id,
      total: 2500,
      items: {
        create: {
          productId: s.product.id,
          availabilityId: slotId,
          vendorId: s.vendor.id,
          quantity,
          unitPrice: 2500,
          subtotal: 2500 * quantity,
          commissionAmount: 250,
        },
      },
    },
  })
}

describe("creating slots on Postgres", () => {
  it("TC-E5S2-01: every Saturday x8, capacity 20 makes 8 slots with 20 places left, at 10:00 London", async () => {
    const s = await setup()
    const result = await make(s, weekly())

    expect(result).toMatchObject({
      created: 8,
      merged: 0,
      skippedPast: 0,
      overlapping: [],
    })

    const slots = await rows(s)

    expect(slots).toHaveLength(8)
    expect(
      slots.every(
        (x) =>
          x.capacity === 20 &&
          x.remaining === 20 &&
          !x.closed &&
          x.priceOverride === null
      )
    ).toBe(true)
    // BST before 25 October, GMT after.
    expect(slots.map((x) => x.startAt.toISOString().slice(0, 16))).toEqual([
      "2026-10-03T09:00",
      "2026-10-10T09:00",
      "2026-10-17T09:00",
      "2026-10-24T09:00",
      "2026-10-31T10:00",
      "2026-11-07T10:00",
      "2026-11-14T10:00",
      "2026-11-21T10:00",
    ])
  })

  it("repeating the same request creates nothing new: the existing slots are merged and untouched", async () => {
    const s = await setup()

    await make(s, weekly())

    const first = await rows(s)

    await prisma.availability.update({
      where: { id: first[0]!.id },
      data: { priceOverride: 3000 },
    })

    const again = await make(s, weekly({ count: 10 }))

    expect(again).toMatchObject({ created: 2, merged: 8 })
    expect(await prisma.availability.count()).toBe(10)
    expect(
      (
        await prisma.availability.findUniqueOrThrow({
          where: { id: first[0]!.id },
        })
      ).priceOverride
    ).toBe(3000)
  })

  it("a new slot that overlaps a different existing slot is created and reported", async () => {
    const s = await setup()

    await make(
      s,
      single("2026-10-10", { startTime: "10:00", durationMinutes: 120 })
    )

    const result = await make(
      s,
      single("2026-10-10", { startTime: "11:00", durationMinutes: 120 })
    )

    expect(result.created).toBe(1)
    expect(result.overlapping.map((d) => d.toISOString())).toEqual([
      "2026-10-10T10:00:00.000Z",
    ])
    expect(await prisma.availability.count()).toBe(2)
  })

  it("slots in the past are skipped, and a rule made only of past times is refused", async () => {
    const s = await setup()
    const result = await make(s, weekly({ startDate: "2026-09-19", count: 4 }))

    expect(result).toMatchObject({ created: 2, skippedPast: 2 })
    expect((await rows(s)).every((x) => x.startAt > NOW)).toBe(true)

    await expect(make(s, single("2026-09-01"))).rejects.toBeInstanceOf(
      ValidationError
    )
  })

  it("two simultaneous identical requests leave one set of slots", async () => {
    const s = await setup()

    await Promise.all([make(s, weekly()), make(s, weekly())])

    expect(await prisma.availability.count()).toBe(8)
  })

  it("the database itself refuses two slots at one start time", async () => {
    const s = await setup()
    const data = {
      productId: s.product.id,
      startAt: new Date("2026-12-01T10:00:00Z"),
      endAt: new Date("2026-12-01T12:00:00Z"),
      capacity: 5,
      remaining: 5,
    }

    await prisma.availability.create({ data })
    await expect(prisma.availability.create({ data })).rejects.toThrow()
  })

  it("a bad rule is a ValidationError and creates nothing", async () => {
    const s = await setup()

    for (const rule of [
      weekly({ capacity: 0 }),
      weekly({ weekdays: [] }),
      { kind: "monthly" },
      null,
    ]) {
      await expect(make(s, rule)).rejects.toBeInstanceOf(ValidationError)
    }

    expect(await prisma.availability.count()).toBe(0)
  })
})

describe("editing, closing and deleting slots on Postgres", () => {
  it("TC-E5S2-05: a per-slot price override can be set and removed, within the price bounds", async () => {
    const s = await setup()

    await make(s, single("2026-10-10"))

    const [slot] = await rows(s)

    expect(
      (await updateSlot({ id: slot!.id, priceOverride: 3500 }, s.deps))
        .priceOverride
    ).toBe(3500)
    expect(
      (await prisma.availability.findUniqueOrThrow({ where: { id: slot!.id } }))
        .priceOverride
    ).toBe(3500)

    for (const bad of [10, 1_000_001, 35.5, "3500"]) {
      await expect(
        updateSlot({ id: slot!.id, priceOverride: bad }, s.deps)
      ).rejects.toBeInstanceOf(ValidationError)
    }

    expect(
      (await updateSlot({ id: slot!.id, priceOverride: null }, s.deps))
        .priceOverride
    ).toBeNull()
  })

  it("capacity follows the places already taken: it cannot drop below them, and places left adjust", async () => {
    const s = await setup()

    await make(s, single("2026-10-10"))

    const [slot] = await rows(s)

    await book(s, slot!.id, 6)

    const error = await updateSlot({ id: slot!.id, capacity: 5 }, s.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "BELOW_COMMITTED",
      committed: 6,
    })

    const grown = await updateSlot({ id: slot!.id, capacity: 30 }, s.deps)

    expect(grown).toMatchObject({ capacity: 30, remaining: 24, committed: 6 })
    expect(
      await updateSlot({ id: slot!.id, capacity: 6 }, s.deps)
    ).toMatchObject({ remaining: 0 })
  })

  it("TC-E5S2-03: a slot that has already started is read-only", async () => {
    const s = await setup()
    const past = await prisma.availability.create({
      data: {
        productId: s.product.id,
        startAt: new Date("2026-09-30T10:00:00Z"),
        endAt: new Date("2026-09-30T12:00:00Z"),
        capacity: 10,
        remaining: 10,
      },
    })

    for (const attempt of [
      () => updateSlot({ id: past.id, capacity: 5 }, s.deps),
      () => updateSlot({ id: past.id, priceOverride: 3000 }, s.deps),
      () => setSlotClosed({ id: past.id, closed: true }, s.deps),
      () => deleteSlot({ id: past.id }, s.deps),
    ]) {
      const error = await attempt().catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).details).toEqual({ reason: "PAST_SLOT" })
    }

    expect(
      await prisma.availability.findUniqueOrThrow({ where: { id: past.id } })
    ).toMatchObject({
      capacity: 10,
      closed: false,
      priceOverride: null,
    })
  })

  it("a slot that starts exactly now counts as started", async () => {
    const s = await setup()
    const edge = await prisma.availability.create({
      data: {
        productId: s.product.id,
        startAt: NOW,
        endAt: new Date(NOW.getTime() + 3_600_000),
        capacity: 5,
        remaining: 5,
      },
    })

    await expect(
      updateSlot({ id: edge.id, capacity: 6 }, s.deps)
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("closing and reopening a future slot, with bookings left as they are", async () => {
    const s = await setup()

    await make(s, single("2026-10-10"))

    const [slot] = await rows(s)

    await book(s, slot!.id, 2)

    expect(
      (await setSlotClosed({ id: slot!.id, closed: true }, s.deps)).closed
    ).toBe(true)
    expect(
      (await prisma.availability.findUniqueOrThrow({ where: { id: slot!.id } }))
        .remaining
    ).toBe(18)
    expect(await prisma.bookingItem.count()).toBe(1)
    expect(
      (await setSlotClosed({ id: slot!.id, closed: true }, s.deps)).closed
    ).toBe(true)
    expect(
      (await setSlotClosed({ id: slot!.id, closed: false }, s.deps)).closed
    ).toBe(false)
  })

  it("TC-E5S2-02: a slot with bookings cannot be deleted, only closed; an empty one can", async () => {
    const s = await setup()

    await make(s, weekly({ count: 2 }))

    const [booked, empty] = await rows(s)

    await book(s, booked!.id)

    const error = await deleteSlot({ id: booked!.id }, s.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "HAS_BOOKINGS",
      bookings: 1,
    })
    expect(
      await prisma.availability.findUnique({ where: { id: booked!.id } })
    ).not.toBeNull()
    expect(
      (await setSlotClosed({ id: booked!.id, closed: true }, s.deps)).closed
    ).toBe(true)

    await deleteSlot({ id: empty!.id }, s.deps)
    expect(
      await prisma.availability.findUnique({ where: { id: empty!.id } })
    ).toBeNull()
  })

  it("a slot is protected whichever record shows the places are taken: a booking row, or only the places counter", async () => {
    const s = await setup()

    await make(s, weekly({ count: 2 }))

    const [withItem, withCounter] = await rows(s)
    const tourist = await user("TOURIST")

    // A booking row whose counter was not touched.
    await prisma.booking.create({
      data: {
        touristUserId: tourist.id,
        total: 2500,
        items: {
          create: {
            productId: s.product.id,
            availabilityId: withItem!.id,
            vendorId: s.vendor.id,
            quantity: 1,
            unitPrice: 2500,
            subtotal: 2500,
            commissionAmount: 250,
          },
        },
      },
    })
    // Places taken with no booking row at all (for example reserved elsewhere).
    await prisma.availability.update({
      where: { id: withCounter!.id },
      data: { remaining: { decrement: 3 } },
    })

    await expect(
      deleteSlot({ id: withItem!.id }, s.deps)
    ).rejects.toMatchObject({ details: { reason: "HAS_BOOKINGS" } })
    await expect(
      deleteSlot({ id: withCounter!.id }, s.deps)
    ).rejects.toMatchObject({ details: { reason: "HAS_BOOKINGS" } })
    expect(await prisma.availability.count()).toBe(2)
  })

  it("a slot with a live hold cannot be deleted; an expired hold does not block it", async () => {
    const s = await setup()

    await make(s, weekly({ count: 2 }))

    const [held, expired] = await rows(s)
    const tourist = await user("TOURIST")

    await prisma.hold.create({
      data: {
        availabilityId: held!.id,
        userId: tourist.id,
        quantity: 1,
        expiresAt: new Date(NOW.getTime() + 600_000),
      },
    })
    await prisma.hold.create({
      data: {
        availabilityId: expired!.id,
        userId: tourist.id,
        quantity: 1,
        expiresAt: new Date(NOW.getTime() - 1000),
      },
    })

    await expect(deleteSlot({ id: held!.id }, s.deps)).rejects.toMatchObject({
      details: { reason: "HAS_HOLDS" },
    })
    await deleteSlot({ id: expired!.id }, s.deps)
  })

  it("lists upcoming slots in order, with places taken, and past ones only when asked", async () => {
    const s = await setup()

    await make(s, weekly({ count: 3 }))
    await prisma.availability.create({
      data: {
        productId: s.product.id,
        startAt: new Date("2026-09-20T10:00:00Z"),
        endAt: new Date("2026-09-20T12:00:00Z"),
        capacity: 4,
        remaining: 1,
      },
    })

    const upcoming = await listSlots({ productId: s.product.id }, s.deps)

    expect(upcoming).toHaveLength(3)
    expect(upcoming.every((x) => !x.past)).toBe(true)

    const all = await listSlots(
      { productId: s.product.id, includePast: true },
      s.deps
    )

    expect(all).toHaveLength(4)
    expect(all[0]).toMatchObject({ past: true, committed: 3 })
  })

  it("another vendor cannot create, list, edit, close or delete, and a missing slot looks the same", async () => {
    const s = await setup()
    const rival = await setup()

    await make(s, single("2026-10-10"))

    const [slot] = await rows(s)
    const theirs = rival.deps

    await expect(
      createSlots(
        { productId: s.product.id, rule: single("2026-10-11") },
        theirs
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      listSlots({ productId: s.product.id }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      updateSlot({ id: slot!.id, capacity: 1 }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      setSlotClosed({ id: slot!.id, closed: true }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteSlot({ id: slot!.id }, theirs)).rejects.toBeInstanceOf(
      ForbiddenError
    )
    await expect(
      updateSlot(
        { id: "00000000-0000-0000-0000-000000000000", capacity: 1 },
        theirs
      )
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(
      await prisma.availability.findUniqueOrThrow({ where: { id: slot!.id } })
    ).toMatchObject({ capacity: 20, closed: false })
    expect(await prisma.availability.count()).toBe(1)
  })

  it("a listing under review and a suspended vendor are frozen for slots", async () => {
    const review = await setup({ listingStatus: "PENDING_REVIEW" })

    await expect(make(review, single("2026-10-10"))).rejects.toBeInstanceOf(
      ConflictError
    )

    const suspended = await setup({ vendorStatus: "SUSPENDED" })

    await expect(make(suspended, single("2026-10-10"))).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it("the status, closed flag and remaining cannot be set by the client", async () => {
    const s = await setup()

    await make(s, single("2026-10-10"))

    const [slot] = await rows(s)

    for (const extra of [
      { remaining: 99 },
      { closed: true },
      { productId: "x" },
      { startAt: "2027-01-01T00:00:00Z" },
    ]) {
      await expect(
        updateSlot({ id: slot!.id, capacity: 10, ...extra }, s.deps)
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })
})
