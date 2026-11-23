import { describe, expect, it } from "vitest"
import type { MembershipStore, SessionSource } from "@/lib/auth/guards"
import { ForbiddenError, ValidationError } from "@/lib/errors"
import {
  accountIdempotencyKey,
  onboardingUrls,
  startOnboarding,
} from "@/lib/services/vendor-onboarding"
import { FakeStripe } from "@/lib/stripe/fake"

const APP = "https://vml.test"

type VendorRow = {
  status: string
  stripeAccountId: string | null
  stripeOnboardingComplete: boolean
  contactEmail: string | null
}

const as =
  (platformRole: string | null): SessionSource =>
  async () =>
    platformRole
      ? {
          user: {
            id: "u1",
            email: "owner@example.com",
            name: "Owner",
            emailVerified: true,
            platformRole,
          },
        }
      : null

const member = (role: "OWNER" | "STAFF" | null): MembershipStore => ({
  findMembership: async () => (role ? { role } : null),
})

function fakeDb(initial: Partial<VendorRow> = {}) {
  const row: VendorRow = {
    status: "APPROVED",
    stripeAccountId: null,
    stripeOnboardingComplete: false,
    contactEmail: "shop@example.com",
    ...initial,
  }
  const log: string[] = []
  let loseRace: string | null = null

  const db = {
    vendor: {
      findUnique: async () => {
        log.push("find")
        return { ...row }
      },
      updateMany: async (args: {
        where: { stripeAccountId?: null }
        data: { stripeAccountId: string }
      }) => {
        log.push("update")

        if (loseRace) {
          row.stripeAccountId = loseRace
        }

        // Honour the WHERE clause the service sends.
        if (
          args.where.stripeAccountId === null &&
          row.stripeAccountId !== null
        ) {
          return { count: 0 }
        }

        row.stripeAccountId = args.data.stripeAccountId

        return { count: 1 }
      },
    },
  } as never

  return {
    db,
    row,
    log,
    /** The next save finds another writer already stored this account. */
    raceWith(accountId: string) {
      loseRace = accountId
    },
  }
}

function setup(
  options: {
    role?: string | null
    member?: "OWNER" | "STAFF" | null
    vendor?: Partial<VendorRow>
  } = {}
) {
  const stripe = new FakeStripe()
  const store = fakeDb(options.vendor)
  const deps = {
    session: as(options.role === undefined ? "VENDOR" : options.role),
    memberships: member(
      options.member === undefined ? "OWNER" : options.member
    ),
    db: store.db,
    stripe,
    appUrl: APP,
  }

  return { stripe, ...store, deps }
}

const input = { vendorId: "v1" }

describe("startOnboarding access", () => {
  it("E4-S2-02: signed out is a 401 and nothing is touched", async () => {
    const t = setup({ role: null })

    await expect(startOnboarding(input, t.deps)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    })
    expect(t.log).toEqual([])
    expect(t.stripe.calls).toEqual([])
  })

  it.each([
    ["staff", "STAFF" as const],
    ["a non-member", null],
  ])("E4-S2-02: %s is refused and Stripe is never called", async (_, who) => {
    const t = setup({ member: who })

    await expect(startOnboarding(input, t.deps)).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(t.log).toEqual([])
    expect(t.stripe.calls).toEqual([])
  })

  it("a platform admin who is not a member is refused too", async () => {
    const t = setup({ role: "ADMIN", member: null })

    await expect(startOnboarding(input, t.deps)).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it.each(["PENDING", "REJECTED", "SUSPENDED"])(
    "E4-S2-02: a %s vendor gets no Stripe account",
    async (status) => {
      const t = setup({ vendor: { status } })
      const error = await startOnboarding(input, t.deps).catch(
        (e: unknown) => e
      )

      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).details).toEqual({
        reason: "NOT_APPROVED",
      })
      expect(t.stripe.calls).toEqual([])
      expect(t.row.stripeAccountId).toBeNull()
    }
  )

  it("rejects invalid or extra input with a ValidationError, before the membership check", async () => {
    for (const bad of [
      {},
      { vendorId: "" },
      { vendorId: "v1", stripeAccountId: "acct_x" },
      { vendorId: "v1", returnUrl: "https://evil.test" },
      null,
    ]) {
      const t = setup({ member: null })

      await expect(startOnboarding(bad, t.deps)).rejects.toBeInstanceOf(
        ValidationError
      )
      expect(t.stripe.calls).toEqual([])
    }
  })
})

