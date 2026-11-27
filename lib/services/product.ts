import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError } from "@/lib/errors"
import { canVendorEdit } from "@/lib/listings/transitions"
import { parseProductPolicy, type ProductPolicy } from "@/lib/products/policy"
import {
  assertVendorApproved,
  listingContext,
  loadOwnedListing,
  type ListingDeps,
} from "@/lib/services/listing"
import {
  createProductSchema,
  deleteProductSchema,
  listProductsSchema,
  updateProductSchema,
} from "@/lib/validation/product"

export type ProductRecord = {
  id: string
  listingId: string
  name: string
  basePrice: number
  currency: string
  active: boolean
  policy: ProductPolicy
}

export type ProductDeps = Omit<ListingDeps, "db"> & {
  db?: Pick<
    PrismaClient,
    | "listing"
    | "vendor"
    | "category"
    | "vendorMember"
    | "product"
    | "bookingItem"
  >
}

const SELECT = {
  id: true,
  listingId: true,
  name: true,
  basePrice: true,
  currency: true,
  active: true,
  policy: true,
} as const

type Row = {
  id: string
  listingId: string
  name: string
  basePrice: number
  currency: string
  active: boolean
  policy: unknown
}

const toRecord = (row: Row): ProductRecord => ({
  ...row,
  policy: parseProductPolicy(row.policy),
})

async function setup(deps: ProductDeps) {
  const ctx = await listingContext(deps as ListingDeps)

  return { ...ctx, db: (deps.db ?? ctx.db) as NonNullable<ProductDeps["db"]> }
}

/** The caller's own vendor's product, or a refusal that hides which it was. */
async function loadOwnedProduct(
  id: string,
  ctx: Awaited<ReturnType<typeof setup>>
) {
  const row = await ctx.db.product.findUnique({
    where: { id },
    select: SELECT,
  })

  // Same answer for "no such product" and "someone else's".
  if (!row) throw new ForbiddenError()

  const listing = await loadOwnedListing(row.listingId, ctx)

  return { product: row, listing }
}

function editableOrThrow(status: Parameters<typeof canVendorEdit>[0]) {
  if (!canVendorEdit(status)) {
    throw new ConflictError(
      status === "PENDING_REVIEW"
        ? "This listing is under review and its products cannot change until it has been decided."
        : "This listing can no longer be edited.",
      { details: { reason: "NOT_EDITABLE", status } }
    )
  }
}

/**
 * Adds a product (a bookable thing with a price and a policy) to the caller's
 * own listing. Currency is always GBP and the kind timed-slot; both come from
 * the server. The price is integer pence and the policy is checked against the
 * platform bounds (TC-E5S2-04).
 */
export async function createProduct(
  input: unknown,
  deps: ProductDeps = {}
): Promise<ProductRecord> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = createProductSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const data = parsed.data
  const listing = await loadOwnedListing(data.listingId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  return toRecord(
    await ctx.db.product.create({
      data: {
        listingId: listing.id,
        name: data.name,
        kind: "TIMED_SLOT",
        basePrice: data.basePrice,
        currency: "GBP",
        policy: data.policy,
        active: true,
      },
      select: SELECT,
    })
  )
}

/** Edits a product's name, price, policy or on/off switch. */
export async function updateProduct(
  input: unknown,
  deps: ProductDeps = {}
): Promise<ProductRecord> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = updateProductSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id, ...changes } = parsed.data
  const { product, listing } = await loadOwnedProduct(id, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  const current = toRecord(product)
  const next = {
    name: changes.name ?? current.name,
    basePrice: changes.basePrice ?? current.basePrice,
    active: changes.active ?? current.active,
    policy: changes.policy ?? current.policy,
  }
  const same =
    next.name === current.name &&
    next.basePrice === current.basePrice &&
    next.active === current.active &&
    next.policy.cancelWindowHours === current.policy.cancelWindowHours &&
    next.policy.bookingCutoffHours === current.policy.bookingCutoffHours

  if (same) return current

  return toRecord(
    await ctx.db.product.update({
      where: { id },
      data: next,
      select: SELECT,
    })
  )
}

/**
 * Deletes a product that has never been booked. A booked product is kept
 * (bookings and refunds refer to it): the vendor switches it off instead.
 */
export async function deleteProduct(
  input: unknown,
  deps: ProductDeps = {}
): Promise<{ id: string }> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = deleteProductSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { product, listing } = await loadOwnedProduct(parsed.data.id, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  const bookings = await ctx.db.bookingItem.count({
    where: { productId: product.id },
  })

  if (bookings > 0) {
    throw new ConflictError(
      "This product has bookings, so it cannot be deleted. Switch it off instead.",
      { details: { reason: "HAS_BOOKINGS", bookings } }
    )
  }

  try {
    await ctx.db.product.delete({ where: { id: product.id } })
  } catch {
    // A booking appeared between the count and the delete (the foreign key
    // refuses it): report the same thing.
    throw new ConflictError(
      "This product has bookings, so it cannot be deleted. Switch it off instead.",
      { details: { reason: "HAS_BOOKINGS" } }
    )
  }

  return { id: product.id }
}

/** A listing's products, oldest first. Caller must belong to its vendor. */
export async function listListingProducts(
  input: unknown,
  deps: ProductDeps = {}
): Promise<ProductRecord[]> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = listProductsSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const listing = await loadOwnedListing(parsed.data.listingId, ctx)
  const rows = await ctx.db.product.findMany({
    where: { listingId: listing.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SELECT,
  })

  return rows.map(toRecord)
}
