import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SurfaceShell } from "@/components/surface-shell"
import { ImageUploader } from "@/components/vendor/image-uploader"
import { ListingForm } from "@/components/vendor/listing-form"
import { ListingStatusBadge } from "@/components/vendor/listing-status-badge"
import { ListingSubmit } from "@/components/vendor/listing-submit"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { ForbiddenError } from "@/lib/errors"
import { canVendorEdit } from "@/lib/listings/transitions"
import { LISTING_STATUS_HELP } from "@/lib/listings/presentation"
import {
  getVendorContext,
  getVendorListing,
  listCategoryOptions,
} from "@/lib/services/listing"
import { listListingImages } from "@/lib/services/listing-images"
import {
  confirmImageUploadAction,
  removeImageAction,
  reorderImagesAction,
  requestImageUploadAction,
  submitListingAction,
  updateListingAction,
} from "../actions"

export const metadata: Metadata = { title: "Edit listing" }

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  await enforceSurface("vendor", `/vendor/listings/${id}`)

  // Not yours and not there look the same: a 404.
  const listing = await getVendorListing({ id }).catch((error: unknown) => {
    if (error instanceof ForbiddenError) notFound()

    throw error
  })
  const [context, categories, images] = await Promise.all([
    getVendorContext({ vendorId: listing.vendorId }),
    listCategoryOptions(),
    listListingImages({ listingId: id }),
  ])
  const approved = context?.vendor.status === "APPROVED"
  const editable = approved && canVendorEdit(listing.status)
  const canSubmit =
    approved && (listing.status === "DRAFT" || listing.status === "REJECTED")

  return (
    <SurfaceShell eyebrow="Vendor" title={listing.title}>
      <div className="max-w-3xl space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <ListingStatusBadge status={listing.status} />
            <Link href="/vendor/listings" className="text-sm underline">
              All listings
            </Link>
          </div>
          <p
            data-testid="status-help"
            className="text-sm text-muted-foreground"
          >
            {LISTING_STATUS_HELP[listing.status]}
          </p>
        </div>

        {editable ? (
          <ListingForm
            action={updateListingAction}
            categories={categories}
            submitLabel="Save changes"
            initial={listing}
          />
        ) : (
          <dl className="space-y-1 text-sm">
            <dt className="font-medium">Description</dt>
            <dd className="text-muted-foreground">
              {listing.description ?? "None"}
            </dd>
          </dl>
        )}

        <ImageUploader
          listingId={listing.id}
          editable={editable}
          images={images.map((i) => ({ id: i.id, url: i.url }))}
          actions={{
            request: requestImageUploadAction,
            confirm: confirmImageUploadAction,
            remove: removeImageAction,
            reorder: reorderImagesAction,
          }}
        />

        {canSubmit ? (
          <ListingSubmit id={listing.id} action={submitListingAction} />
        ) : null}
      </div>
    </SurfaceShell>
  )
}
