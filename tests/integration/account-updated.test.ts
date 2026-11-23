import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { assertVendorCanSell } from "@/lib/catalog/visibility"
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

const T0 = 1_780_000_000
let counter = 0

/** An approved vendor that already has a Stripe account (as after E4-S2-02). */
async function vendorWithAccount(
  status: "APPROVED" | "SUSPENDED" = "APPROVED"
) {
  counter += 1

  const account = await stripe.createConnectAccount({
    vendorId: `seed-${counter}`,
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `Vendor ${counter}`,
      slug: `vendor-${counter}-${Date.now()}`,
      status,
      stripeAccountId: account.id,
    },
  })

  return { vendor, accountId: account.id }
}

const deliver = (accountId: string, id: string, created = T0) => {
  const { rawBody, signature } = stripe.signedAccountUpdated(
    accountId,
    id,
    created
  )

  return handleStripeWebhook(rawBody, signature, {
    stripe,
    db: prisma,
    handlers: stripeHandlers,
    logger: { error() {} },
  })
}

const reload = (id: string) =>
  prisma.vendor.findUniqueOrThrow({ where: { id } })

const auditFor = (vendorId: string) =>
  prisma.auditLog.findMany({
    where: { entityType: "Vendor", entityId: vendorId },
    orderBy: { at: "asc" },
  })

const blockReason = async (vendorId: string) => {
  try {
    await assertVendorCanSell(vendorId, prisma)
    return null
  } catch (error) {
    return (
      (error as { details?: { reason?: string } }).details?.reason ?? "error"
    )
  }
}

