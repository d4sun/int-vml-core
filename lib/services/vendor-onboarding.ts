import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import {
  requestSessionSource,
  requireUser,
  requireVendorMember,
  prismaMembershipStore,
  type MembershipStore,
  type SessionSource,
} from "@/lib/auth/guards"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import type { StripeAdapter } from "@/lib/stripe/adapter"
import { startOnboardingSchema } from "@/lib/validation/vendor-onboarding"

export type VendorOnboardingDeps = {
  session?: SessionSource
  memberships?: MembershipStore
  db?: Pick<PrismaClient, "vendor" | "vendorMember">
  stripe?: StripeAdapter
  /** Public origin used for Stripe's return and refresh URLs. */
  appUrl?: string
}

export type OnboardingStart =
  | { status: "link"; url: string; expiresAt: Date }
  /** Stripe already reports charges and payouts enabled: nothing to do. */
  | { status: "complete" }

/** The page Stripe sends the owner back to (built in E4-S2-06). */
export const PAYOUT_SETUP_PATH = "/vendor/payouts/setup"

export function onboardingUrls(appUrl: string) {
  const base = new URL(PAYOUT_SETUP_PATH, appUrl)

  return {
    returnUrl: `${base.toString()}?stripe=return`,
    refreshUrl: `${base.toString()}?stripe=refresh`,
  }
}

/** One Stripe account per vendor, however many times or how fast we ask. */
export const accountIdempotencyKey = (vendorId: string) =>
  `vendor-onboarding-account:${vendorId}`

/**
 * Starts (or resumes) Stripe Connect Express onboarding for a vendor and
 * returns a fresh hosted link.
 *
 * Only the vendor's OWNER may do this (staff and non-members get the same
 * ForbiddenError as for any vendor they cannot access), and only while the
 * vendor is APPROVED: a pending, rejected or suspended vendor never gets a
 * Stripe account, so nobody can be paid before an admin has approved them.
 *
 * The Stripe account is created once. The create call carries an idempotency
 * key derived from the vendor, so two simultaneous starts (or a retry after a
 * timeout) get the same account from Stripe, and the id is saved with a
 * `WHERE stripeAccountId IS NULL` guard so a second writer never overwrites
 * the first. Nothing is held open in a database transaction while Stripe is
 * called. Each start returns a new link: links are single use and short
 * lived, so replaying an old one would hand the owner a dead page.
 */
export async function startOnboarding(
  input: unknown,
  deps: VendorOnboardingDeps = {}
): Promise<OnboardingStart> {
  const session = deps.session ?? requestSessionSource

  // Signed out is a 401 whatever the input looks like.
  await requireUser(session)

  const parsed = startOnboardingSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { vendorId } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const actor = await requireVendorMember(vendorId, ["OWNER"], {
    session,
    memberships: deps.memberships ?? prismaMembershipStore(db),
  })

  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()
  const appUrl =
    deps.appUrl ?? (await import("@/lib/env")).getEnv().BETTER_AUTH_URL

  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: {
      status: true,
      stripeAccountId: true,
      stripeOnboardingComplete: true,
      contactEmail: true,
    },
  })

  if (!vendor) throw new NotFoundError("Vendor not found")

  if (vendor.status !== "APPROVED") {
    throw new ForbiddenError(
      "Payout setup is available once your application has been approved",
      { details: { reason: "NOT_APPROVED" } }
    )
  }

  if (vendor.stripeOnboardingComplete) return { status: "complete" }

  const accountId =
    vendor.stripeAccountId ??
    (await createAndStoreAccount({
      db,
      stripe,
      vendorId,
      email: vendor.contactEmail ?? actor.email,
    }))

  const link = await stripe.createAccountLink({
    accountId,
    ...onboardingUrls(appUrl),
  })

  return { status: "link", url: link.url, expiresAt: link.expiresAt }
}

async function createAndStoreAccount(args: {
  db: Pick<PrismaClient, "vendor">
  stripe: StripeAdapter
  vendorId: string
  email: string
}): Promise<string> {
  const { db, stripe, vendorId, email } = args

  const account = await stripe.createConnectAccount(
    { vendorId, email },
    { idempotencyKey: accountIdempotencyKey(vendorId) }
  )

  const { count } = await db.vendor.updateMany({
    where: { id: vendorId, stripeAccountId: null },
    data: { stripeAccountId: account.id },
  })

  if (count === 1) return account.id

  // Someone else saved an account first. Use theirs, never overwrite it.
  const stored = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { stripeAccountId: true },
  })

  if (!stored?.stripeAccountId) {
    throw new Error("Stripe account could not be saved for this vendor")
  }

  return stored.stripeAccountId
}
