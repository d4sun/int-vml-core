import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  cancelExpiredBookings,
  PAYMENT_WINDOW_MINUTES,
} from "@/lib/services/booking-cleanup"
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

const OLD = new Date(Date.now() - (PAYMENT_WINDOW_MINUTES + 10) * 60 * 1000)

/** A booking of two places on one slot, with `left` places remaining on the slot. */
async function booking(
  opts: {
    status?: "PENDING" | "CONFIRMED"
    createdAt?: Date
    left?: number
  } = {}
) {
  seq += 1
  const user = await prisma.user.create({
    data: {
      email: `b${seq}@example.com`,
      name: "B",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${seq}`,
      slug: `v-${seq}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
      stripeAccountId: `acct_${seq}`,
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${seq}`, slug: `c-${seq}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `L${seq}`,
      slug: `l-${seq}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "P",
      basePrice: 1000,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const startAt = new Date(Date.now() + 5 * 24 * 3600 * 1000)
  const avail = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      capacity: 10,
      remaining: opts.left ?? 6,
    },
  })
  const b = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status: opts.status ?? "PENDING",
      total: 2000,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId: vendor.id,
          quantity: 2,
          unitPrice: 1000,
          subtotal: 2000,
          commissionAmount: 200,
        },
      },
    },
  })
  await prisma.booking.update({
    where: { id: b.id },
    data: { createdAt: opts.createdAt ?? OLD },
  })
  await prisma.payment.create({
    data: {
      bookingId: b.id,
      stripePaymentIntentId: `pi_${seq}`,
      amount: 2000,
      status: "requires_payment_method",
    },
  })
  return { bookingId: b.id, availabilityId: avail.id }
}

const remainingOf = async (id: string) =>
  (await prisma.availability.findUniqueOrThrow({ where: { id } })).remaining

describe("cancelling unpaid bookings (Postgres)", () => {
  it("TC-E2S3-04 / IT-10: a pending booking past its window is cancelled, its places come back, and its payment is closed", async () => {
    const b = await booking({ left: 6 })

    const result = await cancelExpiredBookings({ db: prisma })

    expect(result).toEqual({ cancelled: 1, placesReturned: 2 })
    expect(
      (
        await prisma.booking.findUniqueOrThrow({
          where: { id: b.bookingId },
          include: { items: true },
        })
      ).status
    ).toBe("CANCELLED")
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: b.bookingId },
      include: { items: true },
    })
    expect(row.items.every((i) => i.status === "CANCELLED")).toBe(true)
    expect(await remainingOf(b.availabilityId)).toBe(8)
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { bookingId: b.bookingId },
        })
      ).status
    ).toBe("cancelled")
  })

  it("a booking still inside its window is left alone", async () => {
    const b = await booking({ createdAt: new Date(), left: 6 })

    await cancelExpiredBookings({ db: prisma })

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("PENDING")
    expect(await remainingOf(b.availabilityId)).toBe(6)
  })

  it("a paid (confirmed) booking is never cancelled, however old", async () => {
    const b = await booking({ status: "CONFIRMED", left: 6 })

    await cancelExpiredBookings({ db: prisma })

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("CONFIRMED")
    expect(await remainingOf(b.availabilityId)).toBe(6)
  })

  it("a second sweep returns no places twice", async () => {
    const b = await booking({ left: 6 })

    await cancelExpiredBookings({ db: prisma })
    const second = await cancelExpiredBookings({ db: prisma })

    expect(second).toEqual({ cancelled: 0, placesReturned: 0 })
    expect(await remainingOf(b.availabilityId)).toBe(8)
  })
})
