import type { PlatformRole, PrismaClient, VendorRole } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { getPayoutSetup } from "@/lib/services/payout-setup"
import { startOnboarding } from "@/lib/services/vendor-onboarding"
import { FakeStripe } from "@/lib/stripe/fake"
import { stripeHandlers } from "@/lib/webhooks/handlers"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
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

  return { id: row.id, session: await h.sessionFor(email, password) }
}

let counter = 0
async function vendorOf(
  member: { id: string },
  role: VendorRole = "OWNER",
  status: "APPROVED" | "SUSPENDED" | "PENDING" = "APPROVED"
) {
  counter += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${counter}`,
      slug: `vendor-${counter}-${Date.now()}`,
      status,
      members: { create: { userId: member.id, role } },
    },
  })
}

const view = (
  caller: { session: Awaited<ReturnType<typeof user>>["session"] },
  vendorId?: string
) =>
  getPayoutSetup(vendorId ? { vendorId } : {}, {
    session: caller.session,
    db: prisma,
  })

let n = 0
const webhook = (accountId: string, created: number) => {
  n += 1

  const { rawBody, signature } = stripe.signedAccountUpdated(
    accountId,
    `evt_ps_${n}`,
    created
  )

  return handleStripeWebhook(rawBody, signature, {
    stripe,
    db: prisma,
    handlers: stripeHandlers,
    logger: { error() {} },
  })
}

describe("payout setup status on Postgres", () => {
  it("follows the flag through the whole onboarding: not started, action needed, ready", async () => {
    const owner = await user()
    const vendor = await vendorOf(owner)

    expect(await view(owner)).toMatchObject({
      state: "NOT_STARTED",
      canStart: true,
      role: "OWNER",
      needs: [],
    })

    await startOnboarding(
      { vendorId: vendor.id },
      {
        session: owner.session,
        db: prisma,
        stripe,
        appUrl: "http://localhost:3000",
      }
    )

    const accountId = (
      await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })
    ).stripeAccountId!

    // Stripe has not told us anything yet: action needed, nothing listed.
    expect(await view(owner)).toMatchObject({
      state: "ACTION_NEEDED",
      canStart: true,
    })

    stripe.setAccount(accountId, {
      chargesEnabled: true,
      currentlyDue: ["external_account", "individual.dob.day"],
    })
    await webhook(accountId, 1_780_000_000)

    expect(await view(owner)).toMatchObject({
      state: "ACTION_NEEDED",
      needs: ["Bank account for payouts", "Personal details"],
    })

    stripe.completeOnboarding(accountId)
    await webhook(accountId, 1_780_000_100)

    expect(await view(owner)).toMatchObject({
      state: "READY",
      canStart: false,
      needs: [],
    })
  })

  it("staff see the status but cannot start", async () => {
    const owner = await user()
    const staff = await user()
    const vendor = await vendorOf(owner)

    await prisma.vendorMember.create({
      data: { userId: staff.id, vendorId: vendor.id, role: "STAFF" },
    })

    expect(await view(staff)).toMatchObject({
      role: "STAFF",
      state: "NOT_STARTED",
      canStart: false,
    })
  })

  it("a suspended or pending vendor is NOT_APPROVED with no way to start", async () => {
    for (const status of ["SUSPENDED", "PENDING"] as const) {
      const owner = await user()

      await vendorOf(owner, "OWNER", status)

      expect(await view(owner), status).toMatchObject({
        state: "NOT_APPROVED",
        canStart: false,
      })
    }
  })

  it("CR-2: someone else's vendor id shows the caller's own vendor, never theirs", async () => {
    const mine = await user()
    const theirs = await user()
    const myVendor = await vendorOf(mine)
    const theirVendor = await vendorOf(theirs)

    await prisma.vendor.update({
      where: { id: theirVendor.id },
      data: { stripeAccountId: "acct_theirs", stripeOnboardingComplete: true },
    })

    const result = await view(mine, theirVendor.id)

    expect(result?.vendor.id).toBe(myVendor.id)
    expect(result?.state).toBe("NOT_STARTED")
    expect(JSON.stringify(result)).not.toContain("acct_theirs")
  })

  it("someone who belongs to no vendor gets nothing", async () => {
    const nobody = await user()

    await vendorOf(await user())

    expect(await view(nobody)).toBeNull()
  })

  it("an owner of two vendors can look at either", async () => {
    const owner = await user()
    const first = await vendorOf(owner)
    const second = await vendorOf(owner)

    expect((await view(owner))?.vendor.id).toBe(first.id)

    const other = await view(owner, second.id)

    expect(other?.vendor.id).toBe(second.id)
    expect(other?.otherVendors).toEqual([{ id: first.id, name: first.name }])
  })
})
