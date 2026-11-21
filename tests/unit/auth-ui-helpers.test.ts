import { describe, expect, it } from "vitest"
import { safeRedirectPath } from "@/lib/auth/redirect"
import { resetPasswordFormSchema } from "@/lib/validation/auth"

describe("safeRedirectPath", () => {
  it("TC-E0S2-58: keeps same-site paths, including query strings", () => {
    expect(safeRedirectPath("/account/profile")).toBe("/account/profile")
    expect(safeRedirectPath("/listing/tower-bridge?date=2026-12-01")).toBe(
      "/listing/tower-bridge?date=2026-12-01"
    )
    expect(safeRedirectPath("/")).toBe("/")
  })

  it("TC-E0S2-59: rejects anything that could leave the site", () => {
    for (const value of [
      "https://evil.example",
      "http://evil.example/x",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/ok\\evil",
      "/ok\nHost: evil",
      "/ok\u0000",
      "",
    ]) {
      expect(safeRedirectPath(value), JSON.stringify(value)).toBe("/")
    }
  })

  it("TC-E0S2-60: falls back for missing values, takes the first of an array and honours a custom fallback", () => {
    expect(safeRedirectPath(undefined)).toBe("/")
    expect(safeRedirectPath(null)).toBe("/")
    expect(safeRedirectPath(["/a", "/b"])).toBe("/a")
    expect(safeRedirectPath(["https://evil.example"])).toBe("/")
    expect(safeRedirectPath("nope", "/account/profile")).toBe(
      "/account/profile"
    )
    expect(safeRedirectPath("/" + "a".repeat(3000))).toBe("/")
  })
})

describe("resetPasswordFormSchema", () => {
  it("TC-E0S2-61: requires a matching confirmation and the full password policy", () => {
    expect(
      resetPasswordFormSchema.safeParse({
        newPassword: "brand-new-pass-9",
        confirmPassword: "brand-new-pass-9",
      }).success
    ).toBe(true)

    const mismatch = resetPasswordFormSchema.safeParse({
      newPassword: "brand-new-pass-9",
      confirmPassword: "brand-new-pass-8",
    })
    expect(mismatch.success).toBe(false)
    if (!mismatch.success) {
      expect(mismatch.error.issues[0]?.path).toEqual(["confirmPassword"])
    }

    expect(
      resetPasswordFormSchema.safeParse({
        newPassword: "alllettersnodigit",
        confirmPassword: "alllettersnodigit",
      }).success
    ).toBe(false)
  })
})
