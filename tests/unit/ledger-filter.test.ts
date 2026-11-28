import { describe, expect, it } from "vitest"
import { ledgerFilterSchema } from "@/lib/validation/ledger"

describe("ledger filters (E10-S2-01)", () => {
  it("defaults to every kind over all dates", () => {
    expect(ledgerFilterSchema.parse({})).toEqual({ kind: "all" })
  })

  it("accepts one kind and a London date range", () => {
    expect(
      ledgerFilterSchema.parse({
        kind: "refund",
        from: "2026-11-01",
        to: "2026-11-30",
      })
    ).toEqual({ kind: "refund", from: "2026-11-01", to: "2026-11-30" })
  })

  it("refuses an unknown kind", () => {
    expect(ledgerFilterSchema.safeParse({ kind: "dispute" }).success).toBe(
      false
    )
  })

  it("refuses a date that does not exist, or one date without the other", () => {
    expect(
      ledgerFilterSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" })
        .success
    ).toBe(false)
    expect(ledgerFilterSchema.safeParse({ from: "2026-11-01" }).success).toBe(
      false
    )
  })

  it("refuses a range that ends before it starts", () => {
    expect(
      ledgerFilterSchema.safeParse({ from: "2026-11-10", to: "2026-11-01" })
        .success
    ).toBe(false)
  })
})
