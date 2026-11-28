import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { FakeStripe } from "@/lib/stripe/fake"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { refundUpdatedHandler } from "@/lib/webhooks/refund-updated"
import {
  RecordingTransactionalQueue,
  TEST_APP_URL,
} from "../helpers/recording-transactional-queue"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let stripe: FakeStripe
let n = 0
let eventNo = 0
let emails = new RecordingTransactionalQueue()

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
  stripe = new FakeStripe()
  emails = new RecordingTransactionalQueue()
})

/** A confirmed booking with the given item subtotals (pence), and one pending refund on the first item. */
async function bookingWithRefund(subtotals: number[], refundAmount: number) {
  n += 1
  const user = await prisma.user.create({
    data: {
      email: `w${n}@example.com`,
      name: "W",
      emailVerified: true,
      platformRole: "TOURIST",
    },
  })
  const vendor = await prisma.vendor.create({
    data: { name: `V${n}`, slug: `v-${n}`, status: "APPROVED" },
  })
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
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
  const items = []
  for (const [i, subtotal] of subtotals.entries()) {
    const startAt = new Date(Date.now() + (5 + i) * 24 * 3600 * 1000)
    const avail = await prisma.availability.create({
      data: {
        productId: product.id,
        startAt,
        endAt: new Date(startAt.getTime() + 3600000),
        capacity: 5,
        remaining: 4,
      },
    })
    items.push({
      productId: product.id,
      availabilityId: avail.id,
      vendorId: vendor.id,
      quantity: 1,
      unitPrice: subtotal,
      subtotal,
      commissionAmount: subtotal / 10,
      status: "CONFIRMED" as const,
    })
  }
  const booking = await prisma.booking.create({
    data: {
      touristUserId: user.id,
      status: "CONFIRMED",
      total: subtotals.reduce((s, x) => s + x, 0),
      items: { create: items },
    },
    include: { items: true },
  })
  const refund = await prisma.refund.create({
    data: {
      bookingItemId: booking.items[0]!.id,
      amount: refundAmount,
      status: "pending",
      stripeRefundId: `re_test_${n}`,
    },
  })

  return {
    bookingId: booking.id,
    refundId: refund.id,
    stripeRefundId: `re_test_${n}`,
  }
}

function refundEvent(
  refund: { refundId: string; stripeRefundId: string },
  status: string,
  amount: number,
  id?: string
) {
  eventNo += 1
  return stripe.signedEvent({
    id: id ?? `evt_refund_${eventNo}`,
    type: "refund.updated",
    created: Math.floor(Date.now() / 1000) + eventNo,
    data: {
      object: {
        id: refund.stripeRefundId,
        status,
        amount,
        metadata: { refundId: refund.refundId },
      },
    },
  })
}

const send = (ev: { rawBody: string; signature: string }) =>
  handleStripeWebhook(ev.rawBody, ev.signature, {
    stripe,
    db: prisma,
    handlers: {
      "refund.updated": refundUpdatedHandler({
        emailQueue: emails,
        appUrl: TEST_APP_URL,
      }),
    },
    logger: { error() {} },
  })

const refundRow = (id: string) =>
  prisma.refund.findUniqueOrThrow({ where: { id } })

describe("refund webhooks (Postgres, fake Stripe)", () => {
  it("a full refund that succeeds marks the refund, its item REFUNDED, and the booking REFUNDED", async () => {
    const b = await bookingWithRefund([1000], 1000)

    const result = await send(refundEvent(b, "succeeded", 1000))

    expect(result.body).toMatchObject({ result: "processed" })
    expect((await refundRow(b.refundId)).status).toBe("succeeded")
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: b.bookingId },
      include: { items: true },
    })
    expect(booking.items[0]!.status).toBe("REFUNDED")
    expect(booking.status).toBe("REFUNDED")
  })

  it("a partial refund on one of two items marks the booking PARTIALLY_REFUNDED and leaves the items", async () => {
    const b = await bookingWithRefund([1000, 2000], 400)

    await send(refundEvent(b, "succeeded", 400))

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: b.bookingId },
      include: { items: true },
    })
    expect(booking.status).toBe("PARTIALLY_REFUNDED")
    expect(booking.items.map((i) => i.status)).toEqual([
      "CONFIRMED",
      "CONFIRMED",
    ])
  })

  it("the same event twice is processed once; the second is a duplicate", async () => {
    const b = await bookingWithRefund([1000], 1000)
    const ev = refundEvent(b, "succeeded", 1000, "evt_same_refund")

    const first = await send(ev)
    const second = await send(ev)

    expect(first.body).toMatchObject({ result: "processed" })
    expect(second.body).toMatchObject({ result: "duplicate" })
    expect(
      await prisma.auditLog.count({ where: { action: "refund.succeeded" } })
    ).toBe(1)
  })

  it("two different events that both say succeeded change nothing the second time", async () => {
    const b = await bookingWithRefund([1000], 1000)

    await send(refundEvent(b, "succeeded", 1000, "evt_a"))
    await send(refundEvent(b, "succeeded", 1000, "evt_b"))

    expect(
      await prisma.auditLog.count({ where: { action: "refund.succeeded" } })
    ).toBe(1)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("REFUNDED")
  })

  it("a failed refund frees its amount and leaves the booking as it was", async () => {
    const b = await bookingWithRefund([1000], 1000)

    await send(refundEvent(b, "failed", 1000))

    expect((await refundRow(b.refundId)).status).toBe("failed")
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.bookingId } }))
        .status
    ).toBe("CONFIRMED")
  })

  it("a failure that arrives after success does not undo the refund", async () => {
    const b = await bookingWithRefund([1000], 1000)

    await send(refundEvent(b, "succeeded", 1000, "evt_ok"))
    await send(refundEvent(b, "failed", 1000, "evt_late_fail"))

    expect((await refundRow(b.refundId)).status).toBe("succeeded")
  })

  it("an event whose amount is not what we asked for is recorded and not applied", async () => {
    const b = await bookingWithRefund([1000], 1000)

    await send(refundEvent(b, "succeeded", 999))

    expect((await refundRow(b.refundId)).status).toBe("pending")
    expect(
      await prisma.auditLog.count({
        where: { action: "refund.amount_mismatch" },
      })
    ).toBe(1)
  })

  it("a refund we have no record of is retried by Stripe, not dropped", async () => {
    const b = await bookingWithRefund([1000], 1000)

    const result = await send(
      stripe.signedEvent({
        id: "evt_unknown_refund",
        type: "refund.updated",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: { id: "re_unknown", status: "succeeded", amount: 1000 },
        },
      })
    )

    expect(result.status).toBe(500)
    expect((await refundRow(b.refundId)).status).toBe("pending")
  })
})

