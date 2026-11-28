import { describe, expect, it } from "vitest"
import { commissionAmount, refundCommissionShare } from "@/lib/money/commission"

/** A small seeded generator, so the property cases are the same every run. */
function rng(seed: number) {
  let state = seed >>> 0

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0

    return state / 0x100000000
  }
}

/** Splits `total` into `parts` whole, non-negative pieces that add up to it. */
function split(total: number, parts: number, next: () => number): number[] {
  const cuts = Array.from({ length: parts - 1 }, () =>
    Math.floor(next() * (total + 1))
  ).sort((a, b) => a - b)
  const bounds = [0, ...cuts, total]

  return bounds.slice(1).map((b, i) => b - bounds[i]!)
}

describe("refund commission shares reconcile to the penny (E10-S1-04)", () => {
  it("three refunds of 333, 333 and 334 on £10.00 at 10% give shares 33, 34 and 33", () => {
    const shares = [
      refundCommissionShare(0, 333, 1000, 100),
      refundCommissionShare(333, 333, 1000, 100),
      refundCommissionShare(666, 334, 1000, 100),
    ]

    expect(shares).toEqual([33, 34, 33])
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100)
  })

  it("over many random items and splits, the shares add up to the item's commission exactly", () => {
    const next = rng(20261128)
    const rates = [0, 500, 1000, 1250, 1337, 2500, 10_000]

    for (let i = 0; i < 400; i += 1) {
      const subtotal = 1 + Math.floor(next() * 20_000)
      const bps = rates[Math.floor(next() * rates.length)]!
      const commission = commissionAmount(subtotal, bps)
      const pieces = split(subtotal, 1 + Math.floor(next() * 6), next)

      let refunded = 0
      let shared = 0
      for (const piece of pieces) {
        const share = refundCommissionShare(
          refunded,
          piece,
          subtotal,
          commission
        )

        expect(share).toBeGreaterThanOrEqual(0)
        expect(share).toBeLessThanOrEqual(piece)
        shared += share
        refunded += piece
      }

      expect(shared).toBe(commission)
    }
  })

  it("refuses a refund that would take the total past the subtotal", () => {
    expect(() => refundCommissionShare(900, 200, 1000, 100)).toThrow(RangeError)
  })
})
