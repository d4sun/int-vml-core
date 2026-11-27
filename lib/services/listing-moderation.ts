import type { ListingStatus, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { assertVendorCanSell } from "@/lib/catalog/visibility"
import { ConflictError, NotFoundError } from "@/lib/errors"
import {
  moderationAuditAction,
  nextModerationStatus,
} from "@/lib/listings/moderation"
import { audit } from "@/lib/services/audit"
import { listingModerationSchema } from "@/lib/validation/listing-moderation"

export type ModeratedListing = {
  id: string
  vendorId: string
  status: ListingStatus
}

export type ListingModerationDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  /** Overridable so tests can prove the status change and audit row are atomic. */
  record?: typeof audit.record
}

/**
 * Approves or rejects a listing waiting for review (admin only).
 *
 * This is the only path to PUBLISHED. Approval also requires the vendor to be
 * allowed to sell (APPROVED and payout-ready, `assertVendorCanSell`), checked
 * inside the same transaction as the status change, so a suspended or
 * not-onboarded vendor's listing cannot be made public.
 *
 * The status change and its audit row are one transaction. The update is
 * guarded by the status that was read, so two admins acting at once cannot
 * both succeed. A rejection reason is kept in the audit row, where the admin
 * can see it later.
 */
export async function moderateListing(
  input: unknown,
  deps: ListingModerationDeps = {}
): Promise<ModeratedListing> {
  const actor = await requireAdmin(deps.session)

  const parsed = listingModerationSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { listingId, action, reason } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { id: true, vendorId: true, status: true },
    })

    if (!listing) throw new NotFoundError("Listing not found")

    const next = nextModerationStatus(listing.status, action)

    if (action === "approve") {
      await assertVendorCanSell(listing.vendorId, tx)
    }

    const { count } = await tx.listing.updateMany({
      where: { id: listing.id, status: listing.status },
      data: { status: next },
    })

    if (count === 0) {
      throw new ConflictError(
        "This listing was just changed by someone else. Refresh and try again."
      )
    }

    await record(tx, {
      actorId: actor.id,
      action: moderationAuditAction(action),
      entityType: "Listing",
      entityId: listing.id,
      meta: {
        vendorId: listing.vendorId,
        from: listing.status,
        to: next,
        ...(reason ? { reason } : {}),
      },
    })

    return { id: listing.id, vendorId: listing.vendorId, status: next }
  })
}
