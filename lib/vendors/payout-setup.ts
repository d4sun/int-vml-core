import type { VendorStatus } from "@prisma/client"

export type PayoutSetupState =
  /** Not approved (pending, rejected or suspended): no payout setup yet. */
  | "NOT_APPROVED"
  /** Approved, but no Stripe account has been started. */
  | "NOT_STARTED"
  /** A Stripe account exists and Stripe still needs something. */
  | "ACTION_NEEDED"
  /** Stripe reports charges and payouts enabled. */
  | "READY"

type SetupVendor = {
  status: VendorStatus
  stripeAccountId: string | null
  stripeOnboardingComplete: boolean
}

/**
 * Where a vendor is in payout setup, from what the database holds. Approval
 * comes first: a vendor that is not APPROVED is never shown as ready or as
 * needing action, whatever Stripe last said. READY is exactly the flag the
 * webhook maintains, the same one the sell gate reads.
 */
export function describePayoutSetup(vendor: SetupVendor): PayoutSetupState {
  if (vendor.status !== "APPROVED") return "NOT_APPROVED"
  if (vendor.stripeOnboardingComplete) return "READY"
  if (!vendor.stripeAccountId) return "NOT_STARTED"

  return "ACTION_NEEDED"
}

const MAX_LABEL_LENGTH = 80

/** Stripe's requirement keys in plain words, for the owner. */
export function describeRequirement(key: string): string {
  if (key === "external_account") return "Bank account for payouts"
  if (key === "business_type") return "Business type"
  if (key.startsWith("tos_acceptance"))
    return "Accept Stripe's terms of service"
  if (key.startsWith("business_profile")) return "Business details"
  if (key.startsWith("company")) return "Company details"
  if (key.startsWith("individual.verification")) return "Identity verification"
  if (key.startsWith("individual") || key.startsWith("representative")) {
    return "Personal details"
  }

  const words = key.replaceAll(/[._]+/g, " ").trim()

  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(
    0,
    MAX_LABEL_LENGTH
  )
}

/** One line per kind of thing Stripe needs, without repeats. */
export function describeRequirements(keys: readonly string[]): string[] {
  return [...new Set(keys.map(describeRequirement))]
}
