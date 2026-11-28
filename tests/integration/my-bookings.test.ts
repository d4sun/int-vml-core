import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { NotFoundError } from "@/lib/errors"
import { getMyBooking, listMyBookings } from "@/lib/services/my-bookings"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let seq = 0
beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
})

async function visitor(email: string) {
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

/** A booking for a tourist, with one item per start time given. */
async function bookingFor(
  userId: string,
  starts: Date[],
  createdAt = new Date()
) {
  seq += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${seq}`,
      slug: `v-${seq}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
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
  const items = []
  for (const startAt of starts) {
    const avail = await prisma.availability.create({
      data: {
        productId: product.id,
        startAt,
        endAt: new Date(startAt.getTime() + 3600000),
        capacity: 5,
        remaining: 4,
      },
    })
    items.push({
      productId: product.id,
      availabilityId: avail.id,
      vendorId: vendor.id,
      quantity: 1,
      unitPrice: 1000,
      subtotal: 1000,
      commissionAmount: 100,
    })
  }
  const b = await prisma.booking.create({
    data: {
      touristUserId: userId,
      status: "CONFIRMED",
      total: 1000 * starts.length,
      items: { create: items },
    },
  })
  await prisma.booking.update({ where: { id: b.id }, data: { createdAt } })
  return b.id
}

const DAY = 24 * 60 * 60 * 1000

describe("my bookings (Postgres)", () => {
  it("TC-E3S1-01: a visitor sees only their own bookings, newest first, with items in start order", async () => {
    const olive = await visitor("olive@example.com")
    const sam = await visitor("sam@example.com")
    const older = await bookingFor(
      olive.id,
      [new Date(Date.now() + 9 * DAY)],
      new Date(Date.now() - DAY)
    )
    const newer = await bookingFor(olive.id, [
      new Date(Date.now() + 8 * DAY),
      new Date(Date.now() + 5 * DAY),
    ])
    await bookingFor(sam.id, [new Date(Date.now() + 7 * DAY)])

    const mine = await listMyBookings({
      session: olive.session as never,
      db: prisma,
    })

    expect(mine.map((b) => b.id)).toEqual([newer, older])
    expect(mine[0]!.items.map((i) => i.startAt.getTime())).toEqual(
      [...mine[0]!.items.map((i) => i.startAt.getTime())].sort((a, b) => a - b)
    )
  })

  it("another visitor's booking is not found, as a missing one is", async () => {
    const olive = await visitor("olive@example.com")
    const sam = await visitor("sam@example.com")
    const theirs = await bookingFor(sam.id, [new Date(Date.now() + 7 * DAY)])

    await expect(
      getMyBooking(theirs, { session: olive.session as never, db: prisma })
    ).rejects.toThrow(NotFoundError)
    await expect(
      getMyBooking("00000000-0000-0000-0000-000000000000", {
        session: olive.session as never,
        db: prisma,
      })
    ).rejects.toThrow(NotFoundError)
  })
})
