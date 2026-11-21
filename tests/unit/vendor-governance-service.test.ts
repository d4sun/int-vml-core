import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { ForbiddenError, ValidationError } from "@/lib/errors"
import { transitionVendor } from "@/lib/services/vendor-governance"

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

const valid = { vendorId: "v1", action: "approve" }

describe("transitionVendor authorization and validation", () => {
  it("TC-E8S1-04: a non-admin is refused before anything else happens", async () => {
    for (const role of ["TOURIST", "VENDOR"]) {
      await expect(
        transitionVendor(valid, { session: as(role), db: untouchedDb })
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
  })

  it("TC-E8S1-14: signed out is a 401, and still nothing reaches the database", async () => {
    await expect(
      transitionVendor(valid, { session: as(null), db: untouchedDb })
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" })
  })

  it("TC-E8S1-15: a non-admin learns nothing about the input (permission error, not a validation one)", async () => {
    await expect(
      transitionVendor(
        { nonsense: true },
        { session: as("VENDOR"), db: untouchedDb }
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E8S1-16: invalid input from an admin is a ValidationError with field errors, before any write", async () => {
    const error = await transitionVendor(
      { vendorId: "v1", action: "reject" },
      { session: as("ADMIN"), db: untouchedDb }
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(
      (error as ValidationError).fieldErrors?.reason?.length
    ).toBeGreaterThan(0)

    for (const input of [
      null,
      undefined,
      "approve",
      42,
      { status: "APPROVED" },
    ]) {
      await expect(
        transitionVendor(input, { session: as("ADMIN"), db: untouchedDb })
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })
})
