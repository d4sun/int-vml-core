import type { ListingStatus, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import {
  prismaMembershipStore,
  requestSessionSource,
  requireUser,
  requireVendorMember,
  type MembershipStore,
  type SessionSource,
} from "@/lib/auth/guards"
import { categorySlug } from "@/lib/categories/slug"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  canVendorEdit,
  isMajorEdit,
  nextListingStatus,
} from "@/lib/listings/transitions"
import { randomSlugSuffix } from "@/lib/vendors/slug"
import {
  createListingSchema,
  submitListingSchema,
  updateListingSchema,
} from "@/lib/validation/listing"

export type ListingRecord = {
  id: string
  vendorId: string
  categoryId: string
  title: string
  slug: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  status: ListingStatus
}

export type ListingDeps = {
  session?: SessionSource
  memberships?: MembershipStore
  db?: Pick<PrismaClient, "listing" | "vendor" | "category" | "vendorMember">
  /** Overridable so tests get stable slugs. */
  suffix?: () => string
}

const SELECT = {
  id: true,
  vendorId: true,
  categoryId: true,
  title: true,
  slug: true,
  description: true,
  address: true,
  lat: true,
  lng: true,
  status: true,
} as const

/** Owners and staff both manage listings; the vendor's team is E7. */
const ROLES = ["OWNER", "STAFF"] as const

export async function listingContext(deps: ListingDeps) {
  const session = deps.session ?? requestSessionSource
  const db = deps.db ?? (await import("@/lib/prisma")).prisma

  return {
    session,
    db,
    memberships: deps.memberships ?? prismaMembershipStore(db),
  }
}

/** Only an APPROVED vendor creates, edits or submits listings. */
export async function assertVendorApproved(
  db: Pick<PrismaClient, "vendor">,
  vendorId: string
): Promise<void> {
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { status: true },
  })

  if (vendor?.status !== "APPROVED") {
    throw new ForbiddenError(
      "Listings can be managed once your vendor account is approved",
      { details: { reason: "NOT_APPROVED" } }
    )
  }
}

async function assertCategory(
  db: Pick<PrismaClient, "category">,
  categoryId: string
): Promise<void> {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  })

  if (!category) {
    throw new ValidationError("Please check the highlighted fields.", {
      categoryId: ["Choose one of the listed categories"],
    })
  }
}

/**
 * Loads a listing for a caller who must belong to its vendor (CR-2). A listing
 * that does not exist and one that belongs to someone else are the same
 * ForbiddenError, so this cannot be used to discover other vendors' listings.
 */
export async function loadOwnedListing(
  id: string,
  ctx: Awaited<ReturnType<typeof listingContext>>
): Promise<ListingRecord> {
  const listing = await ctx.db.listing.findUnique({
    where: { id },
    select: SELECT,
  })

  if (!listing) {
    // Still prove who is asking, so the answer does not depend on the id.
    throw new ForbiddenError()
  }

  await requireVendorMember(listing.vendorId, ROLES, {
    session: ctx.session,
    memberships: ctx.memberships,
  })

  return listing
}

/** A new listing starts as a DRAFT owned by the caller's vendor. */
export async function createListing(
  input: unknown,
  deps: ListingDeps = {}
): Promise<ListingRecord> {
  const ctx = await listingContext(deps)

  await requireUser(ctx.session)

  const parsed = createListingSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const data = parsed.data

  await requireVendorMember(data.vendorId, ROLES, {
    session: ctx.session,
    memberships: ctx.memberships,
  })
  await assertVendorApproved(ctx.db, data.vendorId)
  await assertCategory(ctx.db, data.categoryId)

  const suffix = deps.suffix ?? randomSlugSuffix

  return ctx.db.listing.create({
    data: {
      vendorId: data.vendorId,
      categoryId: data.categoryId,
      title: data.title,
      slug: `${categorySlug(data.title) || "listing"}-${suffix()}`,
      description: data.description ?? null,
      address: data.address ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      status: "DRAFT",
    },
    select: SELECT,
  })
}

