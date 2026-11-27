import { describe, expect, it } from "vitest"
import {
  DEFAULT_POLICY,
  POLICY_BOUNDS,
  parseProductPolicy,
} from "@/lib/products/policy"
import {
  MAX_PRICE_PENCE,
  MIN_PRICE_PENCE,
  createProductSchema,
  policySchema,
  updateProductSchema,
} from "@/lib/validation/product"

const create = (over: Record<string, unknown> = {}) =>
  createProductSchema.safeParse({
    listingId: "l1",
    name: "Standard ticket",
    basePrice: 2500,
    ...over,
  })

describe("createProductSchema", () => {
  it("defaults the policy to the platform default", () => {
    const result = create()

    expect(result.success && result.data.policy).toEqual(DEFAULT_POLICY)
  })

  it("price is whole pence from 30p to £10,000", () => {
    for (const ok of [MIN_PRICE_PENCE, 100, 2500, MAX_PRICE_PENCE]) {
      expect(create({ basePrice: ok }).success, String(ok)).toBe(true)
    }

    for (const bad of [
      0,
      29,
      -1,
      MAX_PRICE_PENCE + 1,
      25.5,
      100.5,
      2500.01,
      "2500",
      NaN,
      Infinity,
      null,
    ]) {
      expect(create({ basePrice: bad }).success, String(bad)).toBe(false)
    }
  })

  it("TC-E5S2-04: a policy outside the platform bounds is rejected, each field and each end", () => {
    const { cancelWindowHours: c, bookingCutoffHours: b } = POLICY_BOUNDS

    for (const policy of [
      { cancelWindowHours: c.min, bookingCutoffHours: b.min },
      { cancelWindowHours: c.max, bookingCutoffHours: b.max },
    ]) {
      expect(create({ policy }).success, JSON.stringify(policy)).toBe(true)
    }

    for (const policy of [
      { cancelWindowHours: c.max + 1, bookingCutoffHours: 2 },
      { cancelWindowHours: c.min - 1, bookingCutoffHours: 2 },
      { cancelWindowHours: 24, bookingCutoffHours: b.max + 1 },
      { cancelWindowHours: 24, bookingCutoffHours: b.min - 1 },
      { cancelWindowHours: 1.5, bookingCutoffHours: 2 },
      { cancelWindowHours: "24", bookingCutoffHours: 2 },
      { cancelWindowHours: 24 },
      { cancelWindowHours: 24, bookingCutoffHours: 2, refundPercent: 100 },
    ]) {
      expect(create({ policy }).success, JSON.stringify(policy)).toBe(false)
    }
  })

  it("the name is trimmed and bounded", () => {
    expect(
      create({ name: " Ticket " }).success && create({ name: " Ticket " })
    ).toMatchObject({
      data: { name: "Ticket" },
    })
    expect(create({ name: "x" }).success).toBe(false)
    expect(create({ name: "x".repeat(121) }).success).toBe(false)
  })

  it("never accepts a currency, kind, active flag or id from the client", () => {
    for (const extra of [
      { currency: "USD" },
      { kind: "TABLE" },
      { active: false },
      { id: "x" },
    ]) {
      expect(create(extra).success, JSON.stringify(extra)).toBe(false)
    }
  })
})

describe("updateProductSchema", () => {
  const update = (over: Record<string, unknown>) =>
    updateProductSchema.safeParse({ id: "p1", ...over })

  it("needs an id and a change", () => {
    expect(updateProductSchema.safeParse({ name: "Abc" }).success).toBe(false)
    expect(update({}).success).toBe(false)
    expect(update({ active: false }).success).toBe(true)
  })

  it("applies the same price and policy bounds", () => {
    expect(update({ basePrice: 29 }).success).toBe(false)
    expect(
      update({ policy: { cancelWindowHours: 721, bookingCutoffHours: 2 } })
        .success
    ).toBe(false)
    expect(
      update({ policy: { cancelWindowHours: 48, bookingCutoffHours: 2 } })
        .success
    ).toBe(true)
    expect(update({ active: "yes" }).success).toBe(false)
  })

  it("the policy is replaced whole, both fields", () => {
    expect(update({ policy: { cancelWindowHours: 48 } }).success).toBe(false)
    expect(
      policySchema.safeParse({ cancelWindowHours: 0, bookingCutoffHours: 0 })
        .success
    ).toBe(true)
  })
})

describe("parseProductPolicy", () => {
  it("reads a valid policy", () => {
    expect(
      parseProductPolicy({ cancelWindowHours: 48, bookingCutoffHours: 6 })
    ).toEqual({
      cancelWindowHours: 48,
      bookingCutoffHours: 6,
    })
  })

  it("falls back to the default per field for anything missing or out of bounds", () => {
    expect(
      parseProductPolicy({ cancelWindowHours: -5, bookingCutoffHours: 6 })
    ).toEqual({
      cancelWindowHours: DEFAULT_POLICY.cancelWindowHours,
      bookingCutoffHours: 6,
    })

    for (const bad of [
      null,
      undefined,
      {},
      [],
      "x",
      3,
      { cancelWindowHours: "24" },
      { cancelWindowHours: NaN, bookingCutoffHours: 1.5 },
    ]) {
      expect(parseProductPolicy(bad), JSON.stringify(bad)).toEqual(
        DEFAULT_POLICY
      )
    }
  })
})
