import type { ListingStatus, Prisma, PrismaClient } from "@prisma/client"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { sellBlockReason, type SellBlockReason } from "@/lib/catalog/visibility"
import { NotFoundError } from "@/lib/errors"

/** The review queue shows this many rows; `truncated` says when there are more. */
export const ADMIN_LISTING_QUEUE_LIMIT = 100
const HISTORY_LIMIT = 50

export type ReviewQueueRow = {
  id: string
  title: string
  slug: string
  categoryName: string
  waitingSince: Date
  vendor: {
    id: string
    name: string
    /** Why approval would be refused now, or null when it would succeed. */
    blockReason: SellBlockReason | null
  }
}

export type ReviewQueue = {
  listings: ReviewQueueRow[]
  truncated: boolean
}

export type ListingForReview = {
  id: string
  title: string
  status: ListingStatus
  slug: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  categoryName: string
  imageCount: number
  productCount: number
  waitingSince: Date
  vendor: {
    id: string
    name: string
    blockReason: SellBlockReason | null
  }
  history: Array<{
    id: string
    action: string
    at: Date
    meta: Prisma.JsonValue
    actor: { name: string; email: string } | null
  }>
}

export type ListingAdminDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "listing" | "auditLog">
}

async function resolveDb(deps: ListingAdminDeps) {
  return deps.db ?? (await import("@/lib/prisma")).prisma
}

/**
 * Listings waiting for an admin decision, the longest-waiting first, with each
 * vendor's eligibility so the admin sees before pressing approve why it would
 * be refused. Admin only.
 */
export async function listPendingListings(
  deps: ListingAdminDeps = {}
): Promise<ReviewQueue> {
  await requireAdmin(deps.session)

  const db = await resolveDb(deps)

  const rows = await db.listing.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { updatedAt: "asc" },
    take: ADMIN_LISTING_QUEUE_LIMIT + 1,
    select: {
      id: true,
      title: true,
      slug: true,
      updatedAt: true,
      category: { select: { name: true } },
      vendor: {
        select: {
          id: true,
          name: true,
          status: true,
          stripeOnboardingComplete: true,
        },
      },
    },
  })

  const listings = rows.slice(0, ADMIN_LISTING_QUEUE_LIMIT).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    categoryName: row.category.name,
    waitingSince: row.updatedAt,
    vendor: {
      id: row.vendor.id,
      name: row.vendor.name,
      blockReason: sellBlockReason(row.vendor),
    },
  }))

  return {
    listings,
    truncated: rows.length > ADMIN_LISTING_QUEUE_LIMIT,
  }
}

/**
 * One listing for review: its details, the vendor's eligibility and the
 * decisions made so far (with reasons). Admin only; a missing listing is a
 * NotFoundError.
 */
export async function getListingForReview(
  id: string,
  deps: ListingAdminDeps = {}
): Promise<ListingForReview> {
  await requireAdmin(deps.session)

  const db = await resolveDb(deps)

  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      slug: true,
      description: true,
      address: true,
      lat: true,
      lng: true,
      updatedAt: true,
      category: { select: { name: true } },
      _count: { select: { images: true, products: true } },
      vendor: {
        select: {
          id: true,
          name: true,
          status: true,
          stripeOnboardingComplete: true,
        },
      },
    },
  })

  if (!listing) throw new NotFoundError("Listing not found")

  const history = await db.auditLog.findMany({
    where: { entityType: "Listing", entityId: listing.id },
    orderBy: { at: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      action: true,
      at: true,
      meta: true,
      actor: { select: { name: true, email: true } },
    },
  })

  return {
    id: listing.id,
    title: listing.title,
    status: listing.status,
    slug: listing.slug,
    description: listing.description,
    address: listing.address,
    lat: listing.lat,
    lng: listing.lng,
    categoryName: listing.category.name,
    imageCount: listing._count.images,
    productCount: listing._count.products,
    waitingSince: listing.updatedAt,
    vendor: {
      id: listing.vendor.id,
      name: listing.vendor.name,
      blockReason: sellBlockReason(listing.vendor),
    },
    history,
  }
}