describe("account.updated on Postgres", () => {
  it("TC-E4S2-01: both capabilities enabled sets the flag, which unlocks selling", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    expect(await blockReason(vendor.id)).toBe("NOT_ONBOARDED")

    stripe.completeOnboarding(accountId)

    expect(await deliver(accountId, "evt_1")).toMatchObject({
      status: 200,
      body: { result: "processed" },
    })

    const row = await reload(vendor.id)

    expect(row.stripeOnboardingComplete).toBe(true)
    expect(row.stripeRequirementsDue).toEqual([])
    expect(row.stripeDisabledReason).toBeNull()
    expect(row.stripeStatusAt).toEqual(new Date(T0 * 1000))
    expect(await blockReason(vendor.id)).toBeNull()

    const audit = await auditFor(vendor.id)

    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorId: null,
      action: "vendor.payouts_enabled",
      meta: { stripeEventId: "evt_1", stripeAccountId: accountId },
    })
  })

  it("TC-E4S2-03: charges enabled without payouts keeps the flag false and records what is due", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    stripe.setAccount(accountId, {
      chargesEnabled: true,
      payoutsEnabled: false,
      currentlyDue: ["external_account"],
    })
    await deliver(accountId, "evt_1")

    const row = await reload(vendor.id)

    expect(row.stripeOnboardingComplete).toBe(false)
    expect(row.stripeRequirementsDue).toEqual(["external_account"])
    expect(await blockReason(vendor.id)).toBe("NOT_ONBOARDED")
    expect(await auditFor(vendor.id)).toHaveLength(0)
  })

  it("TC-E4S2-02: a vendor that is not onboarded cannot publish or be paid, and the summary says why", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    await deliver(accountId, "evt_1")

    expect(await blockReason(vendor.id)).toBe("NOT_ONBOARDED")
    expect(
      (await reload(vendor.id)).stripeRequirementsDue.length
    ).toBeGreaterThan(0)
  })

  it("a later restriction clears the flag and the vendor stops being able to sell", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    stripe.completeOnboarding(accountId)
    await deliver(accountId, "evt_1", T0)

    stripe.setAccount(accountId, {
      payoutsEnabled: false,
      currentlyDue: ["individual.verification.document"],
      disabledReason: "requirements.past_due",
    })
    await deliver(accountId, "evt_2", T0 + 60)

    const row = await reload(vendor.id)

    expect(row.stripeOnboardingComplete).toBe(false)
    expect(row.stripeDisabledReason).toBe("requirements.past_due")
    expect(await blockReason(vendor.id)).toBe("NOT_ONBOARDED")
    expect((await auditFor(vendor.id)).map((a) => a.action)).toEqual([
      "vendor.payouts_enabled",
      "vendor.payouts_disabled",
    ])
  })

  it("an older event delivered late does not undo newer state", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    stripe.completeOnboarding(accountId)

    const newer = stripe.signedAccountUpdated(accountId, "evt_new", T0 + 100)

    stripe.setAccount(accountId, { payoutsEnabled: false })

    const older = stripe.signedAccountUpdated(accountId, "evt_old", T0)
    const send = (e: { rawBody: string; signature: string }) =>
      handleStripeWebhook(e.rawBody, e.signature, {
        stripe,
        db: prisma,
        handlers: stripeHandlers,
        logger: { error() {} },
      })

    await send(newer)
    await send(older)

    const row = await reload(vendor.id)

    expect(row.stripeOnboardingComplete).toBe(true)
    expect(row.stripeStatusAt).toEqual(new Date((T0 + 100) * 1000))
    expect(await auditFor(vendor.id)).toHaveLength(1)
  })

  it("IT-08: the same event delivered twice changes and audits once", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    stripe.completeOnboarding(accountId)
    await deliver(accountId, "evt_1")

    const again = await deliver(accountId, "evt_1")

    expect(again).toMatchObject({ body: { result: "duplicate" } })
    expect(await auditFor(vendor.id)).toHaveLength(1)
    expect(await prisma.webhookEvent.count()).toBe(1)
  })

  it("events for different accounts only change their own vendor", async () => {
    const a = await vendorWithAccount()
    const b = await vendorWithAccount()

    stripe.completeOnboarding(a.accountId)
    await deliver(a.accountId, "evt_a")

    expect((await reload(a.vendor.id)).stripeOnboardingComplete).toBe(true)
    expect((await reload(b.vendor.id)).stripeOnboardingComplete).toBe(false)
    expect((await reload(b.vendor.id)).stripeStatusAt).toBeNull()
  })

  it("an account no vendor owns is acknowledged and changes nothing", async () => {
    const orphan = await stripe.createConnectAccount({ vendorId: "nobody" })
    const { vendor } = await vendorWithAccount()

    stripe.completeOnboarding(orphan.id)

    expect(await deliver(orphan.id, "evt_x")).toMatchObject({ status: 200 })
    expect((await reload(vendor.id)).stripeOnboardingComplete).toBe(false)
    expect(await prisma.auditLog.count()).toBe(0)
  })

  it("the flag follows Stripe for a suspended vendor, who still cannot sell", async () => {
    const { vendor, accountId } = await vendorWithAccount("SUSPENDED")

    stripe.completeOnboarding(accountId)
    await deliver(accountId, "evt_1")

    expect((await reload(vendor.id)).stripeOnboardingComplete).toBe(true)
    expect(await blockReason(vendor.id)).toBe("NOT_APPROVED")
  })

  it("two events for one account arriving together end in the newest state", async () => {
    const { vendor, accountId } = await vendorWithAccount()

    stripe.completeOnboarding(accountId)

    const ready = stripe.signedAccountUpdated(accountId, "evt_ready", T0 + 10)

    stripe.setAccount(accountId, { chargesEnabled: false })

    const restricted = stripe.signedAccountUpdated(
      accountId,
      "evt_bad",
      T0 + 20
    )
    const send = (e: { rawBody: string; signature: string }) =>
      handleStripeWebhook(e.rawBody, e.signature, {
        stripe,
        db: prisma,
        handlers: stripeHandlers,
        logger: { error() {} },
      })

    await Promise.all([send(restricted), send(ready)])

    const row = await reload(vendor.id)

    expect(row.stripeOnboardingComplete).toBe(false)
    expect(row.stripeStatusAt).toEqual(new Date((T0 + 20) * 1000))
  })

  it("E4-S2 end to end: start onboarding, finish it at Stripe, and the webhook makes the vendor sellable", async () => {
    const { email, password } = await h.registerVerified()
    const owner = await prisma.user.update({
      where: { email },
      data: { platformRole: "VENDOR" as PlatformRole },
    })
    const vendor = await prisma.vendor.create({
      data: {
        name: "Journey Tours",
        slug: `journey-${Date.now()}`,
        status: "APPROVED",
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    })

    await startOnboarding(
      { vendorId: vendor.id },
      {
        session: await h.sessionFor(email, password),
        db: prisma,
        stripe,
        appUrl: "http://localhost:3000",
      }
    )

    const accountId = (await reload(vendor.id)).stripeAccountId!

    expect(await blockReason(vendor.id)).toBe("NOT_ONBOARDED")

    stripe.completeOnboarding(accountId)
    await deliver(accountId, "evt_done")

    expect(await blockReason(vendor.id)).toBeNull()
  })
})
