import { describe, expect, it } from "vitest"
import { ConflictError } from "@/lib/errors"
import { planCharge, type PlannedItem } from "@/lib/services/payment"

const item = (over: Partial<PlannedItem>): PlannedItem => ({
  vendorId: "v1",
  stripeAccountId: "acct_1",
  subtotal: 1000,
  commissionAmount: 100,
  ...over,
})

describe("how a booking is charged (D3)", () => {
  it("TC-E2S2-01: a single vendor is a destination charge, with the fee the sum of the commissions", () => {
    const plan = planCharge([
      item({ subtotal: 1000, commissionAmount: 100 }),
      item({ subtotal: 500, commissionAmount: 50 }),
    ])

    expect(plan).toEqual({
      mode: "DESTINATION",
      amount: 1500,
      destinationAccountId: "acct_1",
      applicationFeeAmount: 150,
      transfers: [],
    })
  })

  it("TC-E2S2-02: several vendors are one platform charge with one planned transfer per vendor", () => {
    const plan = planCharge([
      item({
        vendorId: "a",
        stripeAccountId: "acct_a",
        subtotal: 1000,
        commissionAmount: 100,
      }),
      item({
        vendorId: "b",
        stripeAccountId: "acct_b",
        subtotal: 2000,
        commissionAmount: 200,
      }),
      item({
        vendorId: "a",
        stripeAccountId: "acct_a",
        subtotal: 500,
        commissionAmount: 50,
      }),
    ])

    expect(plan.mode).toBe("PLATFORM")
    expect(plan.amount).toBe(3500)
    expect(plan.transfers).toEqual([
      { vendorId: "a", stripeAccountId: "acct_a", amount: 1350 },
      { vendorId: "b", stripeAccountId: "acct_b", amount: 1800 },
    ])
    // The transfers plus the commission always add back to the amount charged.
    const transferred = plan.transfers.reduce((s, t) => s + t.amount, 0)
    expect(transferred + 100 + 200 + 50).toBe(plan.amount)
  })

  it("a vendor that cannot be paid yet blocks the charge", () => {
    expect(() => planCharge([item({ stripeAccountId: null })])).toThrow(
      ConflictError
    )
  })

  it("an empty booking is not charged", () => {
    expect(() => planCharge([])).toThrow(ConflictError)
  })
})
