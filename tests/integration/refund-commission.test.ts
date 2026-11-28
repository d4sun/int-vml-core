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

/**
 * A two-vendor booking (a platform charge) with one sent transfer on the first
 * item of £10.00 subtotal and £1.00 commission.
 */
async function platformBooking() {
  n += 1
  const user = await prisma.user.create({
    data: {
      email: `c${n}@example.com`,
      name: "C",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  const vendors: { id: string }[] = []
  for (const i of [0, 1]) {
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
  const lines = [
    { subtotal: 1000, commission: 100 },
    { subtotal: 2000, commission: 200 },
  ]
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
      total: 3000,
      items: {
        create: lines.map((line, i) => ({
          productId: product.id,
          availabilityId: avails[i]!,
          vendorId: vendors[i]!.id,
          quantity: 1,
          unitPrice: line.subtotal,
          subtotal: line.subtotal,
          commissionAmount: line.commission,
          status: "CONFIRMED" as const,
        })),
      },
    },
    include: { items: true },
  })
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: `pi_${n}`,
      amount: 3000,
      status: "succeeded",
      applicationFeeAmount: 0,
    },
  })
  for (const [i, item] of booking.items.entries()) {
    await prisma.transfer.create({
      data: {
        bookingItemId: item.id,
        amount: item.subtotal - item.commissionAmount,
        status: "created",
        stripeTransferId: `tr_${n}_${i}`,
      },
    })
  }

  return booking.items[0]!.id
}

/** A pending refund on the item, with an explicit creation time so the order is fixed. */
async function pendingRefund(itemId: string, amount: number, step: number) {
  const refund = await prisma.refund.create({
    data: {
      bookingItemId: itemId,
      amount,
      status: "pending",
      createdAt: new Date(Date.UTC(2026, 10, 28, 12, 0, step)),
    },
  })

  return refund.id
}

const reversals = () =>
  stripe.calls
    .filter((c) => c.method === "reverseTransfer")
    .map((c) => (c.input as { amount: number }).amount)

describe("proportional commission across partial refunds (Postgres, fake Stripe)", () => {
  it("a 50% refund reverses the vendor's share less half the commission (TC-E10S1-02)", async () => {
    const itemId = await platformBooking()
    const refundId = await pendingRefund(itemId, 500, 1)

    const result = await settleRefund(refundId, { db: prisma, stripe })

    expect(result.outcome).toBe("refunded")
    // Commission on £5.00 is £0.50; the vendor gives back £4.50.
    expect(reversals()).toEqual([450])
  })

  it("three partial refunds of one item reverse exactly the vendor's share in total (IT-12)", async () => {
    const itemId = await platformBooking()
    const ids = [
      await pendingRefund(itemId, 333, 1),
      await pendingRefund(itemId, 333, 2),
      await pendingRefund(itemId, 334, 3),
    ]

    for (const id of ids) {
      expect((await settleRefund(id, { db: prisma, stripe })).outcome).toBe(
        "refunded"
      )
    }

    // The item is £10.00 with £1.00 commission: the vendor's £9.00 comes back, to the penny.
    expect(reversals().reduce((s, x) => s + x, 0)).toBe(900)
    // Shares of commission are 33, 34, 33, so the reversals are 300, 299, 301.
    expect(reversals()).toEqual([300, 299, 301])
  })
})
