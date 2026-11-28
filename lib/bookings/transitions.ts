import type { BookingItemStatus } from "@prisma/client"
import { ConflictError } from "@/lib/errors"

/**
 * What a vendor may do to a booking item, and where it leads (E6-S1). Only a
 * settled, confirmed item can be fulfilled or marked no-show; a refunded,
 * cancelled, pending or already-decided item is refused with its reason.
 */
export const VENDOR_ITEM_ACTIONS = ["fulfil", "noShow"] as const

export type VendorItemAction = (typeof VENDOR_ITEM_ACTIONS)[number]

const NEXT: Record<
  VendorItemAction,
  { from: BookingItemStatus; to: BookingItemStatus }
> = {
  fulfil: { from: "CONFIRMED", to: "FULFILLED" },
  noShow: { from: "CONFIRMED", to: "NO_SHOW" },
}

/** The status an action leads to, or a ConflictError saying why it is not allowed. */
export function nextItemStatus(
  current: BookingItemStatus,
  action: VendorItemAction
): BookingItemStatus {
  const rule = NEXT[action]

  if (current !== rule.from) {
    throw new ConflictError(
      `This booking item is ${current.toLowerCase()}, so it cannot be ${action === "fulfil" ? "fulfilled" : "marked no-show"}.`,
      {
        details: { reason: "NOT_ACTIONABLE", status: current },
      }
    )
  }

  return rule.to
}

/** A no-show can only be recorded once the slot has started. */
export function noShowAllowed(startAt: Date, now: Date): boolean {
  return now.getTime() >= startAt.getTime()
}
