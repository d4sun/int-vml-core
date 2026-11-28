import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  MAX_TRANSFER_ATTEMPTS,
  reconcileFailedTransfers,
  TRANSFER_UNRESOLVED,
} from "@/lib/services/transfer-reconciliation"
import { settleTransfer } from "@/lib/services/transfers"
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

/** A confirmed booking item with a pending transfer to its vendor. */
async function pendingTransfer(
  opts: { vendorStatus?: "APPROVED" | "SUSPENDED" } = {}
) {
  n += 1
  const user = await prisma.user.create({
    data: {
      email: `rc${n}@example.com`,
      name: "RC",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `RV${n}`,
      slug: `rv-${n}`,
      status: opts.vendorStatus ?? "APPROVED",
      stripeOnboardingComplete: true,
      stripeAccountId: `acct_rc${n}`,
    },
  })
  const category = await prisma.category.create({
    data: { name: `RC${n}`, slug: `rc-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "R",
      slug: `rl-${n}`,
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
          status: "CONFIRMED",
        },
      },
    },
    include: { items: true },
  })
  const transfer = await prisma.transfer.create({
    data: {
      bookingItemId: booking.items[0]!.id,
      amount: 900,
      status: "pending",
    },
  })

  return {
    transferId: transfer.id,
    vendorId: vendor.id,
    accountId: `acct_rc${n}`,
  }
}

const attemptsOf = (transferId: string) =>
  prisma.auditLog.count({
    where: { action: "transfer.failed", entityId: transferId },
  })

describe("reconciling failed vendor transfers (Postgres, fake Stripe)", () => {
  it("a transfer declined once is sent again and succeeds once Stripe accepts it (TC-E10S2-01)", async () => {
    const t = await pendingTransfer()
    stripe.failTransfersTo.add(t.accountId)
    await settleTransfer(t.transferId, { db: prisma, stripe })
    stripe.failTransfersTo.clear()

    const summary = await reconcileFailedTransfers(10, { db: prisma, stripe })

    expect(summary).toMatchObject({ retried: 1, sent: 1, flagged: 0 })
    expect(
      (await prisma.transfer.findUniqueOrThrow({ where: { id: t.transferId } }))
        .status
    ).toBe("created")
  })

  it("a transfer that keeps failing is retried up to the limit, then flagged once, and not sent again", async () => {
    const t = await pendingTransfer()
    stripe.failTransfersTo.add(t.accountId)
    await settleTransfer(t.transferId, { db: prisma, stripe })

    // The first send plus the retries are the attempts; the limit is reached on the last retry.
    for (let run = 1; run < MAX_TRANSFER_ATTEMPTS; run += 1) {
      await reconcileFailedTransfers(10, { db: prisma, stripe })
    }
    const atLimit = await attemptsOf(t.transferId)
    expect(atLimit).toBe(MAX_TRANSFER_ATTEMPTS)

    const flagged = await reconcileFailedTransfers(10, { db: prisma, stripe })
    const again = await reconcileFailedTransfers(10, { db: prisma, stripe })

    expect(flagged).toMatchObject({ retried: 0, flagged: 1 })
    expect(again).toMatchObject({ retried: 0, flagged: 0 })
    expect(
      await prisma.auditLog.count({
        where: { action: TRANSFER_UNRESOLVED, entityId: t.transferId },
      })
    ).toBe(1)
    expect(
      stripe.calls.filter((c) => c.method === "createTransfer")
    ).toHaveLength(MAX_TRANSFER_ATTEMPTS)
    expect(
      (await prisma.transfer.findUniqueOrThrow({ where: { id: t.transferId } }))
        .status
    ).toBe("failed")
  })

  it("a vendor that cannot sell is not sent to Stripe on any retry, and is flagged at the limit", async () => {
    const t = await pendingTransfer({ vendorStatus: "SUSPENDED" })
    await settleTransfer(t.transferId, { db: prisma, stripe })

    for (let run = 0; run < MAX_TRANSFER_ATTEMPTS + 1; run += 1) {
      await reconcileFailedTransfers(10, { db: prisma, stripe })
    }

    expect(
      stripe.calls.filter((c) => c.method === "createTransfer")
    ).toHaveLength(0)
    expect(
      await prisma.auditLog.count({
        where: { action: TRANSFER_UNRESOLVED, entityId: t.transferId },
      })
    ).toBe(1)
  })
})
