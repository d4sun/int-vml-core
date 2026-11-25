import { randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser } from "@/lib/auth/guards"
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors"
import { canVendorEdit, nextListingStatus } from "@/lib/listings/transitions"
import {
  assertVendorApproved,
  listingContext,
  loadOwnedListing,
  type ListingDeps,
} from "@/lib/services/listing"
import type { ImageStorage, UploadTarget } from "@/lib/storage/adapter"
import {
  IMAGE_TYPES,
  MAX_IMAGES_PER_LISTING,
  MAX_IMAGE_BYTES,
  imageKey,
  isImageContentType,
  isKeyOfListing,
} from "@/lib/storage/limits"
import {
  confirmImageUploadSchema,
  listImagesSchema,
  removeImageSchema,
  reorderImagesSchema,
  requestImageUploadSchema,
} from "@/lib/validation/listing-image"

export type ListingImageRecord = {
  id: string
  listingId: string
  key: string
  position: number
  contentType: string
  sizeBytes: number
}

export type ListingImageView = ListingImageRecord & { url: string }

export type ImageDeps = Omit<ListingDeps, "db"> & {
  db?: Pick<
    PrismaClient,
    | "listing"
    | "vendor"
    | "category"
    | "vendorMember"
    | "listingImage"
    | "$transaction"
  >
  storage?: ImageStorage
  newId?: () => string
}

const SELECT = {
  id: true,
  listingId: true,
  key: true,
  position: true,
  contentType: true,
  sizeBytes: true,
} as const

async function setup(deps: ImageDeps) {
  const ctx = await listingContext(deps as ListingDeps)
  const storage =
    deps.storage ?? (await import("@/lib/storage")).getImageStorage()

  return {
    ...ctx,
    db: (deps.db ?? ctx.db) as NonNullable<ImageDeps["db"]>,
    storage,
  }
}

