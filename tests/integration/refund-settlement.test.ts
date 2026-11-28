import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { settleRefund } from "@/lib/services/refund-settlement"
import { FakeStripe } from "@/lib/stripe/fake"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
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
  stripe = new FakeStripe()
})

type Line = {
  subtotal: number
  commission: number
  /** Whether the vendor's transfer was sent; false leaves it pending. */
  sent?: boolean
}

/**
 * A paid booking with one item per line, a payment intent, and (for each line
 * with `sent`) a created transfer. Returns the first item's id and the refund.
 */
async function paidBooking(lines: Line[]) {
  n += 1
  const user = await prisma.user.create({
    data: {
      email: `s${n}@example.com`,
      name: "S",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  const vendors: { id: string }[] = []
  for (const [i] of lines.entries()) {
    vendors.push(
      await prisma.vendor.create({
        data: {
          name: `V${n}-${i}`,
          slug: `v-${n}-${i}`,
          status: "APPROVED",
          stripeAccountId: `acct_${n}_${i}`,
        },
      })
    )
  }
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendors[0]!.id,
      categoryId: category.id,
      title: `L${n}`,
      slug: `l-${n}`,
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
  const total = lines.reduce((s, l) => s + l.subtotal, 0)
  const avails: string[] = []
  for (const [i] of lines.entries()) {
    const startAt = new Date(Date.now() + (5 + i) * 24 * 3600 * 1000)
    const row = await prisma.availability.create({
      data: {
        productId: product.id,
        startAt,
        endAt: new Date(startAt.getTime() + 3600000),
        capacity: 5,
        remaining: 4,
      },
    })
    avails.push(row.id)
  }
  const booking = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status: "CONFIRMED",
      total,
      items: {
        create: lines.map((line, i) => ({
          productId: product.id,
          availabilityId: avails[i]!,
          vendorId: vendors[i]!.id,
          quantity: 1,
          unitPrice: line.subtotal,
          subtotal: line.subtotal,
          commissionAmount: line.commission,
          status: "CONFIRMED",
        })),
      },
    },
    include: { items: true },
  })
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: `pi_${n}`,
      amount: total,
      status: "succeeded",
      applicationFeeAmount: 0,
    },
  })
  // Transfers are created at confirmation, one per item on a platform charge.
  for (const [i, item] of booking.items.entries()) {
    if (lines.length > 1 && lines[i]!.sent) {
      await prisma.transfer.create({
        data: {
          bookingItemId: item.id,
          amount: item.subtotal - item.commissionAmount,
          status: "created",
          stripeTransferId: `tr_${n}_${i}`,
        },
      })
    }
  }

  return { item: booking.items[0]!, booking }
}

/** A paid booking and a pending refund on its first item. Returns the refund id. */
async function refundFor(lines: Line[], amount: number) {
  const { item } = await paidBooking(lines)
  const refund = await prisma.refund.create({
    data: { bookingItemId: item.id, amount, status: "pending" },
  })

  return refund.id
}

const count = (method: string) =>
  stripe.calls.filter((c) => c.method === method).length

describe("settling a refund with Stripe (Postgres, fake Stripe)", () => {
  it("a platform charge: one refund, and the vendor's share reversed less the commission part", async () => {
    const refundId = await refundFor(
      [
        { subtotal: 1000, commission: 100, sent: true },
        { subtotal: 2000, commission: 200, sent: true },
      ],
      600
    )

    const result = await settleRefund(refundId, { db: prisma, stripe })

    expect(result.outcome).toBe("refunded")
    expect(count("createRefund")).toBe(1)
    const reversal = stripe.calls.find((c) => c.method === "reverseTransfer")!
    // 600 refunded; 60 of it is the commission (10% of 600), so the vendor gives back 540.
    expect(reversal.input).toMatchObject({ amount: 540 })
    const row = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    })
    expect(row).toMatchObject({ status: "succeeded" })
    expect(row.stripeRefundId).toMatch(/^re_fake_/)
    expect(row.transferReversalId).toMatch(/^trr_fake_/)
  })

  it("a settled refund is not sent again", async () => {
    const refundId = await refundFor(
      [
        { subtotal: 1000, commission: 100, sent: true },
        { subtotal: 2000, commission: 200, sent: true },
      ],
      600
    )
    await settleRefund(refundId, { db: prisma, stripe })

    const again = await settleRefund(refundId, { db: prisma, stripe })

    expect(again.outcome).toBe("skipped")
    expect(count("createRefund")).toBe(1)
    expect(count("reverseTransfer")).toBe(1)
  })

  it("a destination charge (one vendor): the refund reverses the transfer in the same call", async () => {
    const refundId = await refundFor([{ subtotal: 1000, commission: 100 }], 400)

    const result = await settleRefund(refundId, { db: prisma, stripe })

    expect(result).toMatchObject({
      outcome: "refunded",
      transferReversalId: null,
    })
    expect(
      stripe.calls.find((c) => c.method === "createRefund")!.input
    ).toMatchObject({
      reverseTransfer: true,
    })
    expect(count("reverseTransfer")).toBe(0)
  })

  it("a vendor's transfer not yet sent blocks the refund: nothing is sent to Stripe", async () => {
    const refundId = await refundFor(
      [
        { subtotal: 1000, commission: 100, sent: false },
        { subtotal: 2000, commission: 200, sent: true },
      ],
      600
    )

    const result = await settleRefund(refundId, { db: prisma, stripe })

    expect(result).toMatchObject({
      outcome: "blocked",
      reason: "TRANSFER_NOT_SENT",
    })
    expect(stripe.calls).toHaveLength(0)
    expect(
      (await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }))
        .status
    ).toBe("pending")
  })

  it("a declined refund marks the refund failed, which frees its amount, and sends no reversal", async () => {
    const refundId = await refundFor(
      [
        { subtotal: 1000, commission: 100, sent: true },
        { subtotal: 2000, commission: 200, sent: true },
      ],
      600
    )
    stripe.failRefunds = true

    const result = await settleRefund(refundId, { db: prisma, stripe })

    expect(result.outcome).toBe("failed")
    expect(
      (await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }))
        .status
    ).toBe("failed")
    expect(count("reverseTransfer")).toBe(0)
  })

  it("a reversal declined after the refund went through leaves the refund pending; a retry sends only the reversal", async () => {
    const refundId = await refundFor(
      [
        { subtotal: 1000, commission: 100, sent: true },
        { subtotal: 2000, commission: 200, sent: true },
      ],
      600
    )
    stripe.failReversals = true

    const first = await settleRefund(refundId, { db: prisma, stripe })

    expect(first.outcome).toBe("partial")
    const pending = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    })
    expect(pending.status).toBe("pending")
    expect(pending.stripeRefundId).toMatch(/^re_fake_/)

    stripe.failReversals = false
    const retry = await settleRefund(refundId, { db: prisma, stripe })

    expect(retry.outcome).toBe("refunded")
    expect(count("createRefund")).toBe(1)
    expect(count("reverseTransfer")).toBe(2)
  })
})
