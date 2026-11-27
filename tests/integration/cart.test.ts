import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { RateLimitedError, ConflictError, NotFoundError } from "@/lib/errors"
import {
  addToCart,
  getCart,
  removeFromCart,
  updateCartItem,
} from "@/lib/services/cart"
import { CART_ADDS_PER_WINDOW } from "@/lib/validation/cart"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
const MIN = 60 * 1000
const NOW = new Date("2030-06-01T10:00:00Z")

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
})

async function user(email: string) {
  return prisma.user.create({
    data: { email, name: email, emailVerified: true, platformRole: "TOURIST" },
  })
}

const sessionFor = (u: { id: string; email: string }) => async () => ({
  user: {
    id: u.id,
    email: u.email,
    name: u.email,
    emailVerified: true,
    platformRole: "TOURIST",
  },
})

let n = 0
/** A listing of a vendor, with one slot of the given capacity and price. */
async function slot(
  vendorName: string,
  opts: {
    capacity?: number
    basePrice?: number
    priceOverride?: number | null
  } = {}
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: vendorName,
      slug: `v-${n}`,
      status: "APPROVED",
      stripeOnboardingComplete: true,
    },
  })
  const category = await prisma.category.create({
    data: { name: "Tours", slug: `c-${n}`, type: "TIMED_SLOT" },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: `Walk ${n}`,
      slug: `walk-${n}`,
      status: "PUBLISHED",
    },
  })
  const product = await prisma.product.create({
    data: {
      listingId: listing.id,
      name: "Morning",
      basePrice: opts.basePrice ?? 1000,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    },
  })
  const availability = await prisma.availability.create({
    data: {
      productId: product.id,
      startAt: new Date(NOW.getTime() + 5 * 60 * MIN),
      endAt: new Date(NOW.getTime() + 6 * 60 * MIN),
      capacity: opts.capacity ?? 10,
      remaining: opts.capacity ?? 10,
      priceOverride: opts.priceOverride ?? null,
    },
  })
  return availability.id
}

const remainingOf = async (id: string) =>
  (await prisma.availability.findUniqueOrThrow({ where: { id } })).remaining

