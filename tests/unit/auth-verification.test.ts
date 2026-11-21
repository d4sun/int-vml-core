import { afterEach, describe, expect, it, vi } from "vitest"
import {
  describeVerificationOutcome,
  VERIFICATION_CALLBACK_PATH,
} from "@/lib/auth/verification"
import {
  extractLink,
  makeHarness,
  uniqueEmail,
  VALID_PASSWORD,
  type AuthHarness,
} from "../helpers/auth-harness"

type DbUser = { email: string; emailVerified: boolean }

function userByEmail(h: AuthHarness, email: string): DbUser | undefined {
  return (h.db.user as unknown as DbUser[]).find((u) => u.email === email)
}

async function register(h: AuthHarness, extra: Record<string, unknown> = {}) {
  const email = uniqueEmail()

  const response = await h.signUp({
    name: "Ada Lovelace",
    email,
    password: VALID_PASSWORD,
    ...extra,
  })

  return { email, response }
}

function callbackOf(link: string): string | null {
  return new URL(link).searchParams.get("callbackURL")
}

function location(response: Response): URL {
  const target = response.headers.get("location")

  if (!target) throw new Error(`Expected a redirect, got ${response.status}`)

  return new URL(target, "http://localhost:3000")
}

const hasSession = (response: Response) =>
  /session_token/.test(response.headers.get("set-cookie") ?? "")

afterEach(() => {
  vi.useRealTimers()
})

describe("verification callback", () => {
  it("TC-E0S1-17: the emailed link always targets /verify-email/complete", async () => {
    const withoutCallback = makeHarness()
    await register(withoutCallback)

    const withEvilCallback = makeHarness()
    await register(withEvilCallback, { callbackURL: "https://evil.example/x" })

    for (const h of [withoutCallback, withEvilCallback]) {
      const link = extractLink(h.emails("verification")[0]!)
      expect(callbackOf(link)).toBe(VERIFICATION_CALLBACK_PATH)
    }
  })

  it("TC-E0S1-18: a valid token verifies, signs in and redirects without an error", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    const response = await h.follow(extractLink(h.emails("verification")[0]!))
    const target = location(response)

    expect(response.status).toBe(302)
    expect(target.pathname).toBe(VERIFICATION_CALLBACK_PATH)
    expect(target.searchParams.has("error")).toBe(false)
    expect(hasSession(response)).toBe(true)
    expect(userByEmail(h, email)?.emailVerified).toBe(true)
  })

  it("TC-E0S1-19: a link opened with a foreign callback still lands on our page", async () => {
    const h = makeHarness()
    await register(h)

    const link = extractLink(h.emails("verification")[0]!).replace(
      /callbackURL=[^&]+/,
      `callbackURL=${encodeURIComponent("https://evil.example/x")}`
    )
    const response = await h.follow(link)

    expect(location(response).pathname).toBe(VERIFICATION_CALLBACK_PATH)
    expect(location(response).origin).toBe("http://localhost:3000")
  })

  it("TC-E0S1-20: an expired token redirects with TOKEN_EXPIRED and creates no session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const { email } = await register(h)
    const link = extractLink(h.emails("verification")[0]!)

    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    const response = await h.follow(link)
    const target = location(response)

    expect(target.pathname).toBe(VERIFICATION_CALLBACK_PATH)
    expect(target.searchParams.get("error")).toBe("TOKEN_EXPIRED")
    expect(hasSession(response)).toBe(false)
    expect(userByEmail(h, email)?.emailVerified).toBe(false)
  })

  it("TC-E0S1-21: a token just inside the 1 hour window is still accepted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const { email } = await register(h)
    const link = extractLink(h.emails("verification")[0]!)

    vi.setSystemTime(Date.now() + 59 * 60 * 1000)
    const response = await h.follow(link)

    expect(location(response).searchParams.has("error")).toBe(false)
    expect(userByEmail(h, email)?.emailVerified).toBe(true)
  })

  it("TC-E0S1-22: a tampered token redirects with INVALID_TOKEN", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    const link = extractLink(h.emails("verification")[0]!).replace(
      /token=[^&]+/,
      "token=garbage"
    )
    const response = await h.follow(link)

    expect(location(response).searchParams.get("error")).toBe("INVALID_TOKEN")
    expect(hasSession(response)).toBe(false)
    expect(userByEmail(h, email)?.emailVerified).toBe(false)
  })

  it("TC-E0S1-23: opening the same link twice verifies once and issues one session", async () => {
    const h = makeHarness()
    await register(h)
    const link = extractLink(h.emails("verification")[0]!)

    const first = await h.follow(link)
    const second = await h.follow(link)

    expect(hasSession(first)).toBe(true)
    expect(hasSession(second)).toBe(false)
    expect(location(second).searchParams.has("error")).toBe(false)
    expect(h.db.session).toHaveLength(1)
  })
})

