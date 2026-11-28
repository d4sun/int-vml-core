import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  settlePendingTransfers,
  settleTransfer,
} from "@/lib/services/transfers"
import { FakeStripe } from "@/lib/stripe/fake"
import { handlePaymentSucceeded } from "@/lib/webhooks/payment-succeeded"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

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

async function vendor(
  name: string,
  opts: { status?: "APPROVED" | "SUSPENDED"; account?: string | null } = {}
) {
  seq += 1
  return prisma.vendor.create({
    data: {
      name,
      slug: `v-${seq}`,
      status: opts.status ?? "APPROVED",
      stripeOnboardingComplete: true,
      stripeAccountId:
        opts.account === undefined ? `acct_${seq}` : opts.account,
    },
  })
}

/** A confirmed-to-be multi-vendor booking with a pending payment. Returns ids for the test. */
async function bookingFor(
  vendors: {
    v: Awaited<ReturnType<typeof vendor>>
    subtotal: number
    commission: number
  }[]
) {
  seq += 1
  const user = await prisma.user.create({
    data: {
      email: `t${seq}@example.com`,
      name: "T",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${seq}`, slug: `c-${seq}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendors[0]!.v.id,
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
  const total = vendors.reduce((s, i) => s + i.subtotal, 0)
  const created: { avail: { id: string }; i: (typeof vendors)[number] }[] = []
  for (const i of vendors) {
    const startAt = new Date(
      Date.now() + 5 * 24 * 3600 * 1000 + created.length * 3600 * 1000
    )
    const avail = await prisma.availability.create({
      data: {
        productId: product.id,
        startAt,
        endAt: new Date(startAt.getTime() + 3600000),
        capacity: 5,
        remaining: 5,
      },
    })
    created.push({ avail, i })
  }
  const real = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status: "PENDING",
      total,
      items: {
        create: created.map(({ avail, i }) => ({
          productId: product.id,
          availabilityId: avail.id,
          vendorId: i.v.id,
          quantity: 1,
          unitPrice: i.subtotal,
          subtotal: i.subtotal,
          commissionAmount: i.commission,
        })),
      },
    },
  })
  const intentId = `pi_${seq}`
  await prisma.payment.create({
    data: {
      bookingId: real.id,
      stripePaymentIntentId: intentId,
      amount: total,
      status: "requires_payment_method",
      applicationFeeAmount: 0,
    },
  })
  return { bookingId: real.id, intentId, total }
}

async function confirm(b: {
  bookingId: string
  intentId: string
  total: number
}) {
  const signed = stripe.signedEvent({
    id: `evt_${++seq}`,
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
    handlers: { "payment_intent.succeeded": handlePaymentSucceeded },
    logger: { error() {} },
  })
}

describe("transfers to vendors (Postgres, fake Stripe)", () => {
  it("TC-E2S3-02 / IT-07: confirming a multi-vendor booking records one pending transfer per item, subtotal less commission", async () => {
    const a = await vendor("A")
    const b = await vendor("B")
    const booking = await bookingFor([
      { v: a, subtotal: 1000, commission: 100 },
      { v: b, subtotal: 2000, commission: 200 },
    ])

    await confirm(booking)

    const transfers = await prisma.transfer.findMany({
      orderBy: { amount: "asc" },
    })
    expect(transfers.map((t) => [t.amount, t.status])).toEqual([
      [900, "pending"],
      [1800, "pending"],
    ])
    expect(transfers.every((t) => t.stripeTransferId === null)).toBe(true)
    expect(stripe.calls.some((c) => c.method === "createTransfer")).toBe(false)
  })

  it("a single-vendor booking records no transfers (it is a destination charge)", async () => {
    const a = await vendor("A")
    const booking = await bookingFor([
      { v: a, subtotal: 1000, commission: 100 },
    ])

    await confirm(booking)

    expect(await prisma.transfer.count()).toBe(0)
  })

  it("settling sends each vendor its share, keyed to its transfer, and records the Stripe id", async () => {
    const a = await vendor("A")
    const b = await vendor("B")
    const booking = await bookingFor([
      { v: a, subtotal: 1000, commission: 100 },
      { v: b, subtotal: 2000, commission: 200 },
    ])
    await confirm(booking)

    const outcomes = await settlePendingTransfers(10, { db: prisma, stripe })

    expect(outcomes.every((o) => o.outcome === "created")).toBe(true)
    const sent = stripe.calls.filter((c) => c.method === "createTransfer")
    expect(
      sent
        .map(
          (c) =>
            (c.input as { destinationAccountId: string }).destinationAccountId
        )
        .sort()
    ).toEqual([a.stripeAccountId, b.stripeAccountId].sort())
    const rows = await prisma.transfer.findMany()
    expect(
      rows.every(
        (t) =>
          t.status === "created" && t.stripeTransferId?.startsWith("tr_fake_")
      )
    ).toBe(true)
  })

  it("TC-E2S3-05: when one transfer fails, the other still goes, the failure is recorded, and the booking stays paid", async () => {
    const a = await vendor("A")
    const b = await vendor("B")
    const booking = await bookingFor([
      { v: a, subtotal: 1000, commission: 100 },
      { v: b, subtotal: 2000, commission: 200 },
    ])
    await confirm(booking)
    stripe.failTransfersTo.add(b.stripeAccountId!)

    await settlePendingTransfers(10, { db: prisma, stripe })

    const failed = await prisma.transfer.findFirstOrThrow({
      where: { status: "failed" },
    })
    expect(failed.failureReason).toContain("declined")
    expect(await prisma.transfer.count({ where: { status: "created" } })).toBe(
      1
    )
    expect(
      (
        await prisma.booking.findUniqueOrThrow({
          where: { id: booking.bookingId },
        })
      ).status
    ).toBe("CONFIRMED")
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { bookingId: booking.bookingId },
        })
      ).status
    ).toBe("succeeded")
  })

  it("a transfer that has been sent is not sent again", async () => {
    const a = await vendor("A")
    const b = await vendor("B")
    const booking = await bookingFor([
      { v: a, subtotal: 1000, commission: 100 },
      { v: b, subtotal: 2000, commission: 200 },
    ])
    await confirm(booking)
    const first = await settlePendingTransfers(10, { db: prisma, stripe })
    const id = (await prisma.transfer.findFirstOrThrow()).id

    const again = await settleTransfer(id, { db: prisma, stripe })

    expect(first.length).toBe(2)
    expect(again.outcome).toBe("skipped")
    expect(
      stripe.calls.filter((c) => c.method === "createTransfer")
    ).toHaveLength(2)
  })

  it("a vendor that can no longer sell is not paid: the transfer fails with the reason and nothing is sent", async () => {
    const a = await vendor("A")
    const b = await vendor("B")
    const booking = await bookingFor([
      { v: a, subtotal: 1000, commission: 100 },
      { v: b, subtotal: 2000, commission: 200 },
    ])
    await confirm(booking)
    await prisma.vendor.update({
      where: { id: b.id },
      data: { status: "SUSPENDED" },
    })

    await settlePendingTransfers(10, { db: prisma, stripe })

    const blocked = await prisma.transfer.findFirstOrThrow({
      where: { status: "failed" },
    })
    expect(blocked.failureReason).toContain("NOT_PAYABLE")
    expect(
      stripe.calls
        .filter((c) => c.method === "createTransfer")
        .map(
          (c) =>
            (c.input as { destinationAccountId: string }).destinationAccountId
        )
    ).not.toContain(b.stripeAccountId)
  })
})
