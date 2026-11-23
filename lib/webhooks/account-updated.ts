import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { audit } from "@/lib/services/audit"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"

/** Bounds what one webhook can write, whatever Stripe sends. */
const MAX_REQUIREMENTS = 100
const MAX_FIELD_LENGTH = 200

const requirementList = z
  .array(z.string())
  .nullish()
  .transform((list) => list ?? [])

/** The parts of Stripe's Account object this handler reads. */
const accountSchema = z.object({
  id: z.string().min(1),
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  requirements: z
    .object({
      currently_due: requirementList,
      past_due: requirementList,
      disabled_reason: z.string().nullish(),
    })
    .nullish(),
})

export type AccountSummary = {
  accountId: string
  /** Stripe's own readiness rule: both capabilities, never one of them. */
  onboardingComplete: boolean
  requirementsDue: string[]
  disabledReason: string | null
}

/**
 * What the app keeps from an `account.updated` payload. A vendor is payout
 * ready only when Stripe says it can both take charges **and** receive
 * payouts; `details_submitted` is not enough (Stripe may still be verifying).
 * The requirement summary is what Stripe needs right now (`currently_due`
 * and `past_due`, merged and deduplicated), capped in size.
 */
export function summariseAccount(object: unknown): AccountSummary {
  const account = accountSchema.parse(object)
  const due = [
    ...new Set([
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ]),
  ]
    .map((field) => field.slice(0, MAX_FIELD_LENGTH))
    .slice(0, MAX_REQUIREMENTS)

  return {
    accountId: account.id,
    onboardingComplete:
      account.charges_enabled === true && account.payouts_enabled === true,
    requirementsDue: due,
    disabledReason:
      account.requirements?.disabled_reason?.slice(0, MAX_FIELD_LENGTH) ?? null,
  }
}

export const PAYOUTS_ENABLED_ACTION = "vendor.payouts_enabled"
export const PAYOUTS_DISABLED_ACTION = "vendor.payouts_disabled"

type LockedVendor = {
  id: string
  stripeOnboardingComplete: boolean
  stripeStatusAt: Date | null
}

/**
 * Handles Stripe's `account.updated` (E4-S2-04): the vendor's payout-ready
 * flag follows Stripe, in both directions, so a vendor whose account is later
 * restricted stops being able to sell.
 *
 * - The vendor is found by its Stripe account id. An unknown account is
 *   ignored (the event may be for an account we have not saved yet, or one we
 *   do not own); later events carry the full state, so nothing is lost.
 * - The vendor row is locked first, so two events for one account (Stripe
 *   does not promise delivery order) are applied one at a time.
 * - An event older than the last one applied is ignored, by Stripe's event
 *   timestamp, so a late delivery cannot undo newer state.
 * - A change in readiness writes an audit row (`vendor.payouts_enabled` or
 *   `vendor.payouts_disabled`, no actor) in the same transaction.
 */
export async function handleAccountUpdated(
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient
): Promise<void> {
  const summary = summariseAccount(event.data.object)
  const eventAt = new Date(event.created * 1000)

  const [vendor] = await tx.$queryRaw<LockedVendor[]>`
    SELECT "id", "stripeOnboardingComplete", "stripeStatusAt"
    FROM "Vendor"
    WHERE "stripeAccountId" = ${summary.accountId}
    FOR UPDATE`

  if (!vendor) return

  if (vendor.stripeStatusAt && vendor.stripeStatusAt > eventAt) return

  await tx.vendor.update({
    where: { id: vendor.id },
    data: {
      stripeOnboardingComplete: summary.onboardingComplete,
      stripeRequirementsDue: summary.requirementsDue,
      stripeDisabledReason: summary.disabledReason,
      stripeStatusAt: eventAt,
    },
  })

  if (vendor.stripeOnboardingComplete !== summary.onboardingComplete) {
    await audit.record(tx, {
      actorId: null,
      action: summary.onboardingComplete
        ? PAYOUTS_ENABLED_ACTION
        : PAYOUTS_DISABLED_ACTION,
      entityType: "Vendor",
      entityId: vendor.id,
      meta: {
        stripeEventId: event.id,
        stripeAccountId: summary.accountId,
        ...(summary.onboardingComplete
          ? {}
          : { requirementsDue: summary.requirementsDue }),
      },
    })
  }
}
