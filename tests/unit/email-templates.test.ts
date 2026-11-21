import { describe, expect, it } from "vitest"
import { passwordResetEmail, verificationEmail } from "@/lib/email/templates"

const url = "https://app.example.com/verify?token=abc123"

describe("verificationEmail", () => {
  it("TC-E0S1-03: includes the action link in HTML and text", () => {
    const email = verificationEmail({ name: "Ada Lovelace", url })

    expect(email.subject).toBe("Confirm your email address")
    expect(email.html).toContain("Hi Ada Lovelace,")
    expect(email.html).toContain("Confirm email")
    expect(email.html).toContain(url)
    expect(email.text).toContain("Hi Ada Lovelace,")
    expect(email.text).toContain(`Confirm email: ${url}`)
  })

  it("TC-E0S1-03: states the one-hour expiry", () => {
    const email = verificationEmail({ url })

    expect(email.html).toContain("1 hour")
    expect(email.text).toContain("1 hour")
  })

  it("TC-E0S1-03: escapes a crafted display name in HTML", () => {
    const email = verificationEmail({
      name: '<script>alert("x")</script>',
      url,
    })

    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;script&gt;")
    // Plain text needs no escaping.
    expect(email.text).toContain('<script>alert("x")</script>')
  })

  it("TC-E0S1-03: falls back to a generic greeting", () => {
    expect(verificationEmail({ url }).html).toContain("Hi there,")
    expect(verificationEmail({ name: "   ", url }).html).toContain("Hi there,")
  })
})

describe("passwordResetEmail", () => {
  it("TC-E0S1-03: includes the action link and reset copy", () => {
    const email = passwordResetEmail({ name: "Ada", url })

    expect(email.subject).toBe("Reset your password")
    expect(email.html).toContain("Hi Ada,")
    expect(email.html).toContain("Reset password")
    expect(email.html).toContain(url)
    expect(email.text).toContain(`Reset password: ${url}`)
    expect(email.text).toContain("If you didn't request a reset")
  })

  it("TC-E0S1-03: formats the expiry from minutes", () => {
    expect(passwordResetEmail({ url }).text).toContain("1 hour")
    expect(passwordResetEmail({ url, expiresInMinutes: 30 }).text).toContain(
      "30 minutes"
    )
    expect(passwordResetEmail({ url, expiresInMinutes: 120 }).text).toContain(
      "2 hours"
    )
  })
})

describe("template output", () => {
  it("TC-E0S1-03: always produces non-empty HTML and text without placeholders", () => {
    for (const email of [
      verificationEmail({ url }),
      passwordResetEmail({ url }),
    ]) {
      expect(email.html.length).toBeGreaterThan(0)
      expect(email.text.length).toBeGreaterThan(0)
      expect(email.html).not.toContain("undefined")
      expect(email.text).not.toContain("undefined")
    }
  })
})
