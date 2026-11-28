import { describe, expect, it } from "vitest"
import { buildEarnings, netOf } from "@/lib/services/vendor-earnings"

describe("vendor earnings arithmetic (E6-S2-01)", () => {
  it("net is gross less commission less refunds, in whole pence", () => {
    expect(netOf(1500, 150, 0)).toBe(1350)
    expect(netOf(3000, 300, 500)).toBe(2200)
  })

  it("groups sales and refunds by month, newest month first, and totals them", () => {
    const e = buildEarnings(
      [
        { period: "2026-10", subtotal: 1000, commission: 100 },
        { period: "2026-11", subtotal: 2000, commission: 200 },
        { period: "2026-11", subtotal: 500, commission: 50 },
      ],
      [{ period: "2026-11", amount: 400 }]
    )

    expect(e.periods).toEqual([
      {
        period: "2026-11",
        gross: 2500,
        commission: 250,
        refunds: 400,
        net: 1850,
      },
      { period: "2026-10", gross: 1000, commission: 100, refunds: 0, net: 900 },
    ])
    expect(e.totals).toEqual({
      gross: 3500,
      commission: 350,
      refunds: 400,
      net: 2750,
    })
  })

  it("a refund in a month with no sales still shows that month", () => {
    const e = buildEarnings([], [{ period: "2026-11", amount: 250 }])

    expect(e.periods).toEqual([
      { period: "2026-11", gross: 0, commission: 0, refunds: 250, net: -250 },
    ])
  })
})
