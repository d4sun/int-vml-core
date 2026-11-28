import { describe, expect, it } from "vitest"
import { proportionalAmount } from "@/lib/money/commission"

describe("proportional amounts, half to even (E10-S1-02)", () => {
  it("takes the exact share when it divides evenly", () => {
    expect(proportionalAmount(600, 100, 1000)).toBe(60)
    expect(proportionalAmount(1000, 100, 1000)).toBe(100)
  })

  it("rounds a half penny to the even penny", () => {
    // 2.5 -> 2 (even), 3.5 -> 4 (even)
    expect(proportionalAmount(5, 1, 2)).toBe(2)
    expect(proportionalAmount(7, 1, 2)).toBe(4)
  })

  it("rounds up when the remainder is more than half", () => {
    // 1/3 of 2 is 0.666… -> 1
    expect(proportionalAmount(1, 2, 3)).toBe(1)
  })

  it("refuses a zero whole, a negative or a fractional amount", () => {
    expect(() => proportionalAmount(5, 1, 0)).toThrow(RangeError)
    expect(() => proportionalAmount(-5, 1, 2)).toThrow(RangeError)
    expect(() => proportionalAmount(5.5, 1, 2)).toThrow(RangeError)
  })
})
