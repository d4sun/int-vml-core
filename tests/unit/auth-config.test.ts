import { afterEach, describe, expect, it, vi } from "vitest"
import { requireAuthSecret } from "@/lib/auth/config"
import {
  extractLink,
  makeHarness,
  uniqueEmail,
  VALID_PASSWORD,
  type AuthHarness,
} from "../helpers/auth-harness"

type DbUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  platformRole: string
}

function users(h: AuthHarness): DbUser[] {
  return h.db.user as unknown as DbUser[]
}

async function register(h: AuthHarness, email = uniqueEmail()) {
  const response = await h.signUp({
    name: "Ada Lovelace",
    email,
    password: VALID_PASSWORD,
  })

  return { email, response }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("auth config: registration", () => {
  it("TC-E0S1-01: valid registration creates an unverified tourist and enqueues one email", async () => {
    const h = makeHarness()
    const { email, response } = await register(h)

    expect(response.status).toBe(200)
    expect(users(h)).toHaveLength(1)
    expect(users(h)[0]).toMatchObject({
      email,
      emailVerified: false,
      platformRole: "TOURIST",
    })

    const sent = h.emails("verification")
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(email)
    expect(extractLink(sent[0]!)).toContain("/api/auth/verify-email?token=")
  })

  it("TC-E0S1-02: duplicate email gets the generic response and no second row", async () => {
    const h = makeHarness()
    const email = uniqueEmail()

    const first = await register(h, email)
    const second = await register(h, email)

    expect(second.response.status).toBe(first.response.status)
    expect(users(h)).toHaveLength(1)

    const body = (await second.response.json()) as { user?: { email: string } }
    expect(body.user?.email).toBe(email)
  })

  it("TC-E0S1-03: weak passwords are rejected server-side with no user and no email", async () => {
    const h = makeHarness()
    const weak = ["short1", "alllettersnodigit", "12345678901", "a".repeat(129)]

    for (const password of weak) {
      const response = await h.signUp({
        name: "Ada",
        email: uniqueEmail(),
        password,
      })

      expect(response.status, password).toBe(400)
    }

    expect(users(h)).toHaveLength(0)
    expect(h.queue.messages).toHaveLength(0)
  })

  it("TC-E0S1-03b: missing name or malformed email is rejected", async () => {
    const h = makeHarness()

    const noName = await h.signUp({
      name: "   ",
      email: uniqueEmail(),
      password: VALID_PASSWORD,
    })
    const badEmail = await h.signUp({
      name: "Ada",
      email: "not-an-email",
      password: VALID_PASSWORD,
    })

    expect(noName.status).toBe(400)
    expect(badEmail.status).toBe(400)
    expect(users(h)).toHaveLength(0)
  })

  it("TC-E0S1-07: platformRole cannot be set by the client", async () => {
    const h = makeHarness()
    const email = uniqueEmail()

    await h.signUp({
      name: "Mallory",
      email,
      password: VALID_PASSWORD,
      platformRole: "ADMIN",
    })

    const stored = users(h).find((user) => user.email === email)
    expect(stored?.platformRole ?? "TOURIST").toBe("TOURIST")
  })

  it("TC-E0S1-08: input is normalised (trimmed name, lower-cased email)", async () => {
    const h = makeHarness()
    const local = uniqueEmail("MiXeD").toUpperCase()

    await h.signUp({
      name: "  Ada Lovelace  ",
      email: `  ${local}  `,
      password: VALID_PASSWORD,
    })

    expect(users(h)[0]).toMatchObject({
      name: "Ada Lovelace",
      email: local.toLowerCase(),
    })
  })
})

describe("auth config: email verification", () => {
  it("TC-E0S1-04: a valid token verifies the user and signs them in", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    const link = extractLink(h.emails("verification")[0]!)
    const response = await h.follow(link)

    expect(response.status).toBeLessThan(400)
    expect(users(h).find((user) => user.email === email)?.emailVerified).toBe(
      true
    )
    expect(response.headers.get("set-cookie")).toMatch(/session_token/)
  })

  it("TC-E0S1-05: an invalid token is rejected and the user stays unverified", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    const link = extractLink(h.emails("verification")[0]!)
    const tampered = link.replace(/token=[^&]+/, "token=not-a-real-token")
    const response = await h.follow(tampered)

    expect(response.headers.get("set-cookie") ?? "").not.toMatch(
      /session_token/
    )
    expect(users(h).find((user) => user.email === email)?.emailVerified).toBe(
      false
    )
  })

  it("TC-E0S1-05b: an expired token is rejected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const { email } = await register(h)
    const link = extractLink(h.emails("verification")[0]!)

    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    const response = await h.follow(link)

    expect(response.headers.get("set-cookie") ?? "").not.toMatch(
      /session_token/
    )
    expect(users(h).find((user) => user.email === email)?.emailVerified).toBe(
      false
    )
  })

  it("TC-E0S1-09: sign-in before verification is refused (403)", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    const response = await h.signIn({ email, password: VALID_PASSWORD })

    expect(response.status).toBe(403)
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(
      /session_token/
    )
  })
})

describe("auth config: password reset policy", () => {
  it("TC-E0S1-10: a weak new password is rejected on reset", async () => {
    const h = makeHarness()
    const { email } = await register(h)
    await h.follow(extractLink(h.emails("verification")[0]!))

    await h.request("/request-password-reset", {
      body: { email, redirectTo: "/reset-password" },
    })

    const reset = h.emails("password-reset")
    expect(reset).toHaveLength(1)

    const token = new URL(extractLink(reset[0]!)).pathname.split("/").pop()
    const response = await h.request("/reset-password", {
      body: { token, newPassword: "alllettersnodigit" },
    })

    expect(response.status).toBe(400)
  })
})

describe("auth secret", () => {
  it("TC-E0S1-11: refuses a missing or short secret", () => {
    expect(() => requireAuthSecret(undefined)).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => requireAuthSecret("short")).toThrow(/at least 32/)
    expect(requireAuthSecret("x".repeat(32))).toBe("x".repeat(32))
  })
})
