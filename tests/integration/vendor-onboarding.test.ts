import type {
  PlatformRole,
  PrismaClient,
  VendorRole,
  VendorStatus,
} from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import { ForbiddenError } from "@/lib/errors"
import { startOnboarding } from "@/lib/services/vendor-onboarding"
import { FakeStripe } from "@/lib/stripe/fake"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness
let stripe: FakeStripe

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
  stripe = new FakeStripe()
})

async function user(platformRole: PlatformRole = "VENDOR") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole },
  })

  return { id: row.id, email, session: await h.sessionFor(email, password) }
}

let counter = 0
async function vendorFor(
  member: { id: string },
  role: VendorRole = "OWNER",
  status: VendorStatus = "APPROVED",
  extra: { stripeOnboardingComplete?: boolean; stripeAccountId?: string } = {}
) {
  counter += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${counter}`,
      slug: `vendor-${counter}-${Date.now()}`,
      status,
      ...extra,
      members: { create: { userId: member.id, role } },
    },
  })
}

const start = (vendorId: string, session: SessionSource) =>
  startOnboarding(
    { vendorId },
    { session, db: prisma, stripe, appUrl: "http://localhost:3000" }
  )

const creates = () =>
  stripe.calls.filter((c) => c.method === "createConnectAccount")

const stored = async (id: string) =>
  (await prisma.vendor.findUniqueOrThrow({ where: { id } })).stripeAccountId

describe("startOnboarding on Postgres", () => {
  it("E4-S2-02: the owner of an approved vendor gets a link and the account is saved", async () => {
    const owner = await user()
    const vendor = await vendorFor(owner)
    const result = await start(vendor.id, owner.session)

    expect(result.status).toBe("link")

    const accountId = await stored(vendor.id)

    expect(accountId).toMatch(/^acct_fake_/)

    if (result.status === "link") expect(result.url).toContain(accountId!)

    expect(creates()).toHaveLength(1)
    expect(creates()[0]?.options).toEqual({
      idempotencyKey: `vendor-onboarding-account:${vendor.id}`,
    })
    expect(creates()[0]?.input).toEqual({
      vendorId: vendor.id,
      email: owner.email,
    })
  })

  it("E4-S2-02: starting again reuses the saved account and returns a new link", async () => {
    const owner = await user()
    const vendor = await vendorFor(owner)

    await start(vendor.id, owner.session)

    const first = await stored(vendor.id)
    const again = await start(vendor.id, owner.session)

    expect(again.status).toBe("link")
    expect(await stored(vendor.id)).toBe(first)
    expect(creates()).toHaveLength(1)
  })

  it("E4-S2-02: staff cannot start onboarding and nothing reaches Stripe", async () => {
    const owner = await user()
    const staff = await user()
    const vendor = await vendorFor(owner)

    await prisma.vendorMember.create({
      data: { userId: staff.id, vendorId: vendor.id, role: "STAFF" },
    })

    await expect(start(vendor.id, staff.session)).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(stripe.calls).toEqual([])
    expect(await stored(vendor.id)).toBeNull()
  })

  it("an owner of another vendor, and an admin, cannot start this vendor's onboarding", async () => {
    const owner = await user()
    const other = await user()
    const admin = await user("ADMIN")
    const vendor = await vendorFor(owner)

    await vendorFor(other)

    for (const caller of [other, admin]) {
      await expect(start(vendor.id, caller.session)).rejects.toBeInstanceOf(
        ForbiddenError
      )
    }

    expect(stripe.calls).toEqual([])
    expect(await stored(vendor.id)).toBeNull()
  })

  it("an unknown vendor looks the same as one the caller cannot access", async () => {
    const owner = await user()

    await expect(
      start("00000000-0000-0000-0000-000000000000", owner.session)
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it.each(["PENDING", "REJECTED", "SUSPENDED"] as const)(
    "E4-S2-02: the owner of a %s vendor gets no Stripe account",
    async (status) => {
      const owner = await user()
      const vendor = await vendorFor(owner, "OWNER", status)
      const error = await start(vendor.id, owner.session).catch(
        (e: unknown) => e
      )

      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).details).toEqual({
        reason: "NOT_APPROVED",
      })
      expect(stripe.calls).toEqual([])
      expect(await stored(vendor.id)).toBeNull()
    }
  )

  it("an already-onboarded vendor is told it is complete", async () => {
    const owner = await user()
    const vendor = await vendorFor(owner, "OWNER", "APPROVED", {
      stripeOnboardingComplete: true,
      stripeAccountId: "acct_existing",
    })

    expect(await start(vendor.id, owner.session)).toEqual({
      status: "complete",
    })
    expect(stripe.calls).toEqual([])
    expect(await stored(vendor.id)).toBe("acct_existing")
  })

  it("two simultaneous starts end with one account, saved once", async () => {
    const owner = await user()
    const vendor = await vendorFor(owner)

    const [a, b] = await Promise.all([
      start(vendor.id, owner.session),
      start(vendor.id, owner.session),
    ])

    expect([a.status, b.status]).toEqual(["link", "link"])

    const accountId = await stored(vendor.id)

    // The fake replays the same account for the same idempotency key, as
    // Stripe does, so every create call returned the saved account.
    const returned = new Set(
      [a, b].map((r) => (r.status === "link" ? r.url : ""))
    )

    for (const url of returned) expect(url).toContain(accountId!)
  })

  it("when another request saves an account between our read and our save, theirs is kept", async () => {
    const owner = await user()
    const vendor = await vendorFor(owner)
    const winner = (await stripe.createConnectAccount({ vendorId: vendor.id }))
      .id
    const original = stripe.createConnectAccount.bind(stripe)

    stripe.createConnectAccount = async (input, options) => {
      const mine = await original(input, options)

      // The other request finishes first.
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { stripeAccountId: winner },
      })

      return mine
    }

    const result = await start(vendor.id, owner.session)

    expect(await stored(vendor.id)).toBe(winner)

    if (result.status !== "link") throw new Error("expected a link")

    expect(result.url).toContain(winner)
  })

  it("a Stripe failure leaves the vendor without an account so a retry works", async () => {
    const owner = await user()
    const vendor = await vendorFor(owner)
    const original = stripe.createConnectAccount.bind(stripe)

    stripe.createConnectAccount = async () => {
      throw new Error("stripe down")
    }

    await expect(start(vendor.id, owner.session)).rejects.toThrow("stripe down")
    expect(await stored(vendor.id)).toBeNull()

    stripe.createConnectAccount = original

    expect((await start(vendor.id, owner.session)).status).toBe("link")
    expect(await stored(vendor.id)).not.toBeNull()
  })

  it("different vendors never share a Stripe account", async () => {
    const a = await user()
    const b = await user()
    const va = await vendorFor(a)
    const vb = await vendorFor(b)

    await start(va.id, a.session)
    await start(vb.id, b.session)

    expect(await stored(va.id)).not.toBe(await stored(vb.id))
  })
})
