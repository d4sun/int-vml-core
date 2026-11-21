import { describe, expect, it } from "vitest"
import {
  requireAdmin,
  requireRole,
  requireUser,
  requireVendorMember,
  type MembershipStore,
  type SessionSource,
} from "@/lib/auth/guards"
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors"

const sessionFor =
  (user: Record<string, unknown>): SessionSource =>
  async () =>
    ({
      user: {
        id: "u1",
        email: "ada@example.com",
        name: "Ada",
        emailVerified: true,
        ...user,
      },
    }) as Awaited<ReturnType<SessionSource>>

describe("requireUser", () => {
  it("TC-E0S3-04: no session is an UnauthenticatedError (401), not a Forbidden", async () => {
    await expect(requireUser(async () => null)).rejects.toBeInstanceOf(
      UnauthenticatedError
    )
    await expect(requireUser(async () => null)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    })
  })

  it("TC-E0S3-05: returns a typed actor built from the session only", async () => {
    const actor = await requireUser(sessionFor({ platformRole: "VENDOR" }))

    expect(actor).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      emailVerified: true,
      platformRole: "VENDOR",
    })
  })

  it("TC-E0S3-06: a missing or unknown role falls back to TOURIST, never to a privileged role", async () => {
    for (const platformRole of [undefined, null, "", "SUPERUSER", "admin"]) {
      const actor = await requireUser(sessionFor({ platformRole }))

      expect(actor.platformRole, String(platformRole)).toBe("TOURIST")
    }

    expect(
      (await requireUser(sessionFor({ platformRole: "ADMIN" }))).platformRole
    ).toBe("ADMIN")
  })
})

const signedOut: SessionSource = async () => null

describe("requireRole", () => {
  it("TC-E0S3-07: returns the actor when the role matches, for one role or a list", async () => {
    const vendor = sessionFor({ platformRole: "VENDOR" })

    expect((await requireRole("VENDOR", vendor)).platformRole).toBe("VENDOR")
    expect((await requireRole(["VENDOR", "ADMIN"], vendor)).id).toBe("u1")
  })

  it("TC-E0S3-08: a different role is a ForbiddenError (403), and ADMIN does not satisfy VENDOR", async () => {
    for (const platformRole of ["TOURIST", "ADMIN"]) {
      await expect(
        requireRole("VENDOR", sessionFor({ platformRole }))
      ).rejects.toBeInstanceOf(ForbiddenError)
    }

    await expect(
      requireRole("VENDOR", sessionFor({ platformRole: "TOURIST" }))
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" })
  })

  it("TC-E0S3-09: no session is a 401, never a 403, even for a role that would be denied", async () => {
    await expect(requireRole("ADMIN", signedOut)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    })
  })

  it("TC-E0S3-10: an unknown role value cannot pass a privileged check", async () => {
    await expect(
      requireRole("ADMIN", sessionFor({ platformRole: "SUPERUSER" }))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("requireAdmin", () => {
  it("TC-E0S3-02: a vendor (or tourist) calling an admin action is denied; an admin passes", async () => {
    for (const platformRole of ["VENDOR", "TOURIST"]) {
      await expect(
        requireAdmin(sessionFor({ platformRole }))
      ).rejects.toMatchObject({ status: 403 })
    }

    expect((await requireAdmin(sessionFor({ platformRole: "ADMIN" }))).id).toBe(
      "u1"
    )
    await expect(requireAdmin(signedOut)).rejects.toMatchObject({ status: 401 })
  })
})

function membershipStore(
  rows: Array<{ userId: string; vendorId: string; role: "OWNER" | "STAFF" }>
) {
  const calls: Array<[string, string]> = []

  const store: MembershipStore = {
    async findMembership(userId, vendorId) {
      calls.push([userId, vendorId])
      const row = rows.find(
        (r) => r.userId === userId && r.vendorId === vendorId
      )

      return row ? { role: row.role } : null
    },
  }

  return { store, calls }
}

describe("requireVendorMember", () => {
  it("TC-E0S3-11: a member passes and gets the vendor and their vendor role", async () => {
    const { store } = membershipStore([
      { userId: "u1", vendorId: "X", role: "STAFF" },
    ])

    const actor = await requireVendorMember("X", undefined, {
      session: sessionFor({ platformRole: "VENDOR" }),
      memberships: store,
    })

    expect(actor).toMatchObject({
      id: "u1",
      vendorId: "X",
      vendorRole: "STAFF",
    })
  })

  it("TC-E0S3-03: staff of vendor X cannot act on vendor Y (CR-2)", async () => {
    const { store } = membershipStore([
      { userId: "u1", vendorId: "X", role: "STAFF" },
    ])

    await expect(
      requireVendorMember("Y", undefined, {
        session: sessionFor({ platformRole: "VENDOR" }),
        memberships: store,
      })
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" })
  })

  it("TC-E0S3-12: the lookup uses the session user's id, so a caller cannot borrow someone else's membership", async () => {
    const { store, calls } = membershipStore([
      { userId: "someone-else", vendorId: "X", role: "OWNER" },
    ])

    await expect(
      requireVendorMember("X", undefined, {
        session: sessionFor({ id: "u1" }),
        memberships: store,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls).toEqual([["u1", "X"]])
  })

  it("TC-E0S3-13: a vendor role restriction is enforced (STAFF cannot do OWNER-only work)", async () => {
    const { store } = membershipStore([
      { userId: "u1", vendorId: "X", role: "STAFF" },
      { userId: "u2", vendorId: "X", role: "OWNER" },
    ])
    const as = (id: string) => ({
      session: sessionFor({ id }),
      memberships: store,
    })

    await expect(
      requireVendorMember("X", ["OWNER"], as("u1"))
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(
      (await requireVendorMember("X", ["OWNER"], as("u2"))).vendorRole
    ).toBe("OWNER")
    expect(
      (await requireVendorMember("X", ["OWNER", "STAFF"], as("u1"))).vendorRole
    ).toBe("STAFF")
  })

  it("TC-E0S3-14: not-a-member, wrong-role and empty vendor id are indistinguishable (no vendor enumeration)", async () => {
    const { store } = membershipStore([
      { userId: "u1", vendorId: "X", role: "STAFF" },
    ])
    const deps = { session: sessionFor({}), memberships: store }

    const errors = await Promise.all([
      requireVendorMember("does-not-exist", undefined, deps).catch((e) => e),
      requireVendorMember("X", ["OWNER"], deps).catch((e) => e),
      requireVendorMember("", undefined, deps).catch((e) => e),
    ])

    for (const error of errors) {
      expect(error).toBeInstanceOf(ForbiddenError)
      expect(error.message).toBe(errors[0].message)
    }
  })

  it("TC-E0S3-15: no session is a 401 and the store is never consulted", async () => {
    const { store, calls } = membershipStore([])

    await expect(
      requireVendorMember("X", undefined, {
        session: signedOut,
        memberships: store,
      })
    ).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(0)
  })

  it("TC-E0S3-16: an admin who is not a member of the vendor is still denied", async () => {
    const { store } = membershipStore([])

    await expect(
      requireVendorMember("X", undefined, {
        session: sessionFor({ platformRole: "ADMIN" }),
        memberships: store,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
