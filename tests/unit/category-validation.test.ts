import { describe, expect, it } from "vitest"
import {
  createCategorySchema,
  deleteCategorySchema,
  updateCategorySchema,
} from "@/lib/validation/category"

const create = (over: Record<string, unknown> = {}) =>
  createCategorySchema.safeParse({ name: "Tours", ...over })

describe("createCategorySchema", () => {
  it("defaults the type and the commission", () => {
    const result = create()

    expect(result.success && result.data).toMatchObject({
      name: "Tours",
      type: "TIMED_SLOT",
      commissionBpsDefault: 1000,
    })
  })

  it("TC-E9S2-01: commission is whole basis points from 0 to 10000", () => {
    for (const ok of [0, 1, 1000, 9999, 10_000]) {
      expect(create({ commissionBpsDefault: ok }).success, String(ok)).toBe(
        true
      )
    }

    for (const bad of [-1, 10_001, 12.5, 0.1, "1000", null, NaN, Infinity]) {
      expect(create({ commissionBpsDefault: bad }).success, String(bad)).toBe(
        false
      )
    }
  })

  it("only timed-slot categories are supported for now", () => {
    expect(create({ type: "TIMED_SLOT" }).success).toBe(true)

    for (const type of ["DATE_RANGE", "TABLE", "PASS", "nonsense"]) {
      expect(create({ type }).success, type).toBe(false)
    }
  })

  it("trims and bounds the name", () => {
    const trimmed = create({ name: "  Walks  " })

    expect(trimmed.success && trimmed.data.name).toBe("Walks")
    expect(create({ name: "   " }).success).toBe(false)
    expect(create({ name: "x".repeat(81) }).success).toBe(false)
    expect(create({ name: "x".repeat(80) }).success).toBe(true)
  })

  it("slugs must be clean and must not be a page of the site", () => {
    expect(create({ slug: "food-drink" }).success).toBe(true)

    for (const slug of ["Food", "a b", "-a", "admin", "api", "sign-in", ""]) {
      expect(create({ slug }).success, slug).toBe(false)
    }
  })

  it("events is a usable slug: /events is a category, not a reserved page", () => {
    expect(create({ slug: "events" }).success).toBe(true)
  })

  it("rejects fields it does not know instead of ignoring them", () => {
    expect(create({ id: "x" }).success).toBe(false)
    expect(create({ createdAt: new Date() }).success).toBe(false)
  })
})

describe("updateCategorySchema", () => {
  it("needs an id and at least one change", () => {
    expect(updateCategorySchema.safeParse({ id: "c1" }).success).toBe(false)
    expect(updateCategorySchema.safeParse({ name: "x" }).success).toBe(false)
    expect(
      updateCategorySchema.safeParse({ id: "c1", name: "x" }).success
    ).toBe(true)
  })

  it("null parent means top level, and is a change", () => {
    const result = updateCategorySchema.safeParse({ id: "c1", parentId: null })

    expect(result.success && result.data.parentId).toBeNull()
  })

  it("the type cannot be edited, and the bounds still apply", () => {
    expect(
      updateCategorySchema.safeParse({ id: "c1", type: "TIMED_SLOT" }).success
    ).toBe(false)
    expect(
      updateCategorySchema.safeParse({ id: "c1", commissionBpsDefault: 10_001 })
        .success
    ).toBe(false)
    expect(
      updateCategorySchema.safeParse({ id: "c1", commissionBpsDefault: 0 })
        .success
    ).toBe(true)
  })
})

describe("deleteCategorySchema", () => {
  it("needs only an id", () => {
    expect(deleteCategorySchema.safeParse({ id: "c1" }).success).toBe(true)
    expect(deleteCategorySchema.safeParse({}).success).toBe(false)
    expect(
      deleteCategorySchema.safeParse({ id: "c1", force: true }).success
    ).toBe(false)
  })
})