describe("resend verification", () => {
  it("TC-E0S1-24: resend sends a fresh working link with the enforced callback", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    const response = await h.request("/send-verification-email", {
      body: { email, callbackURL: "https://evil.example/x" },
    })

    expect(response.status).toBe(200)

    const sent = h.emails("verification")
    expect(sent).toHaveLength(2)
    expect(sent[1]?.to).toBe(email)

    const link = extractLink(sent[1]!)
    expect(callbackOf(link)).toBe(VERIFICATION_CALLBACK_PATH)

    await h.follow(link)
    expect(userByEmail(h, email)?.emailVerified).toBe(true)
  })

  it("TC-E0S1-25: resend is enumeration-safe (same response for unknown, verified and unverified)", async () => {
    const h = makeHarness()

    const unverified = await register(h)
    const verified = await register(h)
    await h.follow(extractLink(h.emails("verification")[1]!))
    h.queue.clear()

    const bodies = []
    for (const email of [
      uniqueEmail("nobody"),
      verified.email,
      unverified.email,
    ]) {
      const response = await h.request("/send-verification-email", {
        body: { email },
      })

      expect(response.status).toBe(200)
      bodies.push(await response.json())
    }

    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]).toEqual(bodies[0])

    // Only the unverified account actually receives mail.
    const sent = h.emails("verification")
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(unverified.email)
  })

  it("TC-E0S1-26: resend does not invalidate the earlier link (stateless token, 1h expiry)", async () => {
    const h = makeHarness()
    const { email } = await register(h)

    await h.request("/send-verification-email", { body: { email } })

    const [first] = h.emails("verification")
    const response = await h.follow(extractLink(first!))

    expect(location(response).searchParams.has("error")).toBe(false)
    expect(userByEmail(h, email)?.emailVerified).toBe(true)
  })

  it("TC-E0S1-27: during a queue outage sign-up still succeeds without mail, and resend recovers it", async () => {
    const h = makeHarness()
    h.setQueueDown(true)

    // Better Auth runs the sign-up send as a background task and only logs a
    // failure, so the account exists but no email went out.
    const { email, response } = await register(h)

    expect(response.status).toBe(200)
    expect(userByEmail(h, email)?.emailVerified).toBe(false)
    expect(h.queue.messages).toHaveLength(0)

    // The resend endpoint awaits the send, so the outage is visible there...
    const failed = await h.request("/send-verification-email", {
      body: { email },
    })
    expect(failed.status).toBeGreaterThanOrEqual(500)

    // ...and once the queue is back the user can get their link.
    h.setQueueDown(false)
    const recovered = await h.request("/send-verification-email", {
      body: { email },
    })

    expect(recovered.status).toBe(200)
    expect(h.emails("verification")).toHaveLength(1)
  })
})

describe("describeVerificationOutcome", () => {
  it("TC-E0S1-28: maps callback state to a UI outcome", () => {
    expect(describeVerificationOutcome({ error: "TOKEN_EXPIRED" })).toEqual({
      status: "failed",
      reason: "expired",
    })
    expect(describeVerificationOutcome({ error: "INVALID_TOKEN" })).toEqual({
      status: "failed",
      reason: "invalid",
    })
    // Never reveals that an account no longer exists.
    expect(describeVerificationOutcome({ error: "USER_NOT_FOUND" })).toEqual({
      status: "failed",
      reason: "invalid",
    })
    expect(describeVerificationOutcome({ emailVerified: true })).toEqual({
      status: "verified",
    })
    // Opening the URL by hand proves nothing.
    expect(describeVerificationOutcome({})).toEqual({ status: "unknown" })
    expect(describeVerificationOutcome({ emailVerified: false })).toEqual({
      status: "unknown",
    })
  })

  it("TC-E0S1-28b: an error wins over a verified session", () => {
    expect(
      describeVerificationOutcome({
        error: "TOKEN_EXPIRED",
        emailVerified: true,
      })
    ).toEqual({ status: "failed", reason: "expired" })
  })
})
