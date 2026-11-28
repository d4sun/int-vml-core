import { describe, expect, it } from "vitest"
import { requestRefundSchema } from "@/lib/validation/refund"

const base = { bookingItemId: "item_1", amount: 500 }

describe("refund request schema (E10-S1-01)", () => {
  it("accepts a whole, positive amount in pence", () => {
    expect(requestRefundSchema.safeParse(base).success).toBe(true)
  })

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional pence", 10.5],
    ["not a number", "500"],
  ])("rejects an amount that is %s", (_label, amount) => {
    expect(requestRefundSchema.safeParse({ ...base, amount }).success).toBe(
      false
    )
  })

  it("rejects an unknown field, so nothing else can be set through this path", () => {
    expect(
      requestRefundSchema.safeParse({ ...base, status: "succeeded" }).success
    ).toBe(false)
  })

  it("keeps a reason, and turns a blank one into none", () => {
    expect(
      requestRefundSchema.parse({ ...base, reason: "  Late cancel  " }).reason
    ).toBe("Late cancel")
    expect(requestRefundSchema.parse({ ...base, reason: "   " }).reason).toBe(
      undefined
    )
  })

  it("refuses a reason longer than 500 characters", () => {
    expect(
      requestRefundSchema.safeParse({ ...base, reason: "x".repeat(501) })
        .success
    ).toBe(false)
  })
})
