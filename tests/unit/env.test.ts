import { describe, expect, it } from "vitest"
import { parseEnv } from "@/lib/env"

const base = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/vml",
  DIRECT_URL: "postgresql://user:password@localhost:5432/vml",
}

function parseError(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  throw new Error("expected parseEnv to throw")
}

describe("parseEnv", () => {
  it("TC-E0S1-03: applies defaults and treats blank optional values as unset", () => {
    const env = parseEnv({
      ...base,
      JOBS_DATABASE_URL: "",
      TEST_DATABASE_URL: "",
      BREVO_API_KEY: "",
      EMAIL_FROM_NAME: "",
    })

    expect(env.NODE_ENV).toBe("development")
    expect(env.EMAIL_OUTBOX_DIR).toBe(".tmp/email-outbox")
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000")
    expect(env.JOBS_DATABASE_URL).toBeUndefined()
    expect(env.TEST_DATABASE_URL).toBeUndefined()
    expect(env.BREVO_API_KEY).toBeUndefined()
    expect(env.EMAIL_FROM_NAME).toBeUndefined()
    expect(env.BETTER_AUTH_SECRET).toBeUndefined()
  })

  it("TC-E0S1-03: keeps configured values", () => {
    const env = parseEnv({
      ...base,
      NODE_ENV: "test",
      JOBS_DATABASE_URL: "postgresql://user:password@localhost:5432/jobs",
      TEST_DATABASE_URL: "postgresql://user:password@localhost:5432/vml_test",
      BREVO_API_KEY: "brevo-key",
      EMAIL_FROM: "hello@example.com",
      EMAIL_FROM_NAME: "Visit My London",
      EMAIL_OUTBOX_DIR: ".tmp/custom-outbox",
      BETTER_AUTH_SECRET: "a-test-secret",
      BETTER_AUTH_URL: "https://app.example.com",
    })

    expect(env).toMatchObject({
      NODE_ENV: "test",
      BREVO_API_KEY: "brevo-key",
      EMAIL_FROM: "hello@example.com",
      EMAIL_FROM_NAME: "Visit My London",
      EMAIL_OUTBOX_DIR: ".tmp/custom-outbox",
      BETTER_AUTH_SECRET: "a-test-secret",
      BETTER_AUTH_URL: "https://app.example.com",
    })
  })

  it("TC-E0S1-03: names missing required variables without echoing values", () => {
    const message = parseError({ DIRECT_URL: base.DIRECT_URL })

    expect(message).toContain("Invalid environment")
    expect(message).toContain("DATABASE_URL")
    expect(message).not.toContain(base.DIRECT_URL)
  })

  it("TC-E0S1-03: rejects malformed URLs without echoing the value", () => {
    const message = parseError({ ...base, DIRECT_URL: "not-a-url" })

    expect(message).toContain("DIRECT_URL")
    expect(message).not.toContain("not-a-url")
  })

  it("TC-E0S1-03: rejects a blank required variable", () => {
    const message = parseError({ ...base, DATABASE_URL: "   " })

    expect(message).toContain("DATABASE_URL")
  })

  it("TC-E0S1-03: requires EMAIL_FROM when BREVO_API_KEY is set", () => {
    const message = parseError({ ...base, BREVO_API_KEY: "brevo-secret" })

    expect(message).toContain("EMAIL_FROM")
    expect(message).not.toContain("brevo-secret")
  })

  it("TC-E0S1-03: reports every invalid field in one error", () => {
    const message = parseError({ DATABASE_URL: "nope" })

    expect(message).toContain("DATABASE_URL")
    expect(message).toContain("DIRECT_URL")
  })

  it("TC-E0S1-03: rejects an unknown NODE_ENV", () => {
    const message = parseError({ ...base, NODE_ENV: "staging" })

    expect(message).toContain("NODE_ENV")
  })

  it("TC-E0S1-03: does not mutate the source object", () => {
    const source = { ...base }

    parseEnv(source)

    expect(source).toEqual(base)
  })
  it("E4-S2-01: Stripe keys are optional, and blank means unset", () => {
    const env = parseEnv({
      ...base,
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
    })

    expect(env.STRIPE_SECRET_KEY).toBeUndefined()
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined()
  })

  it("E4-S2-01: a Stripe key needs a webhook secret, and the two cannot be swapped", () => {
    expect(parseError({ ...base, STRIPE_SECRET_KEY: "sk_test_abc" })).toContain(
      "STRIPE_WEBHOOK_SECRET"
    )

    const swapped = parseError({
      ...base,
      STRIPE_SECRET_KEY: "whsec_abc",
      STRIPE_WEBHOOK_SECRET: "sk_test_abc",
    })

    expect(swapped).toContain("STRIPE_SECRET_KEY")
    expect(swapped).toContain("STRIPE_WEBHOOK_SECRET")
    expect(swapped).not.toContain("whsec_abc")
    expect(swapped).not.toContain("sk_test_abc")
  })

  it("E4-S2-01: accepts a restricted key", () => {
    const env = parseEnv({
      ...base,
      STRIPE_SECRET_KEY: "rk_test_abc",
      STRIPE_WEBHOOK_SECRET: "whsec_abc",
    })

    expect(env.STRIPE_SECRET_KEY).toBe("rk_test_abc")
  })
})
