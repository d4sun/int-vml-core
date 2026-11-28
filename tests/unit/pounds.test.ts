import { describe, expect, it } from "vitest"
import { poundsToPence } from "@/lib/money/pounds"

describe("typed pounds to pence (E10-S1-07)", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["£3.05", 305],
    ["  0.01 ", 1],
  ])("reads %s as %i pence", (text, pence) => {
    expect(poundsToPence(text)).toBe(pence)
  })

  it.each(["", "-1", "1.234", "twelve", "1,000", "£"])("refuses %s", (text) => {
    expect(poundsToPence(text)).toBeNaN()
  })
})
