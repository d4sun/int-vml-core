import { describe, expect, it } from "vitest"
import {
  createListingSchema,
  submitListingSchema,
  updateListingSchema,
} from "@/lib/validation/listing"

const create = (over: Record<string, unknown> = {}) =>
  createListingSchema.safeParse({
    vendorId: "v1",
    categoryId: "c1",
    title: "Thames Walk",
    ...over,
  })

describe("createListingSchema", () => {
  it("accepts the minimum and trims", () => {
    const result = create({ title: "  Thames Walk  " })

    expect(result.success && result.data).toMatchObject({
      title: "Thames Walk",
    })
  })

  it("bounds the title", () => {
    expect(create({ title: "ab" }).success).toBe(false)
    expect(create({ title: "abc" }).success).toBe(true)
    expect(create({ title: "x".repeat(120) }).success).toBe(true)
    expect(create({ title: "x".repeat(121) }).success).toBe(false)
  })

  it("bounds description and address, treating blank as none", () => {
    expect(create({ description: "x".repeat(5001) }).success).toBe(false)
    expect(create({ address: "x".repeat(201) }).success).toBe(false)

    const blank = create({ description: "  ", address: "" })

    expect(blank.success && blank.data.description).toBeNull()
    expect(blank.success && blank.data.address).toBeNull()
  })

  it("coordinates are in range, numeric, and both or neither", () => {
    expect(create({ lat: 51.5, lng: -0.12 }).success).toBe(true)
    expect(create({ lat: 90, lng: 180 }).success).toBe(true)
    expect(create({ lat: -90, lng: -180 }).success).toBe(true)

    for (const bad of [
      { lat: 90.1, lng: 0 },
      { lat: -90.1, lng: 0 },
      { lat: 0, lng: -180.1 },
      { lat: 0, lng: 180.1 },
      { lat: "51", lng: 0 },
      { lat: NaN, lng: 0 },
      { lat: 51.5 },
      { lng: -0.12 },
    ]) {
      expect(create(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("never accepts a status, slug, images or an owner from the caller", () => {
    for (const extra of [
      { status: "PUBLISHED" },
      { slug: "mine" },
      { images: ["a"] },
      { id: "x" },
    ]) {
      expect(create(extra).success, JSON.stringify(extra)).toBe(false)
    }
  })
})

describe("updateListingSchema", () => {
  const update = (over: Record<string, unknown>) =>
    updateListingSchema.safeParse({ id: "l1", ...over })

  it("needs a change, and the id", () => {
    expect(updateListingSchema.safeParse({ title: "Abc" }).success).toBe(false)
    expect(update({}).success).toBe(false)
    expect(update({ title: "Abc" }).success).toBe(true)
  })

  it("blank description or address clears it", () => {
    const result = update({ description: "", address: " " })

    expect(result.success && result.data).toMatchObject({
      description: null,
      address: null,
    })
  })

  it("the location is set or cleared as a pair", () => {
    expect(update({ lat: 51.5, lng: -0.1 }).success).toBe(true)
    expect(update({ lat: null, lng: null }).success).toBe(true)
    expect(update({ lat: 51.5 }).success).toBe(false)
    expect(update({ lat: 51.5, lng: null }).success).toBe(false)
    expect(update({ lat: null, lng: -0.1 }).success).toBe(false)
  })

  it("never accepts a status or a vendor change", () => {
    expect(update({ status: "PUBLISHED" }).success).toBe(false)
    expect(update({ vendorId: "other" }).success).toBe(false)
    expect(update({ slug: "x" }).success).toBe(false)
  })
})

describe("submitListingSchema", () => {
  it("needs only an id", () => {
    expect(submitListingSchema.safeParse({ id: "l1" }).success).toBe(true)
    expect(submitListingSchema.safeParse({}).success).toBe(false)
    expect(
      submitListingSchema.safeParse({ id: "l1", status: "PUBLISHED" }).success
    ).toBe(false)
  })
})
