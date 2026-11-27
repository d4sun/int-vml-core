import { describe, expect, it } from "vitest"
import { searchHref, searchInputFromParams } from "@/lib/search/params"

describe("filter form values", () => {
  it("reads the price fields in pounds and stores them in pence", () => {
    const input = searchInputFromParams({ minPounds: "12.5", maxPounds: "40" })

    expect(input.minPrice).toBe(1250)
    expect(input.maxPrice).toBe(4000)
  })

  it("keeps a non-numeric price as NaN so the schema refuses it", () => {
    expect(
      Number.isNaN(searchInputFromParams({ maxPounds: "ten" }).maxPrice)
    ).toBe(true)
  })

  it("reads the map area as four edges", () => {
    const input = searchInputFromParams({
      south: "51.4",
      north: "51.6",
      west: "-0.3",
      east: "0",
    })

    expect(input).toMatchObject({
      south: 51.4,
      north: 51.6,
      west: -0.3,
      east: 0,
    })
  })
})

describe("search links", () => {
  it("leaves out unset filters and keeps the ones that are set", () => {
    expect(searchHref({ q: "walk", minPrice: undefined, page: 2 })).toBe(
      "/explore?q=walk&page=2"
    )
  })

  it("is plain /explore when nothing is set", () => {
    expect(searchHref({ q: "", page: undefined })).toBe("/explore")
  })

  it("drops NaN and encodes text", () => {
    expect(searchHref({ q: "tea & cake", maxPrice: Number.NaN })).toBe(
      "/explore?q=tea+%26+cake"
    )
  })
})
