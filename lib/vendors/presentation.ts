import type { VendorStatus } from "@prisma/client"
import type { VendorAction } from "@/lib/vendors/transitions"

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
}

/** Queue order for the filter tabs: what needs attention comes first. */
export const VENDOR_STATUS_ORDER: readonly VendorStatus[] = [
  "PENDING",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
]

export const VENDOR_ACTION_LABEL: Record<VendorAction, string> = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  reinstate: "Reinstate",
}

const AUDIT_LABEL: Record<string, string> = {
  "vendor.applied": "Applied",
  "vendor.approved": "Approved",
  "vendor.rejected": "Rejected",
  "vendor.suspended": "Suspended",
  "vendor.reinstated": "Reinstated",
}

/** A readable label for an audit verb; unknown verbs are shown as recorded. */
export function describeAuditAction(action: string): string {
  return AUDIT_LABEL[action] ?? action
}

export type AuditDetails = { from?: string; to?: string; reason?: string }

/** Reads an audit row's JSON `meta` defensively: only known string fields. */
export function readAuditDetails(meta: unknown): AuditDetails {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return {}
  }

  const record = meta as Record<string, unknown>
  const details: AuditDetails = {}

  for (const key of ["from", "to", "reason"] as const) {
    if (typeof record[key] === "string") details[key] = record[key]
  }

  return details
}

/**
 * The status filter for the vendors queue. It defaults to the pending queue,
 * `ALL` means no filter, and anything unrecognised falls back to the default
 * instead of erroring on a hand-edited URL.
 */
export function parseQueueFilter(
  value: string | string[] | undefined
): VendorStatus | "ALL" {
  const raw = Array.isArray(value) ? value[0] : value

  if (raw === "ALL") return "ALL"

  return VENDOR_STATUS_ORDER.find((status) => status === raw) ?? "PENDING"
}
