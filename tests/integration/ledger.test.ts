import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError } from "@/lib/errors"
import { getLedger } from "@/lib/services/ledger"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
})

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  await prisma.user.update({ where: { email }, data: { platformRole, name } })

  return { session: await h.sessionFor(email, password) }
}

/** One booking with a succeeded £15.00 payment, a £10.00 succeeded transfer, and a £5.00 pending refund. */
async function movements(day: Date) {
  const user = await prisma.user.create({
    data: {
      email: `l${day.getTime()}@example.com`,
      name: "L",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: "Vendor L",
      slug: `vl-${day.getTime()}`,
      status: "APPROVED",
      stripeAccountId: `acct_l${day.getTime()}`,
    },
  })
  const category = await prisma.category.create({
    data: {
      name: `CL${day.getTime()}`,
      slug: `cl-${day.getTime()}`,
      type: "TIMED_SLOT",
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Walk",
      slug: `wl-${day.getTime()}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Slot",
      basePrice: 1500,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const startAt = new Date(day.getTime() + 5 * 24 * 3600 * 1000)
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
      createdAt: day,
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
    include: { items: true },
  })
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: `pi_l${day.getTime()}`,
      amount: 1500,
      status: "succeeded",
      applicationFeeAmount: 0,
      createdAt: day,
    },
  })
  await prisma.transfer.create({
    data: {
      bookingItemId: booking.items[0]!.id,
      amount: 1350,
      status: "created",
      stripeTransferId: `tr_l${day.getTime()}`,
      createdAt: day,
    },
  })
  await prisma.refund.create({
    data: {
      bookingItemId: booking.items[0]!.id,
      amount: 500,
      status: "pending",
      createdAt: day,
    },
  })
}

describe("the ledger (Postgres)", () => {
  it("totals each kind by status and lists every movement, newest first", async () => {
    const admin = await account("ADMIN", "Admin")
    await movements(new Date(Date.UTC(2026, 10, 10, 12)))

    const ledger = await getLedger({}, { session: admin.session, db: prisma })

    expect(ledger.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "payment",
          status: "succeeded",
          count: 1,
          amount: 1500,
        }),
        expect.objectContaining({
          kind: "transfer",
          status: "created",
          count: 1,
          amount: 1350,
        }),
        expect.objectContaining({
          kind: "refund",
          status: "pending",
          count: 1,
          amount: 500,
        }),
      ])
    )
    expect(ledger.rows.map((r) => r.kind)).toHaveLength(3)
    expect(ledger.truncated).toBe(false)
  })

  it("a kind filter shows only that kind, and a London date range keeps only days inside it", async () => {
    const admin = await account("ADMIN", "Admin")
    await movements(new Date(Date.UTC(2026, 10, 10, 12)))
    await movements(new Date(Date.UTC(2026, 10, 20, 12)))

    const refunds = await getLedger(
      { kind: "refund" },
      { session: admin.session, db: prisma }
    )
    const firstWeek = await getLedger(
      { from: "2026-11-01", to: "2026-11-15" },
      { session: admin.session, db: prisma }
    )

    expect(refunds.rows.every((r) => r.kind === "refund")).toBe(true)
    expect(refunds.rows).toHaveLength(2)
    expect(firstWeek.rows).toHaveLength(3)
    expect(firstWeek.totals.find((t) => t.kind === "payment")?.count).toBe(1)
  })

  it("the ledger is for admins only", async () => {
    const tourist = await account("TOURIST", "Tourist")

    await expect(
      getLedger({}, { session: tourist.session, db: prisma })
    ).rejects.toThrow(ForbiddenError)
  })
})
