import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { startPayment } from "@/lib/services/payment"
import { FakeStripe } from "@/lib/stripe/fake"
import { handlePaymentSucceeded } from "@/lib/webhooks/payment-succeeded"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { TEST_APP_URL } from "../helpers/recording-transactional-queue"

let prisma: PrismaClient
let stripe: FakeStripe
let eventNo = 0
beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
  stripe = new FakeStripe()
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

/** A pending booking for one vendor, with its payment started. Returns the intent id. */
async function pendingPaidBooking(userId: string, total = 1000) {
  const vendor = await prisma.vendor.create({
    data: {
      name: "V",
      slug: `v-${Math.random().toString(36).slice(2)}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
      stripeAccountId: "acct_x",
    },
  })
  const category = await prisma.category.create({
    data: {
      name: "C",
      slug: `c-${Math.random().toString(36).slice(2)}`,
      type: "TIMED_SLOT",
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "W",
      slug: `w-${Math.random().toString(36).slice(2)}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Slot",
      basePrice: total,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const startAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  const avail = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      capacity: 5,
      remaining: 5,
    },
  })
  const booking = await prisma.booking.create({
    data: {
      touristUserId: userId,
      status: "PENDING",
      total,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId: vendor.id,
          quantity: 1,
          unitPrice: total,
          subtotal: total,
          commissionAmount: 100,
        },
      },
    },
  })
  // The payment belongs to the booking's own visitor; start it as them.
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  await startPayment(booking.id, 1, {
    session: async () => ({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        emailVerified: true,
        platformRole: "TOURIST",
      },
    }),
    db: prisma,
    stripe,
    appUrl: TEST_APP_URL,
  })

  // Stripe creates the intent when the visitor pays; this fixture stands in for it.
  const intentId = `pi_test_${booking.id.slice(0, 8)}`
  await prisma.payment.update({
    where: { bookingId: booking.id },
    data: { stripePaymentIntentId: intentId },
  })

  return { bookingId: booking.id, intentId }
}

function event(
  intentId: string,
  amount: number,
  bookingId: string,
  id?: string
) {
  eventNo += 1
  return stripe.signedEvent({
    id: id ?? `evt_${eventNo}`,
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: intentId, amount, metadata: { bookingId } } },
  })
}

const send = (signed: { rawBody: string; signature: string }) =>
  handleStripeWebhook(signed.rawBody, signed.signature, {
    stripe,
    db: prisma,
    handlers: { "payment_intent.succeeded": handlePaymentSucceeded },
    logger: { error() {} },
  })

describe("payment succeeded webhook (Postgres, fake Stripe)", () => {
  it("TC-E2S3-01: the first success confirms the booking and its items, and marks the payment", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)

    const result = await send(event(intentId, 1000, bookingId))

    expect(result.status).toBe(200)
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { items: true },
    })
    expect(booking.status).toBe("CONFIRMED")
    expect(booking.items.every((i) => i.status === "CONFIRMED")).toBe(true)
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId } })).status
    ).toBe("succeeded")
  })

  it("IT-08 / TC-E2S3-02: the same event twice is processed once; the second is a duplicate and changes nothing", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)
    const signed = event(intentId, 1000, bookingId, "evt_same")

    const first = await send(signed)
    const second = await send(signed)

    expect(first.body).toMatchObject({ result: "processed" })
    expect(second.body).toMatchObject({ result: "duplicate" })
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("CONFIRMED")
  })

  it("TC-E2S3-03: confirmation needs no browser return; the webhook alone confirms", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)

    // No redirect, no page load: the event by itself is enough.
    await send(event(intentId, 1000, bookingId))

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("CONFIRMED")
  })

  it("E2-S3-05 / TC-E2S3-02: two different events saying the same payment succeeded change nothing the second time", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)

    const first = await send(event(intentId, 1000, bookingId, "evt_a"))
    const second = await send(event(intentId, 1000, bookingId, "evt_b"))

    expect(first.body).toMatchObject({ result: "processed" })
    expect(second.body).toMatchObject({ result: "processed" })
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("CONFIRMED")
    // The second event is not treated as a payment for a closed booking.
    expect(
      await prisma.auditLog.count({
        where: { action: "booking.paid_after_close" },
      })
    ).toBe(0)
  })

  it("an amount that is not what was asked for is flagged and does not confirm", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)

    await send(event(intentId, 999, bookingId))

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("PENDING")
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId } })).status
    ).toBe("amount_mismatch")
    expect(
      await prisma.auditLog.count({
        where: { action: "payment.amount_mismatch" },
      })
    ).toBe(1)
  })

  it("a payment that arrives after its booking was cancelled is logged for review, not confirmed", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    })

    await send(event(intentId, 1000, bookingId))

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("CANCELLED")
    expect(
      await prisma.auditLog.count({
        where: { action: "booking.paid_after_close" },
      })
    ).toBe(1)
  })

  it("a success for a payment we have no record of is retried by Stripe, not dropped", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId } = await pendingPaidBooking(u.id)

    const result = await send(event("pi_unknown_123", 1000, bookingId))

    expect(result.status).toBe(500)
  })

  it("TC-E2S3-06: a bad signature changes nothing", async () => {
    const u = await tourist("olive@example.com")
    const { bookingId, intentId } = await pendingPaidBooking(u.id)
    const signed = event(intentId, 1000, bookingId)

    const result = await handleStripeWebhook(signed.rawBody, "t=1,v1=bad", {
      stripe,
      db: prisma,
      handlers: { "payment_intent.succeeded": handlePaymentSucceeded },
      logger: { error() {} },
    })

    expect(result.status).toBe(400)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("PENDING")
  })
})
