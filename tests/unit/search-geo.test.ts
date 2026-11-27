import { describe, expect, it } from "vitest"
import { boxCentre, haversineKm } from "@/lib/search/geo"
import { searchQuerySchema } from "@/lib/validation/search"

const LONDON = { lat: 51.5074, lng: -0.1278 }
const PARIS = { lat: 48.8566, lng: 2.3522 }

describe("haversine distance", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(LONDON, LONDON)).toBeCloseTo(0, 9)
  })

  it("matches the known London to Paris distance (about 344 km)", () => {
    expect(haversineKm(LONDON, PARIS)).toBeCloseTo(343.5, 0)
  })

  it("is symmetric", () => {
    expect(haversineKm(LONDON, PARIS)).toBeCloseTo(
      haversineKm(PARIS, LONDON),
      9
    )
  })

  it("finds the centre of a viewport", () => {
    expect(boxCentre({ south: 51, north: 52, west: -1, east: 0 })).toEqual({
      lat: 51.5,
      lng: -0.5,
    })
  })
})

describe("map viewport validation", () => {
  const box = { south: 51.4, north: 51.6, west: -0.3, east: 0 }

  it("accepts a full viewport", () => {
    expect(searchQuerySchema.safeParse(box).success).toBe(true)
  })

  it("refuses a partial viewport", () => {
    const partial = { south: box.south, north: box.north, west: box.west }

    expect(searchQuerySchema.safeParse(partial).success).toBe(false)
  })

  it("refuses a south edge above the north edge", () => {
    expect(
      searchQuerySchema.safeParse({ ...box, south: 52, north: 51 }).success
    ).toBe(false)
  })

  it("refuses latitudes and longitudes out of range", () => {
    expect(searchQuerySchema.safeParse({ ...box, north: 91 }).success).toBe(
      false
    )
    expect(searchQuerySchema.safeParse({ ...box, east: 181 }).success).toBe(
      false
    )
  })
})
