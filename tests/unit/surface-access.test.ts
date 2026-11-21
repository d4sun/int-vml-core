import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { authorizeSurface } from "@/lib/auth/surface"

const as =
  (platformRole: string): SessionSource =>
  async () => ({
    user: {
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      emailVerified: true,
      platformRole,
    },
  })

const signedOut: SessionSource = async () => null

describe("authorizeSurface", () => {
  it("TC-E0S3-01: a tourist opening /vendor or /admin is denied with no data", async () => {
    expect(await authorizeSurface("vendor", "/vendor", as("TOURIST"))).toEqual({
      action: "deny",
    })
    expect(await authorizeSurface("admin", "/admin", as("TOURIST"))).toEqual({
      action: "deny",
    })
  })

  it("TC-E0S3-23: a signed-out visitor is sent to sign-in with the return path encoded", async () => {
    expect(await authorizeSurface("vendor", "/vendor", signedOut)).toEqual({
      action: "sign-in",
      to: "/sign-in?next=%2Fvendor",
    })
    expect(await authorizeSurface("admin", "/admin", signedOut)).toEqual({
      action: "sign-in",
      to: "/sign-in?next=%2Fadmin",
    })
  })

  it("TC-E0S3-24: each surface admits only its own role", async () => {
    expect(
      (await authorizeSurface("vendor", "/vendor", as("VENDOR"))).action
    ).toBe("allow")
    expect(
      (await authorizeSurface("admin", "/admin", as("ADMIN"))).action
    ).toBe("allow")

    // No role implies the other surface.
    expect(await authorizeSurface("vendor", "/vendor", as("ADMIN"))).toEqual({
      action: "deny",
    })
    expect(await authorizeSurface("admin", "/admin", as("VENDOR"))).toEqual({
      action: "deny",
    })
  })

  it("TC-E0S3-25: an allow decision carries the typed actor", async () => {
    const decision = await authorizeSurface("admin", "/admin", as("ADMIN"))

    expect(decision.action === "allow" && decision.actor).toMatchObject({
      id: "u1",
      platformRole: "ADMIN",
    })
  })

  it("TC-E0S3-26: an unknown role value is denied, never allowed", async () => {
    for (const role of ["SUPERUSER", "", "admin"]) {
      expect(
        (await authorizeSurface("admin", "/admin", as(role))).action,
        role
      ).toBe("deny")
    }
  })

  it("TC-E0S3-27: if the session lookup itself fails, the error propagates (fail closed)", async () => {
    const broken: SessionSource = async () => {
      throw new Error("database is down")
    }

    await expect(authorizeSurface("admin", "/admin", broken)).rejects.toThrow(
      "database is down"
    )
  })
})
