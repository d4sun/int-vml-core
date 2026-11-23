import type { PrismaClient, VendorRole, VendorStatus } from "@prisma/client"
import {
  requestSessionSource,
  requireUser,
  type SessionSource,
} from "@/lib/auth/guards"
import {
  describePayoutSetup,
  describeRequirements,
  type PayoutSetupState,
} from "@/lib/vendors/payout-setup"

export type PayoutSetupDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "vendorMember">
}

export type PayoutSetup = {
  vendor: { id: string; name: string; status: VendorStatus }
  role: VendorRole
  state: PayoutSetupState
  /** What Stripe needs, in plain words. Empty unless `ACTION_NEEDED`. */
  needs: string[]
  /** Only an owner of an approved vendor may start or continue setup. */
  canStart: boolean
  /** The caller's other vendors, so the page can offer a switch. */
  otherVendors: { id: string; name: string }[]
}

/**
 * The payout setup status for the caller's own vendor (CR-2): it is read
 * through the caller's memberships, never by a vendor id alone, so it cannot
 * show another vendor's state. `vendorId` only chooses among the caller's
 * vendors; an id that is not theirs is ignored and the first is used.
 *
 * Returns `null` when the caller belongs to no vendor. The Stripe account id
 * is never returned.
 */
export async function getPayoutSetup(
  input: { vendorId?: string } = {},
  deps: PayoutSetupDeps = {}
): Promise<PayoutSetup | null> {
  const actor = await requireUser(deps.session ?? requestSessionSource)
  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  const memberships = await db.vendorMember.findMany({
    where: { userId: actor.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      role: true,
      vendor: {
        select: {
          id: true,
          name: true,
          status: true,
          stripeAccountId: true,
          stripeOnboardingComplete: true,
          stripeRequirementsDue: true,
        },
      },
    },
  })

  const current =
    memberships.find((m) => m.vendor.id === input.vendorId) ?? memberships[0]

  if (!current) return null

  const { vendor, role } = current
  const state = describePayoutSetup(vendor)

  return {
    vendor: { id: vendor.id, name: vendor.name, status: vendor.status },
    role,
    state,
    needs:
      state === "ACTION_NEEDED"
        ? describeRequirements(vendor.stripeRequirementsDue)
        : [],
    canStart:
      role === "OWNER" && vendor.status === "APPROVED" && state !== "READY",
    otherVendors: memberships
      .filter((m) => m.vendor.id !== vendor.id)
      .map((m) => ({ id: m.vendor.id, name: m.vendor.name })),
  }
}
