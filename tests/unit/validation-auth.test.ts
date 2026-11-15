import { describe, expect, it } from "vitest"
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  emailSchema,
  passwordSchema,
  registerSchema,
} from "@/lib/validation/auth"

describe("registerSchema", () => {
  it("TC-E0S1-01: accepts a valid registration and normalises the input", () => {
    const parsed = registerSchema.parse({
      name: "  Ada Lovelace  ",
      email: "  Ada@Example.COM ",
      password: "p3nn1ess",
    })

    expect(parsed).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "p3nn1ess",
    })
  })

  it("TC-E0S1-03: rejects a password shorter than the minimum", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "a1".repeat((PASSWORD_MIN_LENGTH - 1) / 2),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(issueMessage(result.error, "password")).toMatch(/at least 8/)
    }
  })

  it("TC-E0S1-03: rejects a password longer than the maximum", () => {
    expect(
      passwordSchema.safeParse(`a1${"x".repeat(PASSWORD_MAX_LENGTH)}`).success
    ).toBe(false)
  })

  it("TC-E0S1-03: requires at least one letter and one digit", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(false)
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false)
    expect(passwordSchema.safeParse("abcd1234").success).toBe(true)
  })

  it("TC-E0S1-03: accepts the exact boundary lengths", () => {
    expect(passwordSchema.safeParse("abcd1234").success).toBe(true)
    expect(
      passwordSchema.safeParse(`a1${"x".repeat(PASSWORD_MAX_LENGTH - 2)}`)
        .success
    ).toBe(true)
  })

  it("TC-E0S1-03: rejects an invalid or oversized email", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false)
    expect(
      emailSchema.safeParse(`${"a".repeat(EMAIL_MAX_LENGTH)}@example.com`)
        .success
    ).toBe(false)
  })

  it("TC-E0S1-03: rejects a blank name and enforces the length bound", () => {
    expect(
      registerSchema.safeParse({
        name: "   ",
        email: "ada@example.com",
        password: "abcd1234",
      }).success
    ).toBe(false)

    expect(
      registerSchema.safeParse({
        name: "a".repeat(NAME_MAX_LENGTH + 1),
        email: "ada@example.com",
        password: "abcd1234",
      }).success
    ).toBe(false)
  })

  it("TC-E0S1-01: silently drops fields the caller must not set", () => {
    const parsed = registerSchema.parse({
      name: "Ada",
      email: "ada@example.com",
      password: "abcd1234",
      platformRole: "ADMIN",
      emailVerified: true,
    })

    expect("platformRole" in parsed).toBe(false)
    expect("emailVerified" in parsed).toBe(false)
  })
})

function issueMessage(
  error: { issues: Array<{ path: PropertyKey[]; message: string }> },
  field: string
): string {
  return error.issues.find((issue) => issue.path[0] === field)?.message ?? ""
}