/**
 * Edits a listing's content. The status is never accepted from the caller:
 * editing a PUBLISHED listing's core details sends it back to review, and
 * nothing a vendor does makes a listing PUBLISHED. A listing under review is
 * frozen. The write is guarded by the status that was read, so a concurrent
 * change (an admin's decision, a second edit) makes this one fail with a
 * Conflict instead of overwriting it.
 */
export async function updateListing(
  input: unknown,
  deps: ListingDeps = {}
): Promise<ListingRecord> {
  const ctx = await listingContext(deps)

  await requireUser(ctx.session)

  const parsed = updateListingSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id, ...changes } = parsed.data
  const current = await loadOwnedListing(id, ctx)

  await assertVendorApproved(ctx.db, current.vendorId)

  if (!canVendorEdit(current.status)) {
    throw new ConflictError(
      current.status === "PENDING_REVIEW"
        ? "This listing is under review and cannot be edited until it has been decided."
        : "This listing can no longer be edited.",
      { details: { reason: "NOT_EDITABLE", status: current.status } }
    )
  }

  if (changes.categoryId !== undefined) {
    await assertCategory(ctx.db, changes.categoryId)
  }

  const next = {
    title: changes.title ?? current.title,
    categoryId: changes.categoryId ?? current.categoryId,
    description:
      changes.description === undefined
        ? current.description
        : changes.description,
    address: changes.address === undefined ? current.address : changes.address,
    lat: changes.lat === undefined ? current.lat : changes.lat,
    lng: changes.lng === undefined ? current.lng : changes.lng,
  }

  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (field) => next[field] !== current[field]
  )

  // Nothing actually differs: no write, no status change.
  if (changed.length === 0) return current

  const status =
    isMajorEdit(changed) && current.status === "PUBLISHED"
      ? nextListingStatus(current.status, "majorEdit")!
      : current.status

  const { count } = await ctx.db.listing.updateMany({
    where: { id, status: current.status },
    data: { ...next, status },
  })

  if (count === 0) {
    throw new ConflictError(
      "This listing was just changed by someone else. Refresh and try again."
    )
  }

  return { ...current, ...next, status }
}

/** Sends a DRAFT or REJECTED listing to review. */
export async function submitListing(
  input: unknown,
  deps: ListingDeps = {}
): Promise<ListingRecord> {
  const ctx = await listingContext(deps)

  await requireUser(ctx.session)

  const parsed = submitListingSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const current = await loadOwnedListing(parsed.data.id, ctx)

  await assertVendorApproved(ctx.db, current.vendorId)

  const status = nextListingStatus(current.status, "submit")

  if (!status) {
    throw new ConflictError(
      current.status === "PENDING_REVIEW"
        ? "This listing is already waiting for review."
        : "Only a draft or a rejected listing can be submitted.",
      { details: { reason: "NOT_SUBMITTABLE", status: current.status } }
    )
  }

  const { count } = await ctx.db.listing.updateMany({
    where: { id: current.id, status: current.status },
    data: { status },
  })

  if (count === 0) {
    throw new ConflictError(
      "This listing was just changed by someone else. Refresh and try again."
    )
  }

  return { ...current, status }
}

/** The caller's own vendor's listings, newest first (CR-2). */
export async function listVendorListings(
  input: { vendorId: string },
  deps: ListingDeps = {}
): Promise<ListingRecord[]> {
  const ctx = await listingContext(deps)

  await requireVendorMember(input.vendorId, ROLES, {
    session: ctx.session,
    memberships: ctx.memberships,
  })

  return ctx.db.listing.findMany({
    where: { vendorId: input.vendorId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: SELECT,
  })
}

/** One of the caller's own vendor's listings, for the edit page. */
export async function getVendorListing(
  input: { id: string },
  deps: ListingDeps = {}
): Promise<ListingRecord> {
  const ctx = await listingContext(deps)

  await requireUser(ctx.session)

  return loadOwnedListing(input.id, ctx)
}
