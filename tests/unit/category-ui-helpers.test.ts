import { describe, expect, it } from "vitest"
import { bpsToPercent, percentToBps } from "@/lib/categories/commission"
import {
  buildCategoryTree,
  descendantIds,
  flattenCategoryTree,
} from "@/lib/categories/tree"

describe("percentToBps", () => {
  it.each([
    ["10", 1000],
    ["0", 0],
    ["100", 10_000],
    ["12.5", 1250],
    ["0.05", 5],
    [" 7.25 ", 725],
    ["7.", Number.NaN],
    ["12.345", Number.NaN],
    ["-1", Number.NaN],
    ["1e2", Number.NaN],
    ["abc", Number.NaN],
    ["", Number.NaN],
    ["1,5", Number.NaN],
    ["1000", Number.NaN],
  ])("%j gives %s", (text, bps) => {
    expect(percentToBps(text)).toEqual(bps)
  })

  it("is exact for every value an admin could type", () => {
    for (let hundredths = 0; hundredths <= 10_000; hundredths += 1) {
      const text = (hundredths / 100).toFixed(2)

      expect(percentToBps(text)).toBe(hundredths)
    }
  })
})

describe("bpsToPercent", () => {
  it.each([
    [1000, "10"],
    [1250, "12.5"],
    [5, "0.05"],
    [0, "0"],
    [10_000, "100"],
  ])("%s is %s", (bps, text) => {
    expect(bpsToPercent(bps)).toBe(text)
  })

  it("round-trips through percentToBps", () => {
    for (const bps of [0, 5, 100, 1000, 1234, 9999, 10_000]) {
      expect(percentToBps(bpsToPercent(bps))).toBe(bps)
    }
  })
})

describe("flattenCategoryTree and descendantIds", () => {
  const rows = [
    { id: "tours", parentId: null },
    { id: "walks", parentId: "tours" },
    { id: "river", parentId: "walks" },
    { id: "events", parentId: null },
  ]
  const tree = buildCategoryTree(rows)

  it("lists parents before children with their depth", () => {
    expect(flattenCategoryTree(tree).map((n) => [n.id, n.depth])).toEqual([
      ["tours", 0],
      ["walks", 1],
      ["river", 2],
      ["events", 0],
    ])
  })

  it("does not carry the children along", () => {
    expect(flattenCategoryTree(tree)[0]).not.toHaveProperty("children")
  })

  it("finds a category and everything beneath it", () => {
    expect([...descendantIds(rows, "tours")].sort()).toEqual([
      "river",
      "tours",
      "walks",
    ])
    expect([...descendantIds(rows, "river")]).toEqual(["river"])
    expect([...descendantIds(rows, "events")]).toEqual(["events"])
  })
})
