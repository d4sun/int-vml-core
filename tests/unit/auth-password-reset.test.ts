import { afterEach, describe, expect, it, vi } from "vitest"
import {
  describeResetLink,
  RESET_PASSWORD_PATH,
} from "@/lib/auth/password-reset"
import {
  extractLink,
  freshIp,
  makeHarness,
  sessionCookie,
  uniqueEmail,
  type AuthHarness,
} from "../helpers/auth-harness"

const NEW_PASSWORD = "brand-new-pass-9"
const OLD_PASSWORD = "correct-horse-1"

type DbRow = Record<string, unknown>

function requestReset(
  h: AuthHarness,
  email: string,
  extra: Record<string, unknown> = {},
  ip = freshIp()
) {
  return h.request("/request-password-reset", {
    body: { email, ...extra },
    ip,
  })
}

const tokenOf = (link: string) => new URL(link).pathname.split("/").pop()!

function reset(h: AuthHarness, token: string, newPassword = NEW_PASSWORD) {
  return h.request("/reset-password", { body: { token, newPassword } })
}

function location(response: Response): URL {
  const target = response.headers.get("location")

  if (!target) throw new Error(`Expected a redirect, got ${response.status}`)

  return new URL(target, "http://localhost:3000")
}

async function requestedLink(h: AuthHarness, email: string) {
  await requestReset(h, email)

  return extractLink(h.emails("password-reset").at(-1)!)
}

afterEach(() => {
  vi.useRealTimers()
})

describe("requesting a reset", () => {
  it("TC-E0S2-28: a known email gets exactly one reset email whose link lands on our page", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })

    const response = await requestReset(h, email, {
      redirectTo: "https://evil.example/x",
    })

    expect(response.status).toBe(200)

    const sent = h.emails("password-reset")
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(email)

    const link = new URL(extractLink(sent[0]!))
    expect(link.pathname).toMatch(/\/reset-password\/[^/]+$/)
    expect(link.searchParams.get("callbackURL")).toBe(RESET_PASSWORD_PATH)
  })

  it("TC-E0S2-29: the response is identical for unknown, verified and unverified addresses (CR-9)", async () => {
    const h = makeHarness()
    const known = await h.registerVerified()
    const unverified = uniqueEmail()
    await h.signUp({ name: "Ada", email: unverified, password: OLD_PASSWORD })

    const bodies = []
    for (const email of [uniqueEmail("ghost"), known.email, unverified]) {
      const response = await requestReset(h, email)

      expect(response.status).toBe(200)
      bodies.push(await response.json())
    }

    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]).toEqual(bodies[0])
    // Only real accounts are mailed.
    expect(
      h
        .emails("password-reset")
        .map((message) => message.to)
        .sort()
    ).toEqual([known.email, unverified].sort())
  })

  it("TC-E0S2-30: malformed email is a validation error", async () => {
    const h = makeHarness()

    expect((await requestReset(h, "nope")).status).toBe(400)
    expect(h.emails("password-reset")).toHaveLength(0)
  })

  it("TC-E0S2-31: the 4th request from one IP inside a minute is throttled", async () => {
    const h = makeHarness()
    const ip = freshIp()
    const statuses: number[] = []

    for (let i = 0; i < 4; i += 1) {
      statuses.push((await requestReset(h, uniqueEmail("x"), {}, ip)).status)
    }

    expect(statuses).toEqual([200, 200, 200, 429])
  })
})

describe("opening a reset link", () => {
  it("TC-E0S2-32: a valid link redirects to the reset page with its token", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()
    const link = await requestedLink(h, email)

    const target = location(await h.follow(link))

    expect(target.pathname).toBe(RESET_PASSWORD_PATH)
    expect(target.searchParams.get("token")).toBe(tokenOf(link))
    expect(target.searchParams.has("error")).toBe(false)
  })

  it("TC-E0S2-33: an invalid token redirects with an error and no token", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()
    const link = await requestedLink(h, email)

    const target = location(
      await h.follow(link.replace(tokenOf(link), "not-a-real-token"))
    )

    expect(target.pathname).toBe(RESET_PASSWORD_PATH)
    expect(target.searchParams.get("error")).toBe("INVALID_TOKEN")
    expect(target.searchParams.has("token")).toBe(false)
  })

  it("TC-E0S2-34: a tampered or missing callback still lands on our page", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified()
    const link = await requestedLink(h, email)

    for (const variant of [
      link.replace(
        /callbackURL=[^&]+/,
        "callbackURL=https%3A%2F%2Fevil.example"
      ),
      link.replace(/\?callbackURL=[^&]+/, ""),
    ]) {
      const target = location(await h.follow(variant))

      expect(target.origin).toBe("http://localhost:3000")
      expect(target.pathname).toBe(RESET_PASSWORD_PATH)
    }
  })
})

