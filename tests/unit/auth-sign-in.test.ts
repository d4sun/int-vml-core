import { afterEach, describe, expect, it, vi } from "vitest"
import { SESSION_POLICY } from "@/lib/auth/config"
import {
  freshIp,
  makeHarness,
  sessionCookie,
  sessionCookieHeader,
  uniqueEmail,
  VALID_PASSWORD,
  type AuthHarness,
} from "../helpers/auth-harness"

// Pinned to the story's policy on purpose: reading these from the config would
// make the tests follow any change to it.
const IP_LIMIT = 10
const ACCOUNT_LIMIT = 10
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

type DbSession = { token: string; expiresAt: Date; userId: string }

const sessions = (h: AuthHarness) => h.db.session as unknown as DbSession[]

function attempt(
  h: AuthHarness,
  email: string,
  password: string,
  ip = freshIp()
) {
  return h.signIn({ email, password }, ip)
}

afterEach(() => {
  vi.useRealTimers()
})

describe("sign-in and session policy", () => {
  it("TC-E0S2-01: correct credentials issue a session cookie, and every sign-in rotates the token", async () => {
    const h = makeHarness()
    const { email, password } = await h.registerVerified()
    const before = sessions(h).length

    const first = await attempt(h, email, password)
    const second = await attempt(h, email, password)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const a = sessionCookie(first)
    const b = sessionCookie(second)

    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
    expect(sessions(h)).toHaveLength(before + 2)

    // The cookie must actually authenticate.
    const session = await h.auth.api.getSession({
      headers: new Headers({ cookie: a! }),
    })
    expect(session?.user.email).toBe(email)
  })

  it("TC-E0S2-14: the session cookie is HttpOnly, SameSite=Lax and site-wide", async () => {
    const h = makeHarness()
    const { email, password } = await h.registerVerified()

    const header = sessionCookieHeader(await attempt(h, email, password))

    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/SameSite=Lax/i)
    expect(header).toMatch(/Path=\//i)
  })

  it("TC-E0S2-15: a session lasts 7 days and is rejected after that", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const { email, password } = await h.registerVerified()
    const response = await attempt(h, email, password)
    const cookie = sessionCookie(response)!

    const row = sessions(h).at(-1)!
    expect(new Date(row.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      SEVEN_DAYS_MS - 60_000
    )
    expect(new Date(row.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      SEVEN_DAYS_MS
    )
    expect(SESSION_POLICY.expiresIn * 1000).toBe(SEVEN_DAYS_MS)

    vi.setSystemTime(Date.now() + SEVEN_DAYS_MS + 60_000)

    const expired = await h.auth.api.getSession({
      headers: new Headers({ cookie }),
    })
    expect(expired).toBeNull()
  })

  it("TC-E0S2-16: sign-in before verification is refused even with the right password", async () => {
    const h = makeHarness()
    const email = uniqueEmail()
    await h.signUp({ name: "Ada", email, password: VALID_PASSWORD })

    const response = await attempt(h, email, VALID_PASSWORD)

    expect(response.status).toBe(403)
    expect(sessionCookie(response)).toBeUndefined()
  })
})

describe("sign-in failures are generic (CR-9)", () => {
  it("TC-E0S2-02: wrong password and unknown email are indistinguishable", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()

    const wrongPassword = await attempt(h, email, "wrong-password-1")
    const unknownEmail = await attempt(
      h,
      uniqueEmail("ghost"),
      "wrong-password-1"
    )

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(wrongPassword.status)
    expect(await unknownEmail.json()).toEqual(await wrongPassword.json())
    expect(sessionCookie(wrongPassword)).toBeUndefined()
  })

  it("TC-E0S2-17: malformed input is a validation error, not a throttled attempt", async () => {
    const h = makeHarness()

    const response = await h.signIn({ email: "nope", password: "x" })

    expect(response.status).toBe(400)
  })
})

describe("sign-in throttling (CR-8)", () => {
  it("TC-E0S2-18: wrong passwords from one IP are throttled after 10 a minute", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()
    const ip = freshIp()
    const statuses: number[] = []

    for (let i = 0; i < IP_LIMIT + 1; i += 1) {
      // A different account each time keeps the per-account budget out of it.
      statuses.push(
        (await attempt(h, uniqueEmail("t"), "wrong-password-1", ip)).status
      )
    }

    expect(statuses.slice(0, IP_LIMIT).every((s) => s === 401)).toBe(true)
    expect(statuses[IP_LIMIT]).toBe(429)

    // Another IP is unaffected.
    expect((await attempt(h, email, "wrong-password-1")).status).toBe(401)
  })

  it("TC-E0S2-19: guesses spread across many IPs still hit the per-account limit, even with the right password", async () => {
    const h = makeHarness()
    const { email, password } = await h.registerVerified()

    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      expect((await attempt(h, email, "wrong-password-1")).status).toBe(401)
    }

    const throttled = await attempt(h, email, password)

    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers.get("x-retry-after"))).toBeGreaterThan(0)
    expect(sessionCookie(throttled)).toBeUndefined()

    // A different account is unaffected.
    const other = await h.registerVerified()
    expect((await attempt(h, other.email, other.password)).status).toBe(200)
  })

  it("TC-E0S2-20: an unknown address is throttled exactly like a real one", async () => {
    const h = makeHarness()
    const ghost = uniqueEmail("ghost")

    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      expect((await attempt(h, ghost, "wrong-password-1")).status).toBe(401)
    }

    const throttled = await attempt(h, ghost, "wrong-password-1")

    expect(throttled.status).toBe(429)
    expect(await throttled.json()).toMatchObject({
      message: "Too many requests. Please try again later.",
    })
  })

  it("TC-E0S2-21: a successful sign-in resets the account's failure count", async () => {
    const h = makeHarness()
    const { email, password } = await h.registerVerified()

    for (let i = 0; i < ACCOUNT_LIMIT - 1; i += 1) {
      await attempt(h, email, "wrong-password-1")
    }
    expect((await attempt(h, email, password)).status).toBe(200)

    for (let i = 0; i < ACCOUNT_LIMIT - 1; i += 1) {
      expect((await attempt(h, email, "wrong-password-1")).status).toBe(401)
    }
  })

  it("TC-E0S2-22: the per-account lockout lifts after 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const { email, password } = await h.registerVerified()

    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      await attempt(h, email, "wrong-password-1")
    }
    expect((await attempt(h, email, password)).status).toBe(429)

    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000)

    expect((await attempt(h, email, password)).status).toBe(200)
  })

  it("TC-E0S2-23: a throttled account stops recording attempts, so an attack cannot grow storage", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()

    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
      await attempt(h, email, "wrong-password-1")
    }
    const rowsAtLimit = h.db.verification.length

    for (let i = 0; i < 25; i += 1) {
      expect((await attempt(h, email, "wrong-password-1")).status).toBe(429)
    }

    expect(h.db.verification).toHaveLength(rowsAtLimit)
  })

  it("TC-E0S2-24: the throttle stores a hash, never the email address", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()

    await attempt(h, email, "wrong-password-1")

    const identifiers = (
      h.db.verification as unknown as { identifier: string }[]
    ).map((row) => row.identifier)

    expect(identifiers.some((id) => id.startsWith("sign-in-account:"))).toBe(
      true
    )
    expect(identifiers.every((id) => !id.includes(email))).toBe(true)
  })
})
