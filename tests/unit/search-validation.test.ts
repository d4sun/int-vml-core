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
