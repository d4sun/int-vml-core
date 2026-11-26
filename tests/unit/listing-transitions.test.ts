import { describe, expect, it } from "vitest"
import {
  MAJOR_FIELDS,
  VENDOR_LISTING_EVENTS,
  canVendorEdit,
  isMajorEdit,
  nextListingStatus,
} from "@/lib/listings/transitions"

const STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "ARCHIVED",
] as const

describe("nextListingStatus", () => {
  it("TC-E5S1-02: a draft or rejected listing is submitted to review", () => {
    expect(nextListingStatus("DRAFT", "submit")).toBe("PENDING_REVIEW")
    expect(nextListingStatus("REJECTED", "submit")).toBe("PENDING_REVIEW")
  })

  it("TC-E5S1-03: a major edit sends a published listing back to review", () => {
    expect(nextListingStatus("PUBLISHED", "majorEdit")).toBe("PENDING_REVIEW")
  })

  it("every other combination does not apply", () => {
    const allowed = new Set([
      "DRAFT:submit",
      "REJECTED:submit",
      "PUBLISHED:majorEdit",
    ])

    for (const status of STATUSES) {
      for (const event of VENDOR_LISTING_EVENTS) {
        expect(
          nextListingStatus(status, event) !== null,
          `${status} ${event}`
        ).toBe(allowed.has(`${status}:${event}`))
      }
    }
  })

  it("no vendor event, from any status, ever reaches PUBLISHED", () => {
    for (const status of STATUSES) {
      for (const event of VENDOR_LISTING_EVENTS) {
        expect(nextListingStatus(status, event), `${status} ${event}`).not.toBe(
          "PUBLISHED"
        )
      }
    }
  })
})

describe("canVendorEdit", () => {
  it("allows draft, rejected and published; freezes review and archive", () => {
    expect(STATUSES.filter(canVendorEdit)).toEqual([
      "DRAFT",
      "PUBLISHED",
      "REJECTED",
    ])
  })
})

describe("isMajorEdit", () => {
  it("each core field is major", () => {
    for (const field of MAJOR_FIELDS) expect(isMajorEdit([field])).toBe(true)
  })

  it("the core fields are exactly those a tourist sees or books by", () => {
    expect([...MAJOR_FIELDS].sort()).toEqual([
      "address",
      "categoryId",
      "description",
      "images",
      "lat",
      "lng",
      "title",
    ])
  })

  it("is major if any changed field is, and not for unknown or no fields", () => {
    expect(isMajorEdit(["images"])).toBe(true)
    expect(isMajorEdit(["slug", "title"])).toBe(true)
    expect(isMajorEdit(["slug"])).toBe(false)
    expect(isMajorEdit([])).toBe(false)
  })
})
