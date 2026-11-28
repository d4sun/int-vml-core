import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { ConflictError, NotFoundError } from "@/lib/errors"
import { startPayment } from "@/lib/services/payment"
import { FakeStripe } from "@/lib/stripe/fake"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { TEST_APP_URL } from "../helpers/recording-transactional-queue"

let prisma: PrismaClient
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
/** A vendor with a connected account, and one product with one slot. */
async function vendorAndSlot(
  opts: { stripeAccountId?: string | null; commission?: number } = {}
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
      stripeAccountId:
        opts.stripeAccountId === undefined ? `acct_${n}` : opts.stripeAccountId,
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `W${n}`,
      slug: `w-${n}`,
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
  const startAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  const avail = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      capacity: 9,
      remaining: 9,
    },
  })
  return {
    vendorId: vendor.id,
    productId: product.id,
    availabilityId: avail.id,
    commission: opts.commission ?? 100,
  }
}

/** A pending booking with one item per (vendor, subtotal, commission) given. */
async function pendingBooking(
  userId: string,
  items: {
    v: Awaited<ReturnType<typeof vendorAndSlot>>
    subtotal: number
    commission: number
  }[]
) {
  const total = items.reduce((s, i) => s + i.subtotal, 0)
  return prisma.booking.create({
    data: {
      touristUserId: userId,
      status: "PENDING",
      total,
      items: {
        create: items.map((i) => ({
          productId: i.v.productId,
          availabilityId: i.v.availabilityId,
          vendorId: i.v.vendorId,
          quantity: 1,
          unitPrice: i.subtotal,
          subtotal: i.subtotal,
          commissionAmount: i.commission,
        })),
      },
    },
  })
}

describe("starting a payment (Postgres, fake Stripe)", () => {
  it("TC-E2S2-01: a single-vendor booking is a destination charge with the commission as the fee", async () => {
    const u = await tourist("olive@example.com")
    const v = await vendorAndSlot({ stripeAccountId: "acct_single" })
    const booking = await pendingBooking(u.id, [
      { v, subtotal: 1000, commission: 100 },
    ])
    const stripe = new FakeStripe()

    const started = await startPayment(booking.id, 1, {
      session: u.session as never,
      db: prisma,
      stripe,
      appUrl: TEST_APP_URL,
    })

    expect(started.plan.mode).toBe("DESTINATION")
    const call = stripe.calls.find((c) => c.method === "createCheckoutSession")!
    expect(call.input).toMatchObject({
      amount: 1000,
      destinationAccountId: "acct_single",
      applicationFeeAmount: 100,
    })
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: booking.id },
    })
    expect(payment.amount).toBe(1000)
    expect(payment.applicationFeeAmount).toBe(100)
  })

  it("TC-E2S2-02: a two-vendor booking is one platform charge, with transfers planned per vendor", async () => {
    const u = await tourist("olive@example.com")
    const a = await vendorAndSlot({ stripeAccountId: "acct_a" })
    const b = await vendorAndSlot({ stripeAccountId: "acct_b" })
    const booking = await pendingBooking(u.id, [
      { v: a, subtotal: 1000, commission: 100 },
      { v: b, subtotal: 2000, commission: 200 },
    ])
    const stripe = new FakeStripe()

    const started = await startPayment(booking.id, 1, {
      session: u.session as never,
      db: prisma,
      stripe,
      appUrl: TEST_APP_URL,
    })

    expect(started.plan.mode).toBe("PLATFORM")
    expect(
      started.plan.transfers.map((t) => t.amount).sort((x, y) => x - y)
    ).toEqual([900, 1800])
    const call = stripe.calls.find((c) => c.method === "createCheckoutSession")!
    expect(call.input).toMatchObject({
      amount: 3000,
      transferGroup: `booking:${booking.id}`,
    })
    expect(
      (call.input as { destinationAccountId?: string }).destinationAccountId
    ).toBeUndefined()
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: booking.id },
    })
    expect(payment.applicationFeeAmount).toBe(0)
  })

  it("TC-E2S2-05: a repeated submit creates one payment and one intent", async () => {
    const u = await tourist("olive@example.com")
    const v = await vendorAndSlot()
    const booking = await pendingBooking(u.id, [
      { v, subtotal: 1000, commission: 100 },
    ])
    const stripe = new FakeStripe()
    const deps = {
      session: u.session as never,
      db: prisma,
      stripe,
      appUrl: TEST_APP_URL,
    }

    const first = await startPayment(booking.id, 1, deps)
    const second = await startPayment(booking.id, 1, deps)

    expect(second.checkoutSessionId).toBe(first.checkoutSessionId)
    expect(
      await prisma.payment.count({ where: { bookingId: booking.id } })
    ).toBe(1)
    // Stripe was asked exactly once: the second submit never reaches it.
    expect(
      stripe.calls.filter((c) => c.method === "createCheckoutSession")
    ).toHaveLength(1)

    // A retry under a new attempt number still does not create a second intent.
    await startPayment(booking.id, 2, deps)
    expect(
      stripe.calls.filter((c) => c.method === "createCheckoutSession")
    ).toHaveLength(1)
  })

  it("a booking that is not the visitor's is not found", async () => {
    const owner = await tourist("owner@example.com")
    const other = await tourist("other@example.com")
    const v = await vendorAndSlot()
    const booking = await pendingBooking(owner.id, [
      { v, subtotal: 1000, commission: 100 },
    ])

    await expect(
      startPayment(booking.id, 1, {
        session: other.session as never,
        db: prisma,
        stripe: new FakeStripe(),
      })
    ).rejects.toThrow(NotFoundError)
  })

  it("a vendor with no connected account blocks the charge, and nothing is recorded", async () => {
    const u = await tourist("olive@example.com")
    const v = await vendorAndSlot({ stripeAccountId: null })
    const booking = await pendingBooking(u.id, [
      { v, subtotal: 1000, commission: 100 },
    ])
    const stripe = new FakeStripe()

    const error = await startPayment(booking.id, 1, {
      session: u.session as never,
      db: prisma,
      stripe,
      appUrl: TEST_APP_URL,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "VENDOR_NOT_PAYABLE",
    })
    expect(stripe.calls.length).toBe(0)
    expect(await prisma.payment.count()).toBe(0)
  })

  it("a booking that is no longer pending cannot be paid", async () => {
    const u = await tourist("olive@example.com")
    const v = await vendorAndSlot()
    const booking = await pendingBooking(u.id, [
      { v, subtotal: 1000, commission: 100 },
    ])
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED" },
    })

    await expect(
      startPayment(booking.id, 1, {
        session: u.session as never,
        db: prisma,
        stripe: new FakeStripe(),
      })
    ).rejects.toThrow(ConflictError)
  })
})
