import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  nextModerationStatus,
  moderationAuditAction,
} from "@/lib/listings/moderation"
import { moderateListing } from "@/lib/services/listing-moderation"
import { listingModerationSchema } from "@/lib/validation/listing-moderation"

const as =
  (platformRole: string | null): SessionSource =>
  async () =>
    platformRole
      ? {
          user: {
            id: "u1",
            email: "a@example.com",
            name: "A",
            emailVerified: true,
            platformRole,
          },
        }
      : null

/** A database that fails the test if anything reaches it. */
const untouchedDb = {
  $transaction: async () => {
    throw new Error("the database must not be reached")
  },
} as never

describe("TC-E9S1-01/-02 moderation transitions", () => {
  it("TC-E9S1-01: approve moves PENDING_REVIEW to PUBLISHED", () => {
    expect(nextModerationStatus("PENDING_REVIEW", "approve")).toBe("PUBLISHED")
  })

  it("TC-E9S1-02: reject moves PENDING_REVIEW to REJECTED", () => {
    expect(nextModerationStatus("PENDING_REVIEW", "reject")).toBe("REJECTED")
  })

  it.each(["DRAFT", "PUBLISHED", "REJECTED", "ARCHIVED"] as const)(
    "a %s listing cannot be approved or rejected",
    (status) => {
      expect(() => nextModerationStatus(status, "approve")).toThrow(
        ConflictError
      )
      expect(() => nextModerationStatus(status, "reject")).toThrow(
        ConflictError
      )
    }
  )

  it("maps each action to its audit name", () => {
    expect(moderationAuditAction("approve")).toBe("listing.approved")
    expect(moderationAuditAction("reject")).toBe("listing.rejected")
  })
})

describe("listingModerationSchema", () => {
  const base = { listingId: "l1", action: "approve" }

  it("accepts an approval with no reason", () => {
    expect(listingModerationSchema.safeParse(base).success).toBe(true)
  })

  it("requires a reason to reject", () => {
    const result = listingModerationSchema.safeParse({
      listingId: "l1",
      action: "reject",
    })

    expect(result.success).toBe(false)
  })

  it("rejects a blank reason to reject", () => {
    const result = listingModerationSchema.safeParse({
      listingId: "l1",
      action: "reject",
      reason: "   ",
    })

    expect(result.success).toBe(false)
  })

  it("rejects a target status: the caller names an action only", () => {
    const result = listingModerationSchema.safeParse({
      ...base,
      status: "PUBLISHED",
    })

    expect(result.success).toBe(false)
  })

  it("rejects an unknown action", () => {
    const result = listingModerationSchema.safeParse({
      listingId: "l1",
      action: "publish",
    })

    expect(result.success).toBe(false)
  })
})

describe("moderateListing authorization and validation", () => {
  it("refuses a signed-out caller before reading anything", async () => {
    await expect(
      moderateListing(base(), { session: as(null), db: untouchedDb })
    ).rejects.toThrow()
  })

  it("refuses a vendor: only an admin can moderate", async () => {
    await expect(
      moderateListing(base(), { session: as("VENDOR"), db: untouchedDb })
    ).rejects.toThrow(ForbiddenError)
  })

  it("refuses a tourist too", async () => {
    await expect(
      moderateListing(base(), { session: as("TOURIST"), db: untouchedDb })
    ).rejects.toThrow(ForbiddenError)
  })

  it("rejects invalid input before the database is reached", async () => {
    await expect(
      moderateListing(
        { listingId: "l1", action: "reject" },
        { session: as("ADMIN"), db: untouchedDb }
      )
    ).rejects.toThrow(ValidationError)
  })
})

function base() {
  return { listingId: "l1", action: "approve" }
}
