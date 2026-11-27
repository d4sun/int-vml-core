import { describe, expect, it } from "vitest"
import { RateLimitedError } from "@/lib/errors"
import { groupByVendor, type CartItem } from "@/lib/services/cart"
import {
  CART_ADDS_PER_WINDOW,
  removeCartItemSchema,
  updateCartItemSchema,
} from "@/lib/validation/cart"

const item = (over: Partial<CartItem>): CartItem => ({
  holdId: "h",
  availabilityId: "a",
  vendorId: "v1",
  vendorName: "Vendor 1",
  listingTitle: "Walk",
  listingSlug: "walk",
  productName: "Slot",
  startAt: new Date("2030-06-01T10:00:00Z"),
  quantity: 1,
  unitPrice: 1000,
  lineTotal: 1000,
  expiresAt: new Date("2030-06-01T10:10:00Z"),
  ...over,
})

describe("cart totals", () => {
  it("TC-E2S1-06: lines are grouped by vendor in the order they were added, with a subtotal each", () => {
    const cart = groupByVendor([
      item({ holdId: "1", vendorId: "v1", vendorName: "A", lineTotal: 2000 }),
      item({ holdId: "2", vendorId: "v2", vendorName: "B", lineTotal: 500 }),
      item({ holdId: "3", vendorId: "v1", vendorName: "A", lineTotal: 1500 }),
    ])

    expect(cart.groups.map((g) => g.vendorId)).toEqual(["v1", "v2"])
    expect(cart.groups[0]!.subtotal).toBe(3500)
    expect(cart.groups[0]!.items.map((i) => i.holdId)).toEqual(["1", "3"])
    expect(cart.groups[1]!.subtotal).toBe(500)
    expect(cart.total).toBe(4000)
  })

  it("the soonest expiry is the one the page counts down to", () => {
    const cart = groupByVendor([
      item({ holdId: "1", expiresAt: new Date("2030-06-01T10:09:00Z") }),
      item({ holdId: "2", expiresAt: new Date("2030-06-01T10:03:00Z") }),
    ])

    expect(cart.expiresAt?.toISOString()).toBe("2030-06-01T10:03:00.000Z")
  })

  it("an empty cart has no total and no expiry", () => {
    expect(groupByVendor([])).toEqual({ groups: [], total: 0, expiresAt: null })
  })
})

describe("cart input", () => {
  it("accepts a quantity from 1 to the hold limit, and refuses anything else", () => {
    expect(
      updateCartItemSchema.safeParse({ holdId: "h", quantity: 3 }).success
    ).toBe(true)
    expect(
      updateCartItemSchema.safeParse({ holdId: "h", quantity: 0 }).success
    ).toBe(false)
    expect(
      updateCartItemSchema.safeParse({ holdId: "h", quantity: 11 }).success
    ).toBe(false)
  })

  it("refuses a price or any other field: the total is the server's to compute", () => {
    expect(
      updateCartItemSchema.safeParse({ holdId: "h", quantity: 1, unitPrice: 1 })
        .success
    ).toBe(false)
    expect(
      removeCartItemSchema.safeParse({ holdId: "h", total: 0 }).success
    ).toBe(false)
    expect(removeCartItemSchema.safeParse({ holdId: "h" }).success).toBe(true)
  })

  it("the add rate limit is a stated number, and the refusal is a 429", () => {
    expect(CART_ADDS_PER_WINDOW).toBeGreaterThan(0)
    const error = new RateLimitedError()

    expect(error.status).toBe(429)
    expect(error.code).toBe("RATE_LIMITED")
  })
})
