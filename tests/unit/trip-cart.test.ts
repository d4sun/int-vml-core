import { describe, expect, it } from "vitest"
import {
  chooseSlot,
  londonDateOf,
  type BookableSlot,
} from "@/lib/services/trip-cart"

const slot = (id: string, startAt: string): BookableSlot => ({
  availabilityId: id,
  productName: "Walk",
  startAt: new Date(startAt),
  unitPrice: 1000,
  remaining: 2,
})

describe("choosing the slot a cart starts with", () => {
  const slots = [
    slot("early", "2030-06-02T09:00:00Z"),
    slot("planned", "2030-06-05T10:00:00Z"),
    slot("late", "2030-06-09T10:00:00Z"),
  ]

  it("TC-E1S2-04: prefers the earliest slot on the planned date", () => {
    expect(chooseSlot(slots, "2030-06-05")).toBe("planned")
  })

  it("falls back to the earliest slot when none is on the planned date", () => {
    expect(chooseSlot(slots, "2030-07-01")).toBe("early")
  })

  it("with no planned date, takes the earliest slot", () => {
    expect(chooseSlot(slots, null)).toBe("early")
  })

  it("nothing bookable gives nothing to preselect", () => {
    expect(chooseSlot([], "2030-06-05")).toBeNull()
  })

  it("uses the London day, so a late-evening BST slot lands on its London date", () => {
    // 23:30 UTC on 4 June is 00:30 on 5 June in London (BST).
    expect(londonDateOf(new Date("2030-06-04T23:30:00Z"))).toBe("2030-06-05")
  })
})
