import { describe, expect, it } from "vitest"
import { summarize } from "@/lib/services/metrics"
import { metricsRangeSchema } from "@/lib/validation/metrics"

describe("metrics arithmetic (E10-S2-04)", () => {
  it("GMV is the sum of booking totals, and fee revenue the sum of item commissions", () => {
    const s = summarize(
      [
        { total: 1500, items: [{ commissionAmount: 150 }] },
        {
          total: 3000,
          items: [{ commissionAmount: 100 }, { commissionAmount: 200 }],
        },
      ],
      [{ amount: 500 }, { amount: 250 }]
    )

    expect(s).toEqual({
      gmv: 4500,
      feeRevenue: 450,
      bookings: 2,
      items: 3,
      refunded: 750,
    })
  })

  it("an empty range gives zeros", () => {
    expect(summarize([], [])).toEqual({
      gmv: 0,
      feeRevenue: 0,
      bookings: 0,
      items: 0,
      refunded: 0,
    })
  })
})

describe("metrics date range", () => {
  it("accepts both dates, or neither", () => {
    expect(metricsRangeSchema.safeParse({}).success).toBe(true)
    expect(
      metricsRangeSchema.safeParse({ from: "2026-11-01", to: "2026-11-30" })
        .success
    ).toBe(true)
    expect(metricsRangeSchema.safeParse({ from: "2026-11-01" }).success).toBe(
      false
    )
  })

  it("refuses a range that ends before it starts, or a date that does not exist", () => {
    expect(
      metricsRangeSchema.safeParse({ from: "2026-11-10", to: "2026-11-01" })
        .success
    ).toBe(false)
    expect(
      metricsRangeSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" })
        .success
    ).toBe(false)
  })
})
