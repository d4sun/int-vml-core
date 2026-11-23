import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import { assertVendorCanSell } from "@/lib/catalog/visibility"
import { applyAsVendor } from "@/lib/services/vendor-application"
import { transitionVendor } from "@/lib/services/vendor-governance"
import { startOnboarding } from "@/lib/services/vendor-onboarding"
import { FakeStripe } from "@/lib/stripe/fake"
import { stripeHandlers } from "@/lib/webhooks/handlers"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"
import { governanceDeps } from "../helpers/recording-transactional-queue"

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

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

/** Why the gate refuses the vendor right now, or null when it allows. */
async function gate(vendorId: string): Promise<string | null> {
  try {
    await assertVendorCanSell(vendorId, prisma)

    return null
  } catch (error) {
    return (error as { details?: { reason?: string } }).details?.reason ?? "?"
  }
}

let eventCounter = 0
const webhook = (accountId: string, created: number) => {
  eventCounter += 1

  const { rawBody, signature } = stripe.signedAccountUpdated(
    accountId,
    `evt_gate_${eventCounter}`,
    created
  )

  return handleStripeWebhook(rawBody, signature, {
    stripe,
    db: prisma,
    handlers: stripeHandlers,
    logger: { error() {} },
  })
}

describe("the sell gate across a vendor's whole life (Postgres)", () => {
  it("TC-E4S2-04, -02, -01 and IT-14: blocked while pending, blocked until onboarding finishes, then unlocked", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("TOURIST", "Olive")
    const governance = (session: SessionSource) =>
      governanceDeps(session, prisma)

    // TC-E4S2-04: a pending vendor cannot publish or be paid.
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      governance(owner.session)
    )

    expect(await gate(applied.id)).toBe("NOT_APPROVED")

    // Approved, but no payout setup yet.
    await transitionVendor(
      { vendorId: applied.id, action: "approve" },
      governance(admin.session)
    )

    expect(await gate(applied.id)).toBe("NOT_ONBOARDED")

    // TC-E4S2-02: the owner starts onboarding and Stripe reports charges
    // only, so the vendor is still blocked.
    await startOnboarding(
      { vendorId: applied.id },
      {
        session: owner.session,
        db: prisma,
        stripe,
        appUrl: "http://localhost:3000",
      }
    )

    const accountId = (
      await prisma.vendor.findUniqueOrThrow({ where: { id: applied.id } })
    ).stripeAccountId!

    stripe.setAccount(accountId, { chargesEnabled: true })
    await webhook(accountId, 1_780_000_000)

    expect(await gate(applied.id)).toBe("NOT_ONBOARDED")

    // TC-E4S2-01: onboarding completes, publishing and payouts unlock.
    stripe.completeOnboarding(accountId)
    await webhook(accountId, 1_780_000_100)

    expect(await gate(applied.id)).toBeNull()
  })

  it("suspending blocks a ready vendor, reinstating unlocks it again, and a later Stripe restriction blocks it", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("TOURIST", "Olive")
    const governance = (session: SessionSource) =>
      governanceDeps(session, prisma)
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      governance(owner.session)
    )

    await transitionVendor(
      { vendorId: applied.id, action: "approve" },
      governance(admin.session)
    )
    await startOnboarding(
      { vendorId: applied.id },
      {
        session: owner.session,
        db: prisma,
        stripe,
        appUrl: "http://localhost:3000",
      }
    )

    const accountId = (
      await prisma.vendor.findUniqueOrThrow({ where: { id: applied.id } })
    ).stripeAccountId!

    stripe.completeOnboarding(accountId)
    await webhook(accountId, 1_780_000_000)
    expect(await gate(applied.id)).toBeNull()

    await transitionVendor(
      { vendorId: applied.id, action: "suspend", reason: "Complaints" },
      governance(admin.session)
    )
    expect(await gate(applied.id)).toBe("NOT_APPROVED")

    await transitionVendor(
      { vendorId: applied.id, action: "reinstate" },
      governance(admin.session)
    )
    expect(await gate(applied.id)).toBeNull()

    stripe.setAccount(accountId, { payoutsEnabled: false })
    await webhook(accountId, 1_780_000_200)
    expect(await gate(applied.id)).toBe("NOT_ONBOARDED")
  })

  it("a ready Stripe flag never lets an unapproved vendor through", async () => {
    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      const vendor = await prisma.vendor.create({
        data: {
          name: `Vendor ${status}`,
          slug: `vendor-${status.toLowerCase()}-${Date.now()}`,
          status,
          stripeAccountId: `acct_${status}`,
          stripeOnboardingComplete: true,
        },
      })

      expect(await gate(vendor.id), status).toBe("NOT_APPROVED")
    }
  })
})
