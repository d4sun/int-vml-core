import { describe, expect, it } from "vitest"
import { ConflictError } from "@/lib/errors"
import { nextItemStatus, noShowAllowed } from "@/lib/bookings/transitions"

describe("vendor booking item transitions", () => {
  it("TC-E6S1-01: a confirmed item can be fulfilled, or marked no-show", () => {
    expect(nextItemStatus("CONFIRMED", "fulfil")).toBe("FULFILLED")
    expect(nextItemStatus("CONFIRMED", "noShow")).toBe("NO_SHOW")
  })

  it("TC-E6S1-02: a refunded, cancelled, pending or already decided item cannot be acted on", () => {
    for (const status of [
      "REFUNDED",
      "CANCELLED",
      "PENDING",
      "FULFILLED",
      "NO_SHOW",
    ] as const) {
      expect(() => nextItemStatus(status, "fulfil")).toThrow(ConflictError)
      expect(() => nextItemStatus(status, "noShow")).toThrow(ConflictError)
    }
  })

  it("a no-show is only recorded once the slot has started", () => {
    const start = new Date("2030-06-01T10:00:00Z")

    expect(noShowAllowed(start, new Date("2030-06-01T09:59:00Z"))).toBe(false)
    expect(noShowAllowed(start, new Date("2030-06-01T10:00:00Z"))).toBe(true)
  })
})