describe("the cart (Postgres)", () => {
  it("TC-E2S1-06: items from two vendors are grouped, priced by the server, and totalled", async () => {
    const u = await user("olive@example.com")
    const s = sessionFor(u)
    const a = await slot("Vendor A", { basePrice: 1000 })
    const b = await slot("Vendor B", { basePrice: 500, priceOverride: 750 })

    await addToCart(
      { availabilityId: a, quantity: 2 },
      { session: s, db: prisma, now: () => NOW }
    )
    const cart = await addToCart(
      { availabilityId: b, quantity: 1 },
      { session: s, db: prisma, now: () => NOW }
    )

    expect(cart.groups.map((g) => g.vendorName)).toEqual([
      "Vendor A",
      "Vendor B",
    ])
    expect(cart.groups[0]!.subtotal).toBe(2000)
    // The slot's own price wins over the product price.
    expect(cart.groups[1]!.items[0]!.unitPrice).toBe(750)
    expect(cart.total).toBe(2750)
  })

  it("a price sent by the caller is refused, and nothing is held", async () => {
    const u = await user("olive@example.com")
    const a = await slot("Vendor A")

    await expect(
      addToCart(
        { availabilityId: a, quantity: 1, unitPrice: 1 },
        { session: sessionFor(u), db: prisma, now: () => NOW }
      )
    ).rejects.toThrow()
    expect(await prisma.hold.count()).toBe(0)
  })

  it("a visitor's cart shows only their own active holds", async () => {
    const mine = await user("mine@example.com")
    const theirs = await user("theirs@example.com")
    const a = await slot("Vendor A")

    await addToCart(
      { availabilityId: a, quantity: 1 },
      { session: sessionFor(theirs), db: prisma, now: () => NOW }
    )
    await addToCart(
      { availabilityId: a, quantity: 2 },
      { session: sessionFor(mine), db: prisma, now: () => NOW }
    )

    const cart = await getCart({
      session: sessionFor(mine),
      db: prisma,
      now: () => NOW,
    })

    expect(cart.groups[0]!.items.map((i) => i.quantity)).toEqual([2])
  })

  it("an expired hold is not in the cart", async () => {
    const u = await user("olive@example.com")
    const a = await slot("Vendor A")
    await addToCart(
      { availabilityId: a, quantity: 1 },
      { session: sessionFor(u), db: prisma, now: () => NOW }
    )

    const later = await getCart({
      session: sessionFor(u),
      db: prisma,
      now: () => new Date(NOW.getTime() + 11 * MIN),
    })

    expect(later.groups).toEqual([])
  })

  it("changing a quantity moves the places by the difference, and the expiry does not move", async () => {
    const u = await user("olive@example.com")
    const s = sessionFor(u)
    const a = await slot("Vendor A", { capacity: 5 })
    const cart = await addToCart(
      { availabilityId: a, quantity: 2 },
      { session: s, db: prisma, now: () => NOW }
    )
    const holdId = cart.groups[0]!.items[0]!.holdId
    const expiry = cart.groups[0]!.items[0]!.expiresAt

    const after = await updateCartItem(
      { holdId, quantity: 4 },
      { session: s, db: prisma, now: () => NOW }
    )

    expect(await remainingOf(a)).toBe(1)
    expect(after.groups[0]!.items[0]!.quantity).toBe(4)
    expect(after.groups[0]!.items[0]!.expiresAt.getTime()).toBe(
      expiry.getTime()
    )
  })

  it("asking for more places than are left, when raising a quantity, is refused and changes nothing", async () => {
    const u = await user("olive@example.com")
    const s = sessionFor(u)
    const a = await slot("Vendor A", { capacity: 3 })
    const cart = await addToCart(
      { availabilityId: a, quantity: 2 },
      { session: s, db: prisma, now: () => NOW }
    )
    const holdId = cart.groups[0]!.items[0]!.holdId

    await expect(
      updateCartItem(
        { holdId, quantity: 5 },
        { session: s, db: prisma, now: () => NOW }
      )
    ).rejects.toThrow(ConflictError)
    expect(await remainingOf(a)).toBe(1)
  })

  it("removing an item gives its places back", async () => {
    const u = await user("olive@example.com")
    const s = sessionFor(u)
    const a = await slot("Vendor A", { capacity: 4 })
    const cart = await addToCart(
      { availabilityId: a, quantity: 3 },
      { session: s, db: prisma, now: () => NOW }
    )

    const after = await removeFromCart(
      { holdId: cart.groups[0]!.items[0]!.holdId },
      { session: s, db: prisma, now: () => NOW }
    )

    expect(after.groups).toEqual([])
    expect(await remainingOf(a)).toBe(4)
  })

  it("another visitor's item cannot be changed or removed, and looks like a missing item", async () => {
    const owner = await user("owner@example.com")
    const other = await user("other@example.com")
    const a = await slot("Vendor A", { capacity: 4 })
    const cart = await addToCart(
      { availabilityId: a, quantity: 1 },
      { session: sessionFor(owner), db: prisma, now: () => NOW }
    )
    const holdId = cart.groups[0]!.items[0]!.holdId

    await expect(
      updateCartItem(
        { holdId, quantity: 2 },
        { session: sessionFor(other), db: prisma, now: () => NOW }
      )
    ).rejects.toThrow(NotFoundError)
    await expect(
      removeFromCart(
        { holdId },
        { session: sessionFor(other), db: prisma, now: () => NOW }
      )
    ).rejects.toThrow(NotFoundError)
    expect(await remainingOf(a)).toBe(3)
  })

  it("CR-8: a visitor may add at most the window's limit of items; the next is refused", async () => {
    const u = await user("busy@example.com")
    const s = sessionFor(u)
    const a = await slot("Vendor A", { capacity: CART_ADDS_PER_WINDOW + 5 })

    for (let i = 0; i < CART_ADDS_PER_WINDOW; i++) {
      await addToCart(
        { availabilityId: a, quantity: 1 },
        { session: s, db: prisma, now: () => NOW }
      )
    }

    await expect(
      addToCart(
        { availabilityId: a, quantity: 1 },
        { session: s, db: prisma, now: () => NOW }
      )
    ).rejects.toThrow(RateLimitedError)
  })
})
