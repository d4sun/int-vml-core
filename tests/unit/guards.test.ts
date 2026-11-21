import { describe, expect, it } from "vitest"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { UnauthenticatedError } from "@/lib/errors"

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
