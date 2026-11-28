import { describe, expect, it } from "vitest"
import { londonTime } from "@/lib/services/my-bookings"

describe("slot times on the bookings pages (TC-E3S1-02)", () => {
  it("shows summer times in London time (BST, one hour ahead of UTC)", () => {
    expect(londonTime(new Date("2030-06-01T10:00:00Z"))).toBe(
      "1 Jun 2030, 11:00"
    )
  })

  it("shows winter times in London time (GMT, the same as UTC)", () => {
    expect(londonTime(new Date("2030-01-15T10:00:00Z"))).toBe(
      "15 Jan 2030, 10:00"
    )
  })
})
