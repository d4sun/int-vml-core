import type { ListingStatus } from "@prisma/client"
import { ConflictError } from "@/lib/errors"

export const MODERATION_ACTIONS = ["approve", "reject"] as const

export type ModerationAction = (typeof MODERATION_ACTIONS)[number]

/** A reason is mandatory when a listing is turned away, so the vendor knows what to fix. */
export const MODERATION_REASON_REQUIRED: readonly ModerationAction[] = [
  "reject",
]

/**
 * The only admin moves on a listing. Nothing else reaches PUBLISHED: a
 * listing is public only after an admin approves it while it is waiting for
 * review. Anything not listed is illegal.
 *
 * PENDING_REVIEW → PUBLISHED (approve) | REJECTED (reject).
 * A REJECTED listing returns to review only when the vendor resubmits it.
 */
const MODERATION: Record<
  ModerationAction,
  { from: ListingStatus; to: ListingStatus; audit: string }
> = {
  approve: {
    from: "PENDING_REVIEW",
    to: "PUBLISHED",
    audit: "listing.approved",
  },
  reject: {
    from: "PENDING_REVIEW",
    to: "REJECTED",
    audit: "listing.rejected",
  },
}

export function moderationAuditAction(action: ModerationAction): string {
  return MODERATION[action].audit
}

/** The status `action` leads to, or a ConflictError when it is not allowed. */
export function nextModerationStatus(
  current: ListingStatus,
  action: ModerationAction
): ListingStatus {
  const rule = MODERATION[action]

  if (current !== rule.from) {
    throw new ConflictError(
      current === "PUBLISHED"
        ? "This listing is already published."
        : "Only a listing waiting for review can be moderated.",
      { details: { reason: "NOT_MODERATABLE", status: current } }
    )
  }

  return rule.to
}
