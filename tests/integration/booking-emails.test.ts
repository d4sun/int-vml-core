import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { FakeStripe } from "@/lib/stripe/fake"
import { paymentSucceededHandler } from "@/lib/webhooks/payment-succeeded"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import {
  RecordingTransactionalQueue,
  TEST_APP_URL,
} from "../helpers/recording-transactional-queue"

let prisma: PrismaClient
let stripe: FakeStripe
let seq = 0
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

/** A booking across the given vendors, each with the given owner emails, with a pending payment. */
async function bookingAcross(
  vendors: { owners: string[]; subtotal: number }[]
) {
  seq += 1
  const user = await prisma.user.create({
    data: {
      email: `olive${seq}@example.com`,
      name: "Olive",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${seq}`, slug: `c-${seq}`, type: "TIMED_SLOT" },
  })
  const items = []
  for (const [i, v] of vendors.entries()) {
    const vendor = await prisma.vendor.create({
      data: {
        name: `Vendor ${seq}-${i}`,
        slug: `v-${seq}-${i}`,
        status: "APPROVED",
        stripeOnboardingComplete: true,
        stripeAccountId: `acct_${seq}_${i}`,
      },
    })
    for (const email of v.owners) {
      const owner = await prisma.user.create({
        data: {
          email,
          name: email.split("@")[0]!,
          emailVerified: true,
          platformRole: "VENDOR",
        },
      })
      await prisma.vendorMember.create({
        data: { userId: owner.id, vendorId: vendor.id, role: "OWNER" },
      })
    }
    const listing = await prisma.listing.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        title: `Walk ${seq}-${i}`,
        slug: `l-${seq}-${i}`,
        status: "PUBLISHED",
      },
    })
    const product = await prisma.product.create({
      data: {
        listingId: listing.id,
        name: "Morning",
        basePrice: v.subtotal,
        policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
      },
    })
    const startAt = new Date(Date.now() + (5 + i) * 24 * 3600 * 1000)
    const avail = await prisma.availability.create({
      data: {
        productId: product.id,
        startAt,
        endAt: new Date(startAt.getTime() + 3600000),
        capacity: 5,
        remaining: 5,
      },
    })
    items.push({
      productId: product.id,
      availabilityId: avail.id,
      vendorId: vendor.id,
      quantity: 1,
      unitPrice: v.subtotal,
      subtotal: v.subtotal,
      commissionAmount: 0,
    })
  }
  const total = vendors.reduce((s, v) => s + v.subtotal, 0)
  const booking = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status: "PENDING",
      total,
      items: { create: items },
    },
  })
  const intentId = `pi_${seq}`
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: intentId,
      amount: total,
      status: "requires_payment_method",
      applicationFeeAmount: 0,
    },
  })
  return { bookingId: booking.id, intentId, total, touristEmail: user.email }
}

function confirm(
  b: { bookingId: string; intentId: string; total: number },
  queue: RecordingTransactionalQueue,
  eventId = `evt_${++seq}`
) {
  const signed = stripe.signedEvent({
    id: eventId,
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: b.intentId,
        amount: b.total,
        metadata: { bookingId: b.bookingId },
      },
    },
  })
  return handleStripeWebhook(signed.rawBody, signed.signature, {
    stripe,
    db: prisma,
    handlers: {
      "payment_intent.succeeded": paymentSucceededHandler({
        emailQueue: queue,
        appUrl: TEST_APP_URL,
      }),
    },
    logger: { error() {} },
  })
}

describe("booking emails (Postgres)", () => {
  it("the tourist gets one confirmation and each vendor owner gets one new-booking notice", async () => {
    const b = await bookingAcross([
      { owners: ["owner-a@example.com"], subtotal: 1000 },
      {
        owners: ["owner-b@example.com", "second-b@example.com"],
        subtotal: 2000,
      },
    ])
    const queue = new RecordingTransactionalQueue()

    await confirm(b, queue)

    const kinds = queue.messages.map((m) => [m.to, m.tags?.kind]).sort()
    expect(kinds).toEqual(
      [
        [b.touristEmail, "booking-confirmed"],
        ["owner-a@example.com", "new-booking"],
        ["owner-b@example.com", "new-booking"],
        ["second-b@example.com", "new-booking"],
      ].sort()
    )
  })

  it("a repeated success adds no further emails", async () => {
    const b = await bookingAcross([
      { owners: ["owner-a@example.com"], subtotal: 1000 },
    ])
    const queue = new RecordingTransactionalQueue()

    await confirm(b, queue, "evt_one")
    const after = queue.messages.length
    await confirm(b, queue, "evt_two")

    expect(queue.messages.length).toBe(after)
  })

  it("CR-7: if the email cannot be queued, the confirmation is rolled back and the booking stays pending", async () => {
    const b = await bookingAcross([
      { owners: ["owner-a@example.com"], subtotal: 1000 },
    ])
    const broken = {
      async enqueueInTransaction(): Promise<boolean> {
        throw new Error("queue down")
      },
    }

    const result = await confirm(b, broken as never)

    expect(result.status).toBe(500)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("PENDING")
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { bookingId: b.bookingId },
        })
      ).status
    ).not.toBe("succeeded")
  })
})
