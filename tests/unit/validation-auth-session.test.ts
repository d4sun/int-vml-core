import { describe, expect, it } from "vitest"
import {
  PASSWORD_MAX_LENGTH,
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth"

describe("loginSchema", () => {
  it("TC-E0S2-06: normalises the email and keeps the password untouched", () => {
    expect(
      loginSchema.parse({
        email: "  Ada@Example.COM ",
        password: " pass word ",
      })
    ).toEqual({ email: "ada@example.com", password: " pass word " })
  })

  it("TC-E0S2-07: applies no password policy, so legacy credentials can still sign in", () => {
    expect(
      loginSchema.safeParse({ email: "ada@example.com", password: "abc" })
        .success
    ).toBe(true)
  })

  it("TC-E0S2-08: rejects an empty password and an oversized one", () => {
    expect(
      loginSchema.safeParse({ email: "ada@example.com", password: "" }).success
    ).toBe(false)
    expect(
      loginSchema.safeParse({
        email: "ada@example.com",
        password: "a".repeat(PASSWORD_MAX_LENGTH + 1),
      }).success
    ).toBe(false)
  })

  it("TC-E0S2-09: rejects a malformed email", () => {
    expect(
      loginSchema.safeParse({ email: "nope", password: "x" }).success
    ).toBe(false)
  })
})

describe("forgotPasswordSchema", () => {
  it("TC-E0S2-10: accepts and normalises an email, rejects anything else", () => {
    expect(forgotPasswordSchema.parse({ email: " Ada@Example.com " })).toEqual({
      email: "ada@example.com",
    })
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false)
    expect(forgotPasswordSchema.safeParse({}).success).toBe(false)
  })
})

describe("resetPasswordSchema", () => {
  it("TC-E0S2-11: requires a token and enforces the full password policy", () => {
    const ok = { token: "abc", newPassword: "correct-horse-1" }

    expect(resetPasswordSchema.safeParse(ok).success).toBe(true)
    expect(resetPasswordSchema.safeParse({ ...ok, token: "  " }).success).toBe(
      false
    )

    for (const newPassword of ["short1", "alllettersnodigit", "12345678901"]) {
      expect(
        resetPasswordSchema.safeParse({ ...ok, newPassword }).success,
        newPassword
      ).toBe(false)
    }
  })
})

describe("profileSchema", () => {
  it("TC-E0S2-12: trims and validates the name", () => {
    expect(profileSchema.parse({ name: "  Ada Lovelace " })).toEqual({
      name: "Ada Lovelace",
    })
    expect(profileSchema.safeParse({ name: "   " }).success).toBe(false)
    expect(profileSchema.safeParse({ name: "a".repeat(101) }).success).toBe(
      false
    )
  })

  it("TC-E0S2-13: rejects any field that is not editable, platformRole above all", () => {
    for (const extra of [
      { platformRole: "ADMIN" },
      { email: "other@example.com" },
      { emailVerified: true },
      { id: "someone-else" },
    ]) {
      expect(
        profileSchema.safeParse({ name: "Ada", ...extra }).success,
        Object.keys(extra)[0]
      ).toBe(false)
    }
  })
})
