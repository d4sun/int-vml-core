import { describe, expect, it } from "vitest"
import { searchQuerySchema, SEARCH_MAX_PAGE } from "@/lib/validation/search"

describe("searchQuerySchema", () => {
  it("treats blank text and category as no filter", () => {
    const parsed = searchQuerySchema.parse({ q: "   ", category: "" })

    expect(parsed.q).toBeUndefined()
    expect(parsed.category).toBeUndefined()
    expect(parsed.page).toBe(1)
  })

  it("trims text and keeps the category slug", () => {
    const parsed = searchQuerySchema.parse({
      q: "  thames walk ",
      category: "tours",
    })

    expect(parsed.q).toBe("thames walk")
    expect(parsed.category).toBe("tours")
  })

  it("accepts a price range in whole pence", () => {
    const parsed = searchQuerySchema.parse({ minPrice: 0, maxPrice: 5000 })

    expect(parsed.minPrice).toBe(0)
    expect(parsed.maxPrice).toBe(5000)
  })

  it("refuses fractional or negative pence", () => {
    expect(searchQuerySchema.safeParse({ minPrice: 12.5 }).success).toBe(false)
    expect(searchQuerySchema.safeParse({ maxPrice: -1 }).success).toBe(false)
  })

  it("refuses a minimum above the maximum, on the maximum field", () => {
    const result = searchQuerySchema.safeParse({
      minPrice: 5000,
      maxPrice: 1000,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(["maxPrice"])
  })

  it("keeps the page within bounds", () => {
    expect(searchQuerySchema.safeParse({ page: 0 }).success).toBe(false)
    expect(
      searchQuerySchema.safeParse({ page: SEARCH_MAX_PAGE + 1 }).success
    ).toBe(false)
    expect(searchQuerySchema.safeParse({ page: 3 }).data?.page).toBe(3)
  })

  it("refuses text longer than the limit", () => {
    expect(searchQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(
      false
    )
  })
})

import { isRealDate } from "@/lib/validation/search"
import { londonDayBounds } from "@/lib/time/london"

describe("date filter", () => {
  it("accepts a real YYYY-MM-DD date and refuses anything else", () => {
    expect(isRealDate("2026-07-01")).toBe(true)
    expect(isRealDate("2026-02-31")).toBe(false)
    expect(isRealDate("2026-1-5")).toBe(false)
    expect(searchQuerySchema.safeParse({ date: "2026-02-30" }).success).toBe(
      false
    )
    expect(searchQuerySchema.parse({ date: "" }).date).toBeUndefined()
  })

  it("maps a summer London day (BST) to the UTC hours before and after it", () => {
    const bounds = londonDayBounds({ year: 2026, month: 7, day: 1 })

    expect(bounds.from.toISOString()).toBe("2026-06-30T23:00:00.000Z")
    expect(bounds.to.toISOString()).toBe("2026-07-01T23:00:00.000Z")
  })

  it("maps a winter London day (GMT) to UTC midnight", () => {
    const bounds = londonDayBounds({ year: 2026, month: 1, day: 15 })

    expect(bounds.from.toISOString()).toBe("2026-01-15T00:00:00.000Z")
    expect(bounds.to.toISOString()).toBe("2026-01-16T00:00:00.000Z")
  })
})
