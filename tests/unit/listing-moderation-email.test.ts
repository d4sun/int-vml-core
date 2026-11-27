import { describe, expect, it } from "vitest"
import {
  buildListingEmail,
  listingEmailJobId,
  listingEmailKind,
} from "@/lib/services/listing-moderation-notifications"

const to = { email: "Olive@Example.com", name: "Olive" }

describe("listing decision emails", () => {
  it("TC-E9S1-04: the approval says the listing is live and links to the vendor's listings", () => {
    const message = buildListingEmail("approve", to, {
      listingTitle: "Thames Walk",
      appUrl: "https://vml.example/",
    })

    expect(message.tags).toEqual({ kind: "listing-approved" })
    expect(message.subject).toContain("Thames Walk")
    expect(message.html).toContain("https://vml.example/vendor/listings")
    expect(message.html).not.toContain("https://vml.example//vendor")
  })

  it("TC-E9S1-04: the rejection carries the reason and asks for changes", () => {
    const message = buildListingEmail("reject", to, {
      listingTitle: "Thames Walk",
      reason: "Photos are blurred",
      appUrl: "https://vml.example",
    })

    expect(message.tags).toEqual({ kind: "listing-rejected" })
    expect(message.subject).toContain("Changes needed")
    expect(message.text).toContain("Reason: Photos are blurred")
  })

  it("leaves the reason out of the approval and of a rejection with none", () => {
    const approved = buildListingEmail("approve", to, {
      listingTitle: "Thames Walk",
      reason: "should not appear",
      appUrl: "https://vml.example",
    })
    const rejected = buildListingEmail("reject", to, {
      listingTitle: "Thames Walk",
      appUrl: "https://vml.example",
    })

    expect(approved.text).not.toContain("should not appear")
    expect(rejected.text).not.toContain("Reason:")
  })

  it("escapes the title and the reason in HTML", () => {
    const message = buildListingEmail("reject", to, {
      listingTitle: "<img src=x onerror=alert(1)>",
      reason: "<script>bad()</script>",
      appUrl: "https://vml.example",
    })

    expect(message.html).not.toContain("<script>bad()")
    expect(message.html).not.toContain("<img src=x")
  })

  it("maps each action to its kind", () => {
    expect(listingEmailKind("approve")).toBe("listing-approved")
    expect(listingEmailKind("reject")).toBe("listing-rejected")
  })

  it("job ids are stable per decision and recipient, ignoring address case", () => {
    const a = listingEmailJobId("audit-1", "Olive@Example.com")

    expect(a).toBe(listingEmailJobId("audit-1", "olive@example.com"))
    expect(a).not.toBe(listingEmailJobId("audit-2", "olive@example.com"))
    expect(a).not.toBe(listingEmailJobId("audit-1", "sam@example.com"))
  })
})
