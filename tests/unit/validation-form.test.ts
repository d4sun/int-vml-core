import { describe, expect, it } from "vitest"
import { registerSchema } from "@/lib/validation/auth"
import { fieldErrors, FORM_ERROR_KEY } from "@/lib/validation/form"

describe("fieldErrors", () => {
  it("TC-E0S1-31: maps each invalid field to its first message", () => {
    const result = registerSchema.safeParse({
      name: "   ",
      email: "nope",
      password: "short",
    })

    expect(result.success).toBe(false)
    if (result.success) return

    const errors = fieldErrors(result.error)

    expect(Object.keys(errors).sort()).toEqual(["email", "name", "password"])
    expect(errors.name).toBe("Enter your name")
    expect(errors.email).toBe("Enter a valid email address")
    expect(errors.password).toMatch(/at least 8/)
  })

  it("TC-E0S1-32: reports a missing field and keeps only the first issue per field", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "12",
    })

    if (result.success) throw new Error("expected failure")

    const errors = fieldErrors(result.error)

    // "12" is too short and has no letter; only the first issue is reported.
    expect(Object.keys(errors)).toEqual(["password"])
    expect(errors.password).toMatch(/at least 8/)
  })

  it("TC-E0S1-33: puts path-less issues under the form key", () => {
    const result = registerSchema.safeParse("not an object")

    if (result.success) throw new Error("expected failure")

    expect(Object.keys(fieldErrors(result.error))).toEqual([FORM_ERROR_KEY])
  })

  it("TC-E0S1-34: valid input produces no errors to render", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "Ada@Example.com",
      password: "correct-horse-1",
    })

    expect(result.success).toBe(true)
  })
})
