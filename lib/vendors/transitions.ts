import type { VendorStatus } from "@prisma/client"
import { ConflictError } from "@/lib/errors"

export const VENDOR_ACTIONS = [
  "approve",
  "reject",
  "suspend",
  "reinstate",
] as const

export type VendorAction = (typeof VENDOR_ACTIONS)[number]

/**
 * The only legal vendor status changes. Anything not listed is illegal, so a
 * new status or action cannot become reachable by accident.
 *
 * PENDING → APPROVED | REJECTED, APPROVED → SUSPENDED, SUSPENDED → APPROVED.
 * REJECTED is final: a rejected applicant applies again as a new vendor.
 */
const TRANSITIONS: Record<
  VendorAction,
  { from: readonly VendorStatus[]; to: VendorStatus; audit: string }
> = {
  approve: { from: ["PENDING"], to: "APPROVED", audit: "vendor.approved" },
  reject: { from: ["PENDING"], to: "REJECTED", audit: "vendor.rejected" },
  suspend: { from: ["APPROVED"], to: "SUSPENDED", audit: "vendor.suspended" },
  reinstate: {
    from: ["SUSPENDED"],
    to: "APPROVED",
    audit: "vendor.reinstated",
  },
}

const PAST_TENSE: Record<VendorAction, string> = {
  approve: "approved",
  reject: "rejected",
  suspend: "suspended",
  reinstate: "reinstated",
}

/** A reason is mandatory when a vendor is turned away or switched off. */
export const REASON_REQUIRED: readonly VendorAction[] = ["reject", "suspend"]

export function canTransition(
  current: VendorStatus,
  action: VendorAction
): boolean {
  return TRANSITIONS[action].from.includes(current)
}

/** The status `action` leads to, or a ConflictError when it is not allowed. */
export function nextVendorStatus(
  current: VendorStatus,
  action: VendorAction
): VendorStatus {
  if (!canTransition(current, action)) {
    throw new ConflictError(
      `A ${current.toLowerCase()} vendor cannot be ${PAST_TENSE[action]}`
    )
  }

  return TRANSITIONS[action].to
}

/** What an admin can do next, for the UI to offer exactly these buttons. */
export function allowedActions(current: VendorStatus): VendorAction[] {
  return VENDOR_ACTIONS.filter((action) => canTransition(current, action))
}

export function auditActionFor(action: VendorAction): string {
  return TRANSITIONS[action].audit
}
