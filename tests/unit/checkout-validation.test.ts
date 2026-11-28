import { describe, expect, it } from "vitest"
import { checkoutSchema, MAX_CHECKOUT_HOLDS } from "@/lib/validation/checkout"

describe("checkout input", () => {
  it("needs at least one hold, and no more than the limit", () => {
    expect(checkoutSchema.safeParse({ holdIds: ["h1"] }).success).toBe(true)
    expect(checkoutSchema.safeParse({ holdIds: [] }).success).toBe(false)
    expect(
      checkoutSchema.safeParse({
        holdIds: Array.from(
          { length: MAX_CHECKOUT_HOLDS + 1 },
          (_, i) => `h${i}`
        ),
      }).success
    ).toBe(false)
  })

  it("refuses a hold listed twice", () => {
    expect(checkoutSchema.safeParse({ holdIds: ["h1", "h1"] }).success).toBe(
      false
    )
  })

  it("refuses any price, total or vendor from the caller", () => {
    expect(
      checkoutSchema.safeParse({ holdIds: ["h1"], total: 0 }).success
    ).toBe(false)
    expect(
      checkoutSchema.safeParse({ holdIds: ["h1"], unitPrice: 1 }).success
    ).toBe(false)
    expect(
      checkoutSchema.safeParse({ holdIds: ["h1"], vendorId: "v" }).success
    ).toBe(false)
  })
})
