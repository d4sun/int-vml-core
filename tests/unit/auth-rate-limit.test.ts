import { afterEach, describe, expect, it, vi } from "vitest"
import {
  freshIp,
  makeHarness,
  uniqueEmail,
  VALID_PASSWORD,
  type AuthHarness,
} from "../helpers/auth-harness"

// Pinned to the story's acceptance values on purpose: reading them from the
// config would make these tests follow any change to it.
const SIGN_UP_LIMIT = 5
const RESEND_LIMIT = 3

function signUp(h: AuthHarness, ip: string, password = VALID_PASSWORD) {
  return h.signUp({ name: "Ada", email: uniqueEmail(), password }, ip)
}

function resend(h: AuthHarness, ip: string, email = uniqueEmail("nobody")) {
  return h.request("/send-verification-email", { body: { email }, ip })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("auth rate limits: sign-up", () => {
  it("TC-E0S1-35: the 6th registration from one IP inside a minute is throttled", async () => {
    const h = makeHarness()
    const ip = freshIp()
    const max = SIGN_UP_LIMIT

    for (let attempt = 1; attempt <= max; attempt += 1) {
      const response = await signUp(h, ip)
      expect(response.status, `attempt ${attempt}`).toBe(200)
    }

    const throttled = await signUp(h, ip)

    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers.get("x-retry-after"))).toBeGreaterThan(0)
    expect(h.db.user).toHaveLength(max)
    expect(h.emails("verification")).toHaveLength(max)
  })

  it("TC-E0S1-36: the limit is per IP, so another client is unaffected", async () => {
    const h = makeHarness()
    const noisy = freshIp()

    for (let i = 0; i < SIGN_UP_LIMIT; i += 1) {
      await signUp(h, noisy)
    }
    expect((await signUp(h, noisy)).status).toBe(429)

    expect((await signUp(h, freshIp())).status).toBe(200)
  })

  it("TC-E0S1-37: rejected attempts count too, so guessing cannot dodge the limit", async () => {
    const h = makeHarness()
    const ip = freshIp()

    for (let i = 0; i < SIGN_UP_LIMIT; i += 1) {
      const response = await signUp(h, ip, "weak")
      expect(response.status).toBe(400)
    }

    expect((await signUp(h, ip)).status).toBe(429)
    expect(h.db.user).toHaveLength(0)
  })

  it("TC-E0S1-38: the window is rolling, so the limit lifts after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const ip = freshIp()

    for (let i = 0; i < SIGN_UP_LIMIT; i += 1) {
      await signUp(h, ip)
    }
    expect((await signUp(h, ip)).status).toBe(429)

    vi.setSystemTime(Date.now() + 61_000)

    expect((await signUp(h, ip)).status).toBe(200)
  })

  it("TC-E0S1-39: the throttled response is generic and does not reveal account state", async () => {
    const h = makeHarness()
    const ip = freshIp()
    const email = uniqueEmail()

    for (let i = 0; i < SIGN_UP_LIMIT; i += 1) {
      await h.signUp({ name: "Ada", email, password: VALID_PASSWORD }, ip)
    }

    const throttled = await h.signUp(
      { name: "Ada", email, password: VALID_PASSWORD },
      ip
    )
    const fresh = await h.signUp(
      { name: "Ada", email: uniqueEmail(), password: VALID_PASSWORD },
      freshIp()
    )

    expect(throttled.status).toBe(429)
    expect(await throttled.json()).toEqual({
      message: "Too many requests. Please try again later.",
    })
    expect(fresh.status).toBe(200)
  })
})

describe("auth rate limits: resend verification", () => {
  it("TC-E0S1-40: the 4th resend from one IP inside a minute is throttled", async () => {
    const h = makeHarness()
    const ip = freshIp()
    const max = RESEND_LIMIT

    for (let attempt = 1; attempt <= max; attempt += 1) {
      const response = await resend(h, ip)
      expect(response.status, `attempt ${attempt}`).toBe(200)
    }

    const throttled = await resend(h, ip)

    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers.get("x-retry-after"))).toBeGreaterThan(0)
  })

  it("TC-E0S1-41: limits are per path, so exhausting one does not block the other", async () => {
    const h = makeHarness()
    const ip = freshIp()

    for (let i = 0; i < SIGN_UP_LIMIT; i += 1) {
      await signUp(h, ip)
    }
    expect((await signUp(h, ip)).status).toBe(429)

    expect((await resend(h, ip)).status).toBe(200)
  })
})