describe("restocking refunded places (Postgres, fake Stripe)", () => {
  const remainingOf = async (refundId: string) => {
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: { bookingItem: { select: { availabilityId: true } } },
    })

    return (
      await prisma.availability.findUniqueOrThrow({
        where: { id: refund.bookingItem.availabilityId },
        select: { remaining: true },
      })
    ).remaining
  }

  it("a full refund gives its place back to the slot (capacity 5, one held: 4 to 5)", async () => {
    const b = await bookingWithRefund([1000], 1000)
    expect(await remainingOf(b.refundId)).toBe(4)

    await send(refundEvent(b, "succeeded", 1000))

    expect(await remainingOf(b.refundId)).toBe(5)
  })

  it("the same success again gives no place back a second time", async () => {
    const b = await bookingWithRefund([1000], 1000)

    await send(refundEvent(b, "succeeded", 1000, "evt_r1"))
    await send(refundEvent(b, "succeeded", 1000, "evt_r2"))

    expect(await remainingOf(b.refundId)).toBe(5)
  })

  it("a partial refund does not free the place: the item is not refunded yet", async () => {
    const b = await bookingWithRefund([1000], 400)

    await send(refundEvent(b, "succeeded", 400))

    expect(await remainingOf(b.refundId)).toBe(4)
  })

  it("a slot that would go past its capacity rolls the refund back and is retried", async () => {
    const b = await bookingWithRefund([1000], 1000)
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: b.refundId },
      select: { bookingItem: { select: { availabilityId: true } } },
    })
    await prisma.availability.update({
      where: { id: refund.bookingItem.availabilityId },
      data: { remaining: 5 },
    })

    const result = await send(refundEvent(b, "succeeded", 1000))

    expect(result.status).toBe(500)
    expect((await refundRow(b.refundId)).status).toBe("pending")
    expect(await remainingOf(b.refundId)).toBe(5)
  })
})

describe("refund emails (Postgres, fake Stripe)", () => {
  /** Adds an owner to the refunded item's vendor, so the vendor email is sent. */
  async function ownerOfItemVendor(refundId: string) {
    const refund = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: { bookingItem: { select: { vendorId: true } } },
    })
    const owner = await prisma.user.create({
      data: {
        email: `owner-${refundId.slice(0, 8)}@example.com`,
        name: "Owner",
        emailVerified: true,
        platformRole: "VENDOR",
      },
    })
    await prisma.vendorMember.create({
      data: {
        vendorId: refund.bookingItem.vendorId,
        userId: owner.id,
        role: "OWNER",
      },
    })

    return owner.email
  }

  it("a succeeded refund emails the visitor, and the vendor owner a reversal notice, once each", async () => {
    const b = await bookingWithRefund([1000], 1000)
    const ownerEmail = await ownerOfItemVendor(b.refundId)

    await send(refundEvent(b, "succeeded", 1000, "evt_mail_1"))
    await send(refundEvent(b, "succeeded", 1000, "evt_mail_2"))

    const kinds = emails.messages.map((m) => [m.to, m.tags?.kind])
    expect(kinds).toHaveLength(2)
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["w" + n + "@example.com", "refund-issued"],
        [ownerEmail, "refund-reversal"],
      ])
    )
    expect(
      emails.messages.find((m) => m.tags?.kind === "refund-issued")?.subject
    ).toMatch(/Refund for booking/)
  })

  it("a failed refund sends no refund email", async () => {
    const b = await bookingWithRefund([1000], 1000)

    await send(refundEvent(b, "failed", 1000))

    expect(emails.messages).toHaveLength(0)
  })
})
