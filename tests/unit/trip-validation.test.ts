import { describe, expect, it } from "vitest"
import {
  addTripItemSchema,
  createTripSchema,
  TRIP_NAME_MAX_LENGTH,
} from "@/lib/validation/trip"

describe("trip input", () => {
  it("trims and requires a trip name, within the length limit", () => {
    expect(createTripSchema.parse({ name: "  Summer  " }).name).toBe("Summer")
    expect(createTripSchema.safeParse({ name: "   " }).success).toBe(false)
    expect(
      createTripSchema.safeParse({ name: "x".repeat(TRIP_NAME_MAX_LENGTH + 1) })
        .success
    ).toBe(false)
  })

  it("accepts an item with an optional real date and note, and refuses a date that is not real", () => {
    const ok = { tripId: "t", listingId: "l" }

    expect(addTripItemSchema.safeParse(ok).success).toBe(true)
    expect(
      addTripItemSchema.safeParse({
        ...ok,
        plannedDate: "2030-06-01",
        note: "Bring a coat",
      }).success
    ).toBe(true)
    expect(
      addTripItemSchema.safeParse({ ...ok, plannedDate: "2030-02-31" }).success
    ).toBe(false)
  })

  it("refuses a position or a user id from the caller", () => {
    expect(
      addTripItemSchema.safeParse({ tripId: "t", listingId: "l", position: 0 })
        .success
    ).toBe(false)
    expect(
      createTripSchema.safeParse({ name: "x", touristUserId: "u2" }).success
    ).toBe(false)
  })
})
