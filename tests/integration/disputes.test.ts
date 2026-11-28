import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError } from "@/lib/errors"
import { listDisputes } from "@/lib/services/disputes"
import { FakeStripe } from "@/lib/stripe/fake"
import { handleDispute } from "@/lib/webhooks/dispute"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness
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
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
  stripe = new FakeStripe()
})

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  await prisma.user.update({ where: { email }, data: { platformRole, name } })

  return { session: await h.sessionFor(email, password) }
}

/** A confirmed one-item booking with a succeeded payment. Returns the booking and intent ids. */
async function paidBooking() {
  const user = await prisma.user.create({
    data: {
      email: `dp${Date.now()}@example.com`,
      name: "DP",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `DV${Date.now()}`,
      slug: `dv-${Date.now()}`,
      status: "APPROVED",
      stripeAccountId: `acct_dv${Date.now()}`,
    },
  })
  const category = await prisma.category.create({
    data: {
      name: `DC${Date.now()}`,
      slug: `dc-${Date.now()}`,
      type: "TIMED_SLOT",
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "D",
      slug: `dl-${Date.now()}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "P",
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
      touristUserId: user.id,
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
  })
  const intentId = `pi_dispute_${booking.id.slice(0, 8)}`
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: intentId,
      amount: 1500,
      status: "succeeded",
      applicationFeeAmount: 0,
    },
  })

  return { bookingId: booking.id, intentId }
}

function disputeEvent(
  intentId: string,
  disputeId: string,
  status: string,
  id?: string
) {
  eventNo += 1
  return stripe.signedEvent({
    id: id ?? `evt_dispute_${eventNo}`,
    type: "charge.dispute.created",
    created: Math.floor(Date.now() / 1000) + eventNo,
    data: {
      object: {
        id: disputeId,
        amount: 1500,
        reason: "fraudulent",
        status,
        payment_intent: intentId,
      },
    },
  })
}

const send = (ev: { rawBody: string; signature: string }) =>
  handleStripeWebhook(ev.rawBody, ev.signature, {
    stripe,
    db: prisma,
    handlers: {
      "charge.dispute.created": handleDispute,
      "charge.dispute.updated": handleDispute,
      "charge.dispute.closed": handleDispute,
    },
    logger: { error() {} },
  })

describe("disputes (Postgres, fake Stripe)", () => {
  it("a dispute is recorded against its payment, and the money and booking are left alone", async () => {
    const b = await paidBooking()

    const result = await send(
      disputeEvent(b.intentId, "dp_1", "needs_response")
    )

    expect(result.body).toMatchObject({ result: "processed" })
    const dispute = await prisma.dispute.findUniqueOrThrow({
      where: { stripeDisputeId: "dp_1" },
    })
    expect(dispute).toMatchObject({
      amount: 1500,
      status: "needs_response",
      reason: "fraudulent",
    })
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { stripePaymentIntentId: b.intentId },
        })
      ).status
    ).toBe("succeeded")
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("CONFIRMED")
    expect(
      await prisma.auditLog.count({ where: { action: "dispute.recorded" } })
    ).toBe(1)
  })

  it("a later update changes the status once, and a repeat of the same update changes nothing", async () => {
    const b = await paidBooking()
    await send(disputeEvent(b.intentId, "dp_2", "needs_response", "evt_d_a"))

    await send(disputeEvent(b.intentId, "dp_2", "won", "evt_d_b"))
    await send(disputeEvent(b.intentId, "dp_2", "won", "evt_d_c"))

    expect(
      (
        await prisma.dispute.findUniqueOrThrow({
          where: { stripeDisputeId: "dp_2" },
        })
      ).status
    ).toBe("won")
    expect(await prisma.dispute.count()).toBe(1)
    expect(
      await prisma.auditLog.count({ where: { action: "dispute.updated" } })
    ).toBe(1)
  })

  it("a dispute for a payment we have no record of is retried by Stripe, not dropped", async () => {
    const result = await send(
      disputeEvent("pi_unknown_dispute", "dp_3", "needs_response")
    )

    expect(result.status).toBe(500)
    expect(await prisma.dispute.count()).toBe(0)
  })

  it("only an admin sees the dispute list, and it names the booking", async () => {
    const admin = await account("ADMIN", "Admin")
    const tourist = await account("TOURIST", "Tourist")
    const b = await paidBooking()
    await send(disputeEvent(b.intentId, "dp_4", "needs_response"))

    const listed = await listDisputes({ session: admin.session, db: prisma })

    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      stripeDisputeId: "dp_4",
      bookingId: b.bookingId,
    })
    await expect(
      listDisputes({ session: tourist.session, db: prisma })
    ).rejects.toThrow(ForbiddenError)
  })
})
