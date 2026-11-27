import { describe, expect, it } from "vitest"
import {
  HOLD_TTL_MINUTES,
  MAX_HOLD_QUANTITY,
  placeHoldSchema,
} from "@/lib/validation/hold"

describe("placeHoldSchema", () => {
  const ok = { availabilityId: "slot-1", quantity: 2 }

  it("accepts a slot and a whole number of places", () => {
    expect(placeHoldSchema.safeParse(ok).success).toBe(true)
  })

  it("refuses zero, negative, fractional and too many places", () => {
    expect(placeHoldSchema.safeParse({ ...ok, quantity: 0 }).success).toBe(
      false
    )
    expect(placeHoldSchema.safeParse({ ...ok, quantity: -1 }).success).toBe(
      false
    )
    expect(placeHoldSchema.safeParse({ ...ok, quantity: 1.5 }).success).toBe(
      false
    )
    expect(
      placeHoldSchema.safeParse({ ...ok, quantity: MAX_HOLD_QUANTITY + 1 })
        .success
    ).toBe(false)
  })

  it("refuses fields the caller must not set (the server decides time and price)", () => {
    expect(
      placeHoldSchema.safeParse({ ...ok, expiresAt: "2030-01-01" }).success
    ).toBe(false)
    expect(placeHoldSchema.safeParse({ ...ok, priceOverride: 1 }).success).toBe(
      false
    )
  })

  it("keeps the hold window at ten minutes", () => {
    expect(HOLD_TTL_MINUTES).toBe(10)
  })
})
