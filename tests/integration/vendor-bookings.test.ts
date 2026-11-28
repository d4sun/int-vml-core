import {
  PrismaClient,
  type BookingItemStatus,
  type VendorRole,
} from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { ConflictError, NotFoundError } from "@/lib/errors"
import {
  listVendorBookings,
  markFulfilled,
  markNoShow,
} from "@/lib/services/vendor-bookings"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let seq = 0
const PAST = new Date(Date.now() - 2 * 60 * 60 * 1000)
const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
})

async function person(email: string) {
  const u = await prisma.user.create({
    data: { email, name: email, emailVerified: true, platformRole: "VENDOR" },
  })
  return {
    id: u.id,
    session: async () => ({
      user: {
        id: u.id,
        email,
        name: email,
        emailVerified: true,
        platformRole: "VENDOR",
      },
    }),
  }
}

/** A vendor with one OWNER and one STAFF member (the given users), and a listing to book. */
async function vendorWith(members: { id: string; role: VendorRole }[]) {
  seq += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${seq}`,
      slug: `v-${seq}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
      members: { create: members.map((m) => ({ userId: m.id, role: m.role })) },
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${seq}`, slug: `c-${seq}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `Walk ${seq}`,
      slug: `w-${seq}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Morning",
      basePrice: 1000,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  return { vendorId: vendor.id, productId: product.id }
}

/** A booking item for a vendor, in the given status, starting at `startAt`. */
async function item(
  v: { vendorId: string; productId: string },
  status: BookingItemStatus,
  startAt: Date,
  guestId: string
) {
  const avail = await prisma.availability.create({
    data: {
      productId: v.productId,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      capacity: 5,
      remaining: 5,
    },
  })
  const booking = await prisma.booking.create({
    data: {
      touristUserId: guestId,
      status: "CONFIRMED",
      total: 1000,
      items: {
        create: {
          productId: v.productId,
          availabilityId: avail.id,
          vendorId: v.vendorId,
          quantity: 1,
          unitPrice: 1000,
          subtotal: 1000,
          commissionAmount: 100,
          status,
        },
      },
    },
    include: { items: true },
  })
  return booking.items[0]!.id
}

describe("vendor bookings (Postgres)", () => {
  it("TC-E6S1-01: a confirmed item is fulfilled, with fulfilledAt set", async () => {
    const owner = await person("owner@example.com")
    const guest = await person("guest@example.com")
    const v = await vendorWith([{ id: owner.id, role: "OWNER" }])
    const id = await item(v, "CONFIRMED", PAST, guest.id)

    await markFulfilled(id, { session: owner.session as never, db: prisma })

    const row = await prisma.bookingItem.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe("FULFILLED")
    expect(row.fulfilledAt).not.toBeNull()
  })

  it("TC-E6S1-02: a refunded item cannot be fulfilled, and nothing changes", async () => {
    const owner = await person("owner@example.com")
    const guest = await person("guest@example.com")
    const v = await vendorWith([{ id: owner.id, role: "OWNER" }])
    const id = await item(v, "REFUNDED", PAST, guest.id)

    await expect(
      markFulfilled(id, { session: owner.session as never, db: prisma })
    ).rejects.toThrow(ConflictError)
    expect(
      (await prisma.bookingItem.findUniqueOrThrow({ where: { id } })).status
    ).toBe("REFUNDED")
  })

  it("TC-E6S1-03 / IT-18: another vendor's booking is not listed, and cannot be acted on; it looks like a missing one", async () => {
    const ownerA = await person("a@example.com")
    const ownerB = await person("b@example.com")
    const guest = await person("guest@example.com")
    const a = await vendorWith([{ id: ownerA.id, role: "OWNER" }])
    const b = await vendorWith([{ id: ownerB.id, role: "OWNER" }])
    const theirs = await item(b, "CONFIRMED", PAST, guest.id)

    await expect(
      listVendorBookings(
        { vendorId: b.vendorId },
        { session: ownerA.session as never, db: prisma }
      )
    ).rejects.toThrow(NotFoundError)
    await expect(
      markFulfilled(theirs, { session: ownerA.session as never, db: prisma })
    ).rejects.toThrow(NotFoundError)
    await expect(
      markFulfilled("00000000-0000-0000-0000-000000000000", {
        session: ownerA.session as never,
        db: prisma,
      })
    ).rejects.toThrow(NotFoundError)
    expect(
      (await prisma.bookingItem.findUniqueOrThrow({ where: { id: theirs } }))
        .status
    ).toBe("CONFIRMED")
    expect(
      await listVendorBookings(
        { vendorId: a.vendorId },
        { session: ownerA.session as never, db: prisma }
      )
    ).toEqual([])
  })

  it("the list shows settled items only, soonest first, and can be filtered to a London day", async () => {
    const owner = await person("owner@example.com")
    const guest = await person("guest@example.com")
    const v = await vendorWith([{ id: owner.id, role: "OWNER" }])
    await item(
      v,
      "PENDING",
      new Date(FUTURE.getTime() + 60 * 60 * 1000),
      guest.id
    )
    const later = await item(
      v,
      "CONFIRMED",
      new Date(FUTURE.getTime() + 3 * 3600 * 1000),
      guest.id
    )
    const sooner = await item(v, "CONFIRMED", FUTURE, guest.id)

    const all = await listVendorBookings(
      { vendorId: v.vendorId },
      { session: owner.session as never, db: prisma }
    )
    expect(all.map((i) => i.id)).toEqual([sooner, later])

    const day = FUTURE.toISOString().slice(0, 10)
    const onDay = await listVendorBookings(
      { vendorId: v.vendorId, date: day },
      { session: owner.session as never, db: prisma }
    )
    expect(onDay.length).toBeGreaterThanOrEqual(1)
  })

  it("STAFF can act on the vendor's items too", async () => {
    const staff = await person("staff@example.com")
    const guest = await person("guest@example.com")
    const v = await vendorWith([{ id: staff.id, role: "STAFF" }])
    const id = await item(v, "CONFIRMED", PAST, guest.id)

    await markFulfilled(id, { session: staff.session as never, db: prisma })

    expect(
      (await prisma.bookingItem.findUniqueOrThrow({ where: { id } })).status
    ).toBe("FULFILLED")
  })

  it("a no-show cannot be recorded before the slot starts", async () => {
    const owner = await person("owner@example.com")
    const guest = await person("guest@example.com")
    const v = await vendorWith([{ id: owner.id, role: "OWNER" }])
    const id = await item(v, "CONFIRMED", FUTURE, guest.id)

    await expect(
      markNoShow(id, { session: owner.session as never, db: prisma })
    ).rejects.toThrow(ConflictError)
    expect(
      (await prisma.bookingItem.findUniqueOrThrow({ where: { id } })).status
    ).toBe("CONFIRMED")
  })
})
