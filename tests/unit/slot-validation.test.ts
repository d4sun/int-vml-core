import { describe, expect, it } from "vitest"
import {
  createSlotsSchema,
  deleteSlotSchema,
  listSlotsSchema,
  setSlotClosedSchema,
  updateSlotSchema,
} from "@/lib/validation/slot"

describe("updateSlotSchema", () => {
  const update = (over: Record<string, unknown>) =>
    updateSlotSchema.safeParse({ id: "s1", ...over })

  it("needs an id and a change", () => {
    expect(updateSlotSchema.safeParse({ capacity: 5 }).success).toBe(false)
    expect(update({}).success).toBe(false)
    expect(update({ capacity: 5 }).success).toBe(true)
  })

  it("capacity is a whole number from 1 to 1000", () => {
    for (const ok of [1, 20, 1000])
      expect(update({ capacity: ok }).success, String(ok)).toBe(true)

    for (const bad of [0, -1, 1001, 2.5, "5", NaN, null]) {
      expect(update({ capacity: bad }).success, String(bad)).toBe(false)
    }
  })

  it("TC-E5S2-05: the price override is whole pence from 30p to £10,000, or null to remove it", () => {
    for (const ok of [30, 3500, 1_000_000, null]) {
      expect(update({ priceOverride: ok }).success, String(ok)).toBe(true)
    }

    for (const bad of [0, 29, 1_000_001, 35.5, "3500", NaN, -5]) {
      expect(update({ priceOverride: bad }).success, String(bad)).toBe(false)
    }
  })

  it("never accepts the places left, the closed flag, times or another product", () => {
    for (const extra of [
      { remaining: 5 },
      { closed: true },
      { startAt: "2027-01-01T00:00:00Z" },
      { productId: "p" },
    ]) {
      expect(
        update({ capacity: 5, ...extra }).success,
        JSON.stringify(extra)
      ).toBe(false)
    }
  })
})

describe("the other slot schemas", () => {
  it("close needs an id and a boolean", () => {
    expect(
      setSlotClosedSchema.safeParse({ id: "s", closed: true }).success
    ).toBe(true)
    expect(
      setSlotClosedSchema.safeParse({ id: "s", closed: "true" }).success
    ).toBe(false)
    expect(setSlotClosedSchema.safeParse({ id: "s" }).success).toBe(false)
  })

  it("delete and list are strict", () => {
    expect(deleteSlotSchema.safeParse({ id: "s" }).success).toBe(true)
    expect(deleteSlotSchema.safeParse({ id: "s", force: true }).success).toBe(
      false
    )
    expect(
      listSlotsSchema.safeParse({ productId: "p", includePast: true }).success
    ).toBe(true)
    expect(
      listSlotsSchema.safeParse({ productId: "p", limit: 5 }).success
    ).toBe(false)
  })

  it("create takes a product and leaves the rule to the availability module", () => {
    expect(
      createSlotsSchema.safeParse({ productId: "p", rule: { anything: 1 } })
        .success
    ).toBe(true)
    expect(createSlotsSchema.safeParse({ rule: {} }).success).toBe(false)
    expect(
      createSlotsSchema.safeParse({ productId: "p", rule: {}, capacity: 5 })
        .success
    ).toBe(false)
  })
})
