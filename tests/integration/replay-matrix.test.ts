import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { startPayment } from "@/lib/services/payment"
import { FakeStripe } from "@/lib/stripe/fake"
import { paymentSucceededHandler } from "@/lib/webhooks/payment-succeeded"
import {
  RecordingTransactionalQueue,
  TEST_APP_URL,
} from "../helpers/recording-transactional-queue"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

/**
 * E2-S3-05: the replay matrix. Stripe may deliver events out of order, more
 * than once, or with unrelated types in between. Each row below is one
 * sequence; the outcome must be the same as if it had arrived once, in order.
 */

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

/** One PENDING booking for one vendor with its payment already started. */
async function pendingBooking() {
  const suffix = Math.random().toString(36).slice(2)
  const user = await prisma.user.create({
    data: {
      email: `visitor-${suffix}@example.com`,
      name: "V",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: "Vendor",
      slug: `v-${suffix}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
      stripeAccountId: `acct_${suffix}`,
    },
  })
  const category = await prisma.category.create({
    data: { name: "C", slug: `c-${suffix}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "L",
      slug: `l-${suffix}`,
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
  const startAt = new Date(Date.now() + 5 * 24 * 3600 * 1000)
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
      touristUserId: user.id,
      status: "PENDING",
      total: 1000,
      items: {
        create: {
          productId: product.id,
          availabilityId: avail.id,
          vendorId: vendor.id,
          quantity: 1,
          unitPrice: 1000,
          subtotal: 1000,
          commissionAmount: 100,
        },
      },
    },
  })

  await startPayment(booking.id, 1, {
    session: async () => ({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true,
        platformRole: "TOURIST",
      },
    }),
    db: prisma,
    stripe,
    appUrl: TEST_APP_URL,
  })

  const intentId = `pi_matrix_${booking.id.slice(0, 8)}`
  await prisma.payment.update({
    where: { bookingId: booking.id },
    data: { stripePaymentIntentId: intentId },
  })

  return { bookingId: booking.id, intentId }
}

function signed(
  id: string,
  type: string,
  intentId: string,
  bookingId: string,
  amount = 1000
) {
  eventNo += 1
  return stripe.signedEvent({
    id,
    type,
    created: Math.floor(Date.now() / 1000) + eventNo,
    data: { object: { id: intentId, amount, metadata: { bookingId } } },
  })
}

const deliver = (ev: { rawBody: string; signature: string }) =>
  handleStripeWebhook(ev.rawBody, ev.signature, {
    stripe,
    db: prisma,
    handlers: {
      "payment_intent.succeeded": paymentSucceededHandler({
        emailQueue: new RecordingTransactionalQueue(),
        appUrl: TEST_APP_URL,
      }),
    },
    logger: { error() {} },
  })

const statusOf = async (bookingId: string) =>
  (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status

describe("replay matrix (Postgres, fake Stripe)", () => {
  it("failed then succeeded: the failure is acknowledged and ignored, then the success confirms", async () => {
    const { bookingId, intentId } = await pendingBooking()

    const failed = await deliver(
      signed("evt_m1", "payment_intent.payment_failed", intentId, bookingId)
    )
    expect(failed.body).toMatchObject({ result: "ignored" })
    expect(await statusOf(bookingId)).toBe("PENDING")

    const succeeded = await deliver(
      signed("evt_m2", "payment_intent.succeeded", intentId, bookingId)
    )
    expect(succeeded.body).toMatchObject({ result: "processed" })
    expect(await statusOf(bookingId)).toBe("CONFIRMED")
  })

  it("succeeded then failed (a late, out-of-order failure): the booking stays confirmed", async () => {
    const { bookingId, intentId } = await pendingBooking()

    await deliver(
      signed("evt_m3", "payment_intent.succeeded", intentId, bookingId)
    )
    await deliver(
      signed("evt_m4", "payment_intent.payment_failed", intentId, bookingId)
    )

    expect(await statusOf(bookingId)).toBe("CONFIRMED")
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId } })).status
    ).toBe("succeeded")
  })

  it("succeeded, failed, succeeded again: confirmed once, with one payment row and no second change", async () => {
    const { bookingId, intentId } = await pendingBooking()

    await deliver(
      signed("evt_m5", "payment_intent.succeeded", intentId, bookingId)
    )
    await deliver(
      signed("evt_m6", "payment_intent.payment_failed", intentId, bookingId)
    )
    const again = await deliver(
      signed("evt_m7", "payment_intent.succeeded", intentId, bookingId)
    )

    expect(again.body).toMatchObject({ result: "processed" })
    expect(await statusOf(bookingId)).toBe("CONFIRMED")
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: {
          action: {
            in: ["payment.amount_mismatch", "booking.paid_after_close"],
          },
        },
      })
    ).toBe(0)
  })

  it("the same success delivered three times: processed once, duplicates change nothing", async () => {
    const { bookingId, intentId } = await pendingBooking()
    const ev = signed("evt_m8", "payment_intent.succeeded", intentId, bookingId)

    const results = [await deliver(ev), await deliver(ev), await deliver(ev)]

    expect(
      results.map((r) => ("result" in r.body ? r.body.result : r.body))
    ).toEqual(["processed", "duplicate", "duplicate"])
    expect(await statusOf(bookingId)).toBe("CONFIRMED")
  })
})
