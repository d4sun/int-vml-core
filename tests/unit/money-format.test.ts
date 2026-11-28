import { describe, expect, it } from "vitest"
import { formatPence } from "@/lib/money/format"

describe("formatPence", () => {
  it("shows whole pence as pounds with two decimals", () => {
    expect(formatPence(1250)).toBe("£12.50")
    expect(formatPence(0)).toBe("£0.00")
    expect(formatPence(5)).toBe("£0.05")
    expect(formatPence(100000)).toBe("£1000.00")
  })

  it("shows a negative amount with a leading minus", () => {
    expect(formatPence(-150)).toBe("-£1.50")
  })
})
