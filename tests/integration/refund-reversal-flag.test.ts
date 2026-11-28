import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError } from "@/lib/errors"
import { getBookingForAdmin } from "@/lib/services/admin-bookings"
import { issueRefund } from "@/lib/services/refund-issue"
import { retryReversal } from "@/lib/services/refund-retry"
import {
  settleRefund,
  REVERSAL_BLOCKED,
  REVERSAL_SENT,
} from "@/lib/services/refund-settlement"
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

/** A pending refund of £5.00 on the first item, with an explicit creation time. */
async function pendingRefund(itemId: string) {
  const refund = await prisma.refund.create({
    data: {
      bookingItemId: itemId,
      amount: 500,
      status: "pending",
      createdAt: new Date(Date.UTC(2026, 10, 28, 12, 0, 1)),
    },
  })

  return refund.id
}

const reversalCalls = () =>
  stripe.calls.filter((c) => c.method === "reverseTransfer").length

describe("insufficient vendor balance (Postgres, fake Stripe)", () => {
  it("a reversal the vendor's balance cannot cover is flagged: the refund stays pending and the block is audited (TC-E10S1-06)", async () => {
    const itemId = await platformBooking()
    const refundId = await pendingRefund(itemId)
    stripe.reversalsInsufficient = true

    const outcome = await settleRefund(refundId, { db: prisma, stripe })

    expect(outcome).toMatchObject({
      outcome: "flagged",
      reason: "VENDOR_BALANCE_INSUFFICIENT",
    })
    const row = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    })
    expect(row.status).toBe("pending")
    expect(row.stripeRefundId).toMatch(/^re_fake_/)
    expect(row.transferReversalId).toBeNull()
    expect(
      await prisma.auditLog.count({ where: { action: REVERSAL_BLOCKED } })
    ).toBe(1)
  })

  it("the admin's booking view shows the refund as flagged", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await platformBooking()
    const refundId = await pendingRefund(itemId)
    stripe.reversalsInsufficient = true
    await settleRefund(refundId, { db: prisma, stripe })

    const bookingId = (
      await prisma.bookingItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { bookingId: true },
      })
    ).bookingId
    const view = await getBookingForAdmin(bookingId, {
      session: admin.session,
      db: prisma,
    })

    expect(view.refunds.map((r) => r.flagged)).toEqual([true])
  })

  it("an admin's retry, once the balance covers it, sends the reversal and clears the flag", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await platformBooking()
    const refundId = await pendingRefund(itemId)
    stripe.reversalsInsufficient = true
    await settleRefund(refundId, { db: prisma, stripe })

    stripe.reversalsInsufficient = false
    const retried = await retryReversal(refundId, {
      session: admin.session,
      db: prisma,
      stripe,
    })

    expect(retried).toMatchObject({ outcome: "refunded" })
    const row = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    })
    expect(row.transferReversalId).toMatch(/^trr_fake_/)
    expect(
      await prisma.auditLog.count({ where: { action: REVERSAL_SENT } })
    ).toBe(1)
    const bookingId = (
      await prisma.bookingItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { bookingId: true },
      })
    ).bookingId
    const view = await getBookingForAdmin(bookingId, {
      session: admin.session,
      db: prisma,
    })
    expect(view.refunds.map((r) => r.flagged)).toEqual([false])
  })

  it("a retry does not send the refund to Stripe again, and a settled refund is not retried", async () => {
    const admin = await account("ADMIN", "Admin")
    const itemId = await platformBooking()
    const refundId = await pendingRefund(itemId)
    stripe.reversalsInsufficient = true
    await settleRefund(refundId, { db: prisma, stripe })
    stripe.reversalsInsufficient = false

    await retryReversal(refundId, {
      session: admin.session,
      db: prisma,
      stripe,
    })
    const again = await retryReversal(refundId, {
      session: admin.session,
      db: prisma,
      stripe,
    })

    expect(again).toMatchObject({ outcome: "skipped" })
    expect(
      stripe.calls.filter((c) => c.method === "createRefund")
    ).toHaveLength(1)
    // The first attempt (blocked) and the retry; the settled refund sends nothing.
    expect(reversalCalls()).toBe(2)
  })

  it("only an admin can retry a reversal", async () => {
    const tourist = await account("TOURIST", "Tourist")
    const itemId = await platformBooking()
    const refundId = await pendingRefund(itemId)

    await expect(
      retryReversal(refundId, { session: tourist.session, db: prisma, stripe })
    ).rejects.toThrow(ForbiddenError)
    expect(stripe.calls).toHaveLength(0)
  })
})
