import type { Prisma, PrismaClient, VendorStatus } from "@prisma/client"
import { ForbiddenError, NotFoundError } from "@/lib/errors"

/**
 * The single definition of what the public may see: a PUBLISHED listing whose
 * vendor is APPROVED. Search, listing pages, the map and sitemaps must all
 * build their `where` from this, so suspending a vendor hides its listings
 * everywhere at once and no query can forget the vendor condition.
 *
 * Extra filters are combined with AND, never spread over the result, so a
 * caller cannot override `status` or `vendor` by accident.
 *
 * Bookability is stricter (the vendor must also be payout-ready): see
 * `vendorCanSell`.
 */
export function publiclyVisibleListingWhere(
  extra?: Prisma.ListingWhereInput
): Prisma.ListingWhereInput {
  const visible: Prisma.ListingWhereInput = {
    status: "PUBLISHED",
    vendor: { status: "APPROVED" },
  }

  return extra ? { AND: [extra, visible] } : visible
}

export type SellBlockReason = "NOT_APPROVED" | "NOT_ONBOARDED"

type SellableVendor = {
  status: VendorStatus
  stripeOnboardingComplete: boolean
}

/**
 * Why a vendor may not sell yet, or `null` when it may. A vendor can sell,
 * publish and be paid only when it is APPROVED and has finished Stripe
 * onboarding. The reason lets the UI say exactly what is missing.
 */
export function sellBlockReason(
  vendor: SellableVendor
): SellBlockReason | null {
  if (vendor.status !== "APPROVED") return "NOT_APPROVED"
  if (!vendor.stripeOnboardingComplete) return "NOT_ONBOARDED"

  return null
}

export function vendorCanSell(vendor: SellableVendor): boolean {
  return sellBlockReason(vendor) === null
}

const BLOCK_MESSAGE: Record<SellBlockReason, string> = {
  NOT_APPROVED: "This vendor has not been approved to sell",
  NOT_ONBOARDED: "This vendor has not finished payout setup",
}

/**
 * Server-side gate for publishing, bookability and payouts. Throws
 * `NotFoundError` for an unknown vendor and `ForbiddenError` (with the reason
 * in `details`) when the vendor may not sell.
 *
 * Pass a transaction client to check inside the caller's transaction, so the
 * decision and the write it guards see the same vendor row.
 */
export async function assertVendorCanSell(
  vendorId: string,
  db?: Pick<PrismaClient, "vendor">
): Promise<void> {
  const client = db ?? (await import("@/lib/prisma")).prisma

  const vendor = await client.vendor.findUnique({
    where: { id: vendorId },
    select: { status: true, stripeOnboardingComplete: true },
  })

  if (!vendor) throw new NotFoundError("Vendor not found")

  const reason = sellBlockReason(vendor)

  if (reason) {
    throw new ForbiddenError(BLOCK_MESSAGE[reason], { details: { reason } })
  }
}
