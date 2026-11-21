import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { ForbiddenError, ValidationError } from "@/lib/errors"
import {
  getVendorForAdmin,
  listVendorsForAdmin,
} from "@/lib/services/vendor-admin"

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

const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("the database must not be reached")
    },
  }
) as never

describe("admin vendor reads", () => {
  it("TC-E8S1-41: non-admins and signed-out visitors are refused before the database is touched", async () => {
    for (const role of ["TOURIST", "VENDOR"]) {
      const deps = { session: as(role), db: untouched }

      await expect(listVendorsForAdmin({}, deps)).rejects.toBeInstanceOf(
        ForbiddenError
      )
      await expect(getVendorForAdmin("v1", deps)).rejects.toBeInstanceOf(
        ForbiddenError
      )
    }

    const signedOut = { session: as(null), db: untouched }
    await expect(listVendorsForAdmin({}, signedOut)).rejects.toMatchObject({
      status: 401,
    })
    await expect(getVendorForAdmin("v1", signedOut)).rejects.toMatchObject({
      status: 401,
    })
  })

  it("TC-E8S1-42: a non-admin gets a permission error even for input that would be invalid", async () => {
    await expect(
      listVendorsForAdmin(
        { status: "NOPE" },
        { session: as("VENDOR"), db: untouched }
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E8S1-43: bad input from an admin is a ValidationError, before any query", async () => {
    const deps = { session: as("ADMIN"), db: untouched }

    for (const input of [
      { status: "DELETED" },
      { status: "APPROVED", extra: 1 },
      "x",
    ]) {
      await expect(listVendorsForAdmin(input, deps)).rejects.toBeInstanceOf(
        ValidationError
      )
    }

    for (const id of ["", "   ", null, undefined, 5]) {
      await expect(getVendorForAdmin(id, deps)).rejects.toBeInstanceOf(
        ValidationError
      )
    }
  })
})