describe("startOnboarding flow", () => {
  it("E4-S2-02: an owner of an approved vendor gets a link and the account is saved", async () => {
    const t = setup()
    const result = await startOnboarding(input, t.deps)

    expect(result.status).toBe("link")

    if (result.status !== "link") throw new Error("expected a link")

    expect(t.row.stripeAccountId).toMatch(/^acct_fake_/)
    expect(result.url).toContain(t.row.stripeAccountId as string)
  })

  it("creates the account once with a vendor-derived idempotency key, for the vendor's contact email", async () => {
    const t = setup()

    await startOnboarding(input, t.deps)

    const create = t.stripe.calls.find(
      (c) => c.method === "createConnectAccount"
    )

    expect(create?.input).toEqual({
      vendorId: "v1",
      email: "shop@example.com",
    })
    expect(create?.options).toEqual({
      idempotencyKey: "vendor-onboarding-account:v1",
    })
    expect(accountIdempotencyKey("v1")).toBe("vendor-onboarding-account:v1")
  })

  it("falls back to the owner's account email when the vendor has no contact email", async () => {
    const t = setup({ vendor: { contactEmail: null } })

    await startOnboarding(input, t.deps)

    expect(
      t.stripe.calls.find((c) => c.method === "createConnectAccount")?.input
    ).toEqual({ vendorId: "v1", email: "owner@example.com" })
  })

  it("sends Stripe the return and refresh pages and nothing the client chose", async () => {
    const t = setup()

    await startOnboarding(input, t.deps)

    expect(
      t.stripe.calls.find((c) => c.method === "createAccountLink")?.input
    ).toEqual({
      accountId: t.row.stripeAccountId,
      returnUrl: "https://vml.test/vendor/payouts/setup?stripe=return",
      refreshUrl: "https://vml.test/vendor/payouts/setup?stripe=refresh",
    })
  })

  it("E4-S2-02: a second start reuses the account and still returns a link", async () => {
    const t = setup()

    await startOnboarding(input, t.deps)
    const saved = t.row.stripeAccountId
    const again = await startOnboarding(input, t.deps)

    expect(again.status).toBe("link")
    expect(t.row.stripeAccountId).toBe(saved)
    expect(
      t.stripe.calls.filter((c) => c.method === "createConnectAccount")
    ).toHaveLength(1)
    expect(
      t.stripe.calls.filter((c) => c.method === "createAccountLink")
    ).toHaveLength(2)
  })

  it("an already-complete vendor is told so and Stripe is not called", async () => {
    const t = setup({
      vendor: { stripeAccountId: "acct_1", stripeOnboardingComplete: true },
    })

    expect(await startOnboarding(input, t.deps)).toEqual({
      status: "complete",
    })
    expect(t.stripe.calls).toEqual([])
  })

  it("saves with a guard so a concurrent writer is never overwritten", async () => {
    const t = setup()
    const winner = (await t.stripe.createConnectAccount({ vendorId: "v1" })).id

    t.raceWith(winner)

    const result = await startOnboarding(input, t.deps)

    expect(result.status).toBe("link")
    expect(t.row.stripeAccountId).toBe(winner)

    const link = t.stripe.calls
      .filter((c) => c.method === "createAccountLink")
      .at(-1)

    expect((link?.input as { accountId: string }).accountId).toBe(winner)
  })

  it("a Stripe failure saves nothing, so the next try starts clean", async () => {
    const t = setup()
    const boom = new Error("stripe down")
    const original = t.stripe.createConnectAccount.bind(t.stripe)

    t.stripe.createConnectAccount = async () => {
      throw boom
    }

    await expect(startOnboarding(input, t.deps)).rejects.toBe(boom)
    expect(t.row.stripeAccountId).toBeNull()

    t.stripe.createConnectAccount = original

    expect((await startOnboarding(input, t.deps)).status).toBe("link")
  })
})

describe("onboardingUrls", () => {
  it("builds absolute urls from the public origin", () => {
    expect(onboardingUrls("https://visitmylondon.com")).toEqual({
      returnUrl: "https://visitmylondon.com/vendor/payouts/setup?stripe=return",
      refreshUrl:
        "https://visitmylondon.com/vendor/payouts/setup?stripe=refresh",
    })
  })

  it("ignores a path on the origin", () => {
    expect(onboardingUrls("https://vml.test/some/path").returnUrl).toBe(
      "https://vml.test/vendor/payouts/setup?stripe=return"
    )
  })
})