/** Serialises changes to one listing's pictures for the transaction. */
async function lockListing(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${id} FOR UPDATE`
}

function editableOrThrow(status: Parameters<typeof canVendorEdit>[0]) {
  if (!canVendorEdit(status)) {
    throw new ConflictError(
      status === "PENDING_REVIEW"
        ? "This listing is under review and its pictures cannot change until it has been decided."
        : "This listing can no longer be edited.",
      { details: { reason: "NOT_EDITABLE", status } }
    )
  }
}

/**
 * Step 1 of adding a picture: checks the caller may edit this listing and
 * that it has room, then hands back a short-lived upload target for a key the
 * server chose. Nothing is recorded yet; the picture exists only once it is
 * confirmed.
 */
export async function requestImageUpload(
  input: unknown,
  deps: ImageDeps = {}
): Promise<{ key: string; upload: UploadTarget }> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = requestImageUploadSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const listing = await loadOwnedListing(parsed.data.listingId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  const count = await ctx.db.listingImage.count({
    where: { listingId: listing.id },
  })

  if (count >= MAX_IMAGES_PER_LISTING) {
    throw new ConflictError(
      `A listing can have at most ${MAX_IMAGES_PER_LISTING} pictures.`,
      { details: { reason: "TOO_MANY_IMAGES" } }
    )
  }

  const contentType = parsed.data.contentType

  if (!isImageContentType(contentType)) {
    throw new ValidationError("Please check the highlighted fields.", {
      contentType: ["Upload a JPEG, PNG or WebP picture"],
    })
  }

  const key = imageKey(listing.id, (deps.newId ?? randomUUID)(), contentType)
  const upload = await ctx.storage.createUploadTarget({ key, contentType })

  return { key, upload }
}

/**
 * Step 2: after the browser has uploaded, the server looks at what is really
 * in storage (size and type, never the client's word) and only then records
 * the picture, at the end of the gallery. Adding a picture to a PUBLISHED
 * listing sends it back to review. Confirming the same upload twice returns
 * the same picture.
 */
export async function confirmImageUpload(
  input: unknown,
  deps: ImageDeps = {}
): Promise<ListingImageRecord> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = confirmImageUploadSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { listingId, key } = parsed.data
  const listing = await loadOwnedListing(listingId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  // The key must be one this server issued for this listing.
  if (!isKeyOfListing(key, listing.id)) {
    throw new ValidationError("Please check the highlighted fields.", {
      key: ["That upload does not belong to this listing"],
    })
  }

  const stored = await ctx.storage.head(key)

  if (!stored) {
    throw new ConflictError("The picture was not uploaded. Please try again.", {
      details: { reason: "NOT_UPLOADED" },
    })
  }

  const extension = key.slice(key.lastIndexOf(".") + 1)

  if (
    !isImageContentType(stored.contentType) ||
    IMAGE_TYPES[stored.contentType] !== extension
  ) {
    await ctx.storage.delete(key)
    throw new ValidationError("Please check the highlighted fields.", {
      key: ["Upload a JPEG, PNG or WebP picture"],
    })
  }

  if (stored.size < 1 || stored.size > MAX_IMAGE_BYTES) {
    await ctx.storage.delete(key)
    throw new ValidationError("Please check the highlighted fields.", {
      key: ["Pictures can be at most 5 MB"],
    })
  }

  const contentType = stored.contentType

  const result = await ctx.db.$transaction(async (tx) => {
    await lockListing(tx, listing.id)

    const current = await tx.listing.findUnique({
      where: { id: listing.id },
      select: { status: true },
    })

    if (!current) throw new NotFoundError("Listing not found")

    editableOrThrow(current.status)

    const existing = await tx.listingImage.findUnique({
      where: { key },
      select: SELECT,
    })

    if (existing) return { image: existing, rejectedForRoom: false }

    const count = await tx.listingImage.count({
      where: { listingId: listing.id },
    })

    if (count >= MAX_IMAGES_PER_LISTING) {
      return { image: null, rejectedForRoom: true }
    }

    const image = await tx.listingImage.create({
      data: {
        listingId: listing.id,
        key,
        position: count,
        contentType,
        sizeBytes: stored.size,
      },
      select: SELECT,
    })

    // A new picture on a live listing needs a fresh review.
    const next = nextListingStatus(current.status, "majorEdit")

    if (next) {
      await tx.listing.update({
        where: { id: listing.id },
        data: { status: next },
      })
    }

    return { image, rejectedForRoom: false }
  })

  if (result.rejectedForRoom || !result.image) {
    await ctx.storage.delete(key)

    throw new ConflictError(
      `A listing can have at most ${MAX_IMAGES_PER_LISTING} pictures.`,
      { details: { reason: "TOO_MANY_IMAGES" } }
    )
  }

  return result.image
}

/** Removes a picture and closes the gap in the order. Needs no review. */
export async function removeImage(
  input: unknown,
  deps: ImageDeps = {}
): Promise<{ id: string }> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = removeImageSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const listing = await loadOwnedListing(parsed.data.listingId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)

  const removed = await ctx.db.$transaction(async (tx) => {
    await lockListing(tx, listing.id)

    const current = await tx.listing.findUnique({
      where: { id: listing.id },
      select: { status: true },
    })

    if (!current) throw new NotFoundError("Listing not found")

    editableOrThrow(current.status)

    // Scoped to this listing, so a picture id from another listing is "not found".
    const image = await tx.listingImage.findFirst({
      where: { id: parsed.data.imageId, listingId: listing.id },
      select: SELECT,
    })

    if (!image) throw new NotFoundError("Picture not found")

    await tx.listingImage.delete({ where: { id: image.id } })
    await tx.listingImage.updateMany({
      where: { listingId: listing.id, position: { gt: image.position } },
      data: { position: { decrement: 1 } },
    })

    return image
  })

  // After the commit: a failed delete leaves an unreferenced object, never a
  // broken gallery.
  await ctx.storage.delete(removed.key).catch(() => undefined)

  return { id: removed.id }
}

/**
 * Sets the gallery order. `imageIds` must be exactly the listing's current
 * pictures, each once, so a stale or partial list cannot drop or invent one.
 * Needs no review.
 */
export async function reorderImages(
  input: unknown,
  deps: ImageDeps = {}
): Promise<ListingImageRecord[]> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = reorderImagesSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const listing = await loadOwnedListing(parsed.data.listingId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)

  return ctx.db.$transaction(async (tx) => {
    await lockListing(tx, listing.id)

    const current = await tx.listing.findUnique({
      where: { id: listing.id },
      select: { status: true },
    })

    if (!current) throw new NotFoundError("Listing not found")

    editableOrThrow(current.status)

    const images = await tx.listingImage.findMany({
      where: { listingId: listing.id },
      select: SELECT,
    })
    const wanted = parsed.data.imageIds
    const sameSet =
      wanted.length === images.length &&
      new Set(wanted).size === wanted.length &&
      images.every((image) => wanted.includes(image.id))

    if (!sameSet) {
      throw new ValidationError("Please check the highlighted fields.", {
        imageIds: [
          "The order must list each of the listing's pictures exactly once. Refresh and try again.",
        ],
      })
    }

    for (const [position, id] of wanted.entries()) {
      await tx.listingImage.update({ where: { id }, data: { position } })
    }

    return tx.listingImage.findMany({
      where: { listingId: listing.id },
      orderBy: { position: "asc" },
      select: SELECT,
    })
  })
}

/** A listing's pictures in order, with the URL each is served from. */
export async function listListingImages(
  input: unknown,
  deps: ImageDeps = {}
): Promise<ListingImageView[]> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = listImagesSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const listing = await loadOwnedListing(parsed.data.listingId, ctx)
  const images = await ctx.db.listingImage.findMany({
    where: { listingId: listing.id },
    orderBy: { position: "asc" },
    select: SELECT,
  })

  return images.map((image) => ({
    ...image,
    url: ctx.storage.publicUrl(image.key),
  }))
}