describe("resetting the password", () => {
  it("TC-E0S2-03: a reset token is single-use", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    const token = tokenOf(await requestedLink(h, email))

    const first = await reset(h, token)
    const second = await reset(h, token, "another-pass-77")

    expect(first.status).toBe(200)
    expect(second.status).toBe(400)

    // The reused attempt must not have changed the password again.
    expect((await h.signIn({ email, password: NEW_PASSWORD })).status).toBe(200)
  })

  it("TC-E0S2-35: the new password works, the old one no longer does", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    await reset(h, tokenOf(await requestedLink(h, email)))

    expect((await h.signIn({ email, password: OLD_PASSWORD })).status).toBe(401)
    expect((await h.signIn({ email, password: NEW_PASSWORD })).status).toBe(200)
  })

  it("TC-E0S2-36: a reset revokes every existing session", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })

    const cookies = [
      sessionCookie(await h.signIn({ email, password: OLD_PASSWORD }))!,
      sessionCookie(await h.signIn({ email, password: OLD_PASSWORD }))!,
    ]
    for (const cookie of cookies) {
      const live = await h.auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      expect(live?.user.email).toBe(email)
    }

    await reset(h, tokenOf(await requestedLink(h, email)))

    for (const cookie of cookies) {
      const session = await h.auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      expect(session).toBeNull()
    }
  })

  it("TC-E0S2-37: a weak new password is rejected and does not burn the token", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    const token = tokenOf(await requestedLink(h, email))

    expect((await reset(h, token, "alllettersnodigit")).status).toBe(400)
    expect((await reset(h, token, "short1")).status).toBe(400)

    expect((await reset(h, token)).status).toBe(200)
  })

  it("TC-E0S2-38: a token expires after one hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })

    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    const link = await requestedLink(h, email)

    vi.setSystemTime(Date.now() + 61 * 60 * 1000)

    expect((await reset(h, tokenOf(link))).status).toBe(400)
    expect(location(await h.follow(link)).searchParams.get("error")).toBe(
      "INVALID_TOKEN"
    )
    expect((await h.signIn({ email, password: OLD_PASSWORD })).status).toBe(200)
  })

  it("TC-E0S2-39: using one link invalidates the other outstanding links", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })

    const first = tokenOf(await requestedLink(h, email))
    const second = tokenOf(await requestedLink(h, email))
    expect(second).not.toBe(first)

    expect((await reset(h, first)).status).toBe(200)
    expect((await reset(h, second, "yet-another-pass-5")).status).toBe(400)
    expect(
      (h.db.verification as DbRow[]).filter((row) =>
        String(row.identifier).startsWith("reset-password:")
      )
    ).toHaveLength(0)
  })

  it("TC-E0S2-40: resetting unlocks an account locked by failed sign-ins", async () => {
    const h = makeHarness()
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })

    for (let i = 0; i < 10; i += 1) {
      await h.signIn({ email, password: "wrong-password-1" })
    }
    expect((await h.signIn({ email, password: OLD_PASSWORD })).status).toBe(429)

    await reset(h, tokenOf(await requestedLink(h, email)))

    expect((await h.signIn({ email, password: NEW_PASSWORD })).status).toBe(200)
  })
})

describe("describeResetLink", () => {
  it("TC-E0S2-41: maps the callback query to what the page should show", () => {
    expect(describeResetLink({ token: "abc" })).toEqual({
      status: "ready",
      token: "abc",
    })
    expect(describeResetLink({ error: "INVALID_TOKEN" })).toEqual({
      status: "invalid",
    })
    expect(describeResetLink({})).toEqual({ status: "missing" })
    expect(describeResetLink({ token: "", error: "" })).toEqual({
      status: "missing",
    })
  })

  it("TC-E0S2-42: an error always wins over a token", () => {
    expect(describeResetLink({ token: "abc", error: "INVALID_TOKEN" })).toEqual(
      {
        status: "invalid",
      }
    )
  })
})
