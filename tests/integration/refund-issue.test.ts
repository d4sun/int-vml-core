import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import { getBookingForAdmin } from "@/lib/services/admin-bookings"
import { issueRefund } from "@/lib/services/refund-issue"
import { FakeStripe } from "@/lib/stripe/fake"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness
let stripe: FakeStripe
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
  stripe = new FakeStripe()
})

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  await prisma.user.update({ where: { email }, data: { platformRole, name } })

  return { session: await h.sessionFor(email, password) }
}

/** A confirmed one-item booking of £15.00 with a payment, for a visitor. */
async function confirmedBooking() {
  n += 1
  const tourist = await prisma.user.create({
    data: {
      email: `ti${n}@example.com`,
      name: "Ti",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `Vi${n}`,
      slug: `vi-${n}`,
      status: "APPROVED",
      stripeAccountId: `acct_i${n}`,
    },
  })
  const category = await prisma.category.create({
    data: { name: `Ci${n}`, slug: `ci-${n}`, type: "TIMED_SLOT" },
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
      name: "Slot",
      basePrice: 1500,
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
      touristUserId: tourist.id,
      status: "CONFIRMED",
      total: 1500,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId: vendor.id,
          quantity: 1,
          unitPrice: 1500,
          subtotal: 1500,
          commissionAmount: 150,
          status: "CONFIRMED",
        },
      },
    },
    include: { items: true },
  })
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: `pi_i${n}`,
      amount: 1500,
      status: "succeeded",
      applicationFeeAmount: 150,
    },
  })

  return { bookingId: booking.id, itemId: booking.items[0]!.id }
}

describe("an admin's refund, end to end (Postgres, fake Stripe)", () => {
  it("an admin's partial refund is recorded, sent to Stripe, and left for the webhook to confirm", async () => {
    const admin = await account("ADMIN", "Admin")
    const b = await confirmedBooking()

    const issued = await issueRefund(
      { bookingItemId: b.itemId, amount: 500, reason: "Weather" },
      { session: admin.session, db: prisma, stripe }
    )

    expect(issued.settlement.outcome).toBe("refunded")
    const row = await prisma.refund.findUniqueOrThrow({
      where: { id: issued.refund.id },
    })
    expect(row).toMatchObject({ status: "pending", amount: 500 })
    expect(row.stripeRefundId).toMatch(/^re_fake_/)
    // The booking is not marked refunded until the webhook says so.
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("CONFIRMED")
  })

  it("a tourist cannot issue a refund, and Stripe is not called", async () => {
    const tourist = await account("TOURIST", "Tourist")
    const b = await confirmedBooking()

    await expect(
      issueRefund(
        { bookingItemId: b.itemId, amount: 500 },
        { session: tourist.session, db: prisma, stripe }
      )
    ).rejects.toThrow(ForbiddenError)
    expect(stripe.calls).toHaveLength(0)
  })

  it("the admin's booking view shows what is still refundable and every refund", async () => {
    const admin = await account("ADMIN", "Admin")
    const b = await confirmedBooking()
    await issueRefund(
      { bookingItemId: b.itemId, amount: 500 },
      { session: admin.session, db: prisma, stripe }
    )

    const view = await getBookingForAdmin(b.bookingId, {
      session: admin.session,
      db: prisma,
    })

    expect(view.items[0]).toMatchObject({ subtotal: 1500, refundable: 1000 })
    expect(view.refunds.map((r) => [r.amount, r.status])).toEqual([
      [500, "pending"],
    ])
    expect(view.tourist.email).toMatch(/^ti\d+@example.com$/)
  })

  it("the booking view is for admins only, and an unknown booking is not found", async () => {
    const tourist = await account("TOURIST", "Tourist")
    const admin = await account("ADMIN", "Admin")
    const b = await confirmedBooking()

    await expect(
      getBookingForAdmin(b.bookingId, { session: tourist.session, db: prisma })
    ).rejects.toThrow(ForbiddenError)
    await expect(
      getBookingForAdmin("00000000-0000-4000-8000-000000000000", {
        session: admin.session,
        db: prisma,
      })
    ).rejects.toThrow(NotFoundError)
  })
})
