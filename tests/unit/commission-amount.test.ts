import { describe, expect, it } from "vitest"
import { commissionAmount, splitSale } from "@/lib/money/commission"

/** Exact reference: commission = round-half-even(subtotal * bps / 10000), with rationals. */
function reference(subtotal: number, bps: number): number {
  const num = subtotal * bps
  const floor = Math.floor(num / 10000)
  const rem = num - floor * 10000
  if (rem * 2 > 10000) return floor + 1
  if (rem * 2 === 10000) return floor % 2 === 0 ? floor : floor + 1
  return floor
}

describe("commission amount (IT-20: integer pence, no float drift)", () => {
  it("is exact for whole results", () => {
    expect(commissionAmount(1000, 1000)).toBe(100)
    expect(commissionAmount(4500, 1000)).toBe(450)
  })

  it("rounds a half penny to the even penny", () => {
    // 5 pence at 50% is 2.5: the even neighbour is 2.
    expect(commissionAmount(5, 5000)).toBe(2)
    // 7 pence at 50% is 3.5: the even neighbour is 4.
    expect(commissionAmount(7, 5000)).toBe(4)
  })

  it("rounds down below a half and up above it", () => {
    expect(commissionAmount(1, 4000)).toBe(0) // 0.4
    expect(commissionAmount(3, 5000)).toBe(2) // 1.5 -> 2
    expect(commissionAmount(1, 6000)).toBe(1) // 0.6
  })

  it("agrees with the exact reference over many inputs", () => {
    for (let subtotal = 0; subtotal <= 2000; subtotal += 7) {
      for (const bps of [
        0, 1, 333, 1000, 1250, 2500, 4999, 5000, 9999, 10000,
      ]) {
        expect(commissionAmount(subtotal, bps)).toBe(reference(subtotal, bps))
      }
    }
  })

  it("never exceeds the subtotal, and the two shares always add back to it", () => {
    for (let subtotal = 0; subtotal <= 500; subtotal += 3) {
      for (const bps of [0, 1000, 5000, 10000]) {
        const { commission, vendorShare } = splitSale(subtotal, bps)
        expect(commission).toBeLessThanOrEqual(subtotal)
        expect(commission + vendorShare).toBe(subtotal)
        expect(Number.isInteger(commission)).toBe(true)
      }
    }
  })

  it("refuses a fraction of a penny or of a basis point", () => {
    expect(() => commissionAmount(10.5, 1000)).toThrow(RangeError)
    expect(() => commissionAmount(100, 10.5)).toThrow(RangeError)
    expect(() => commissionAmount(-1, 1000)).toThrow(RangeError)
    expect(() => commissionAmount(100, 10001)).toThrow(RangeError)
  })
})
