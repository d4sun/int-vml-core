import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SurfaceShell } from "@/components/surface-shell"
import { ListingForm } from "@/components/vendor/listing-form"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { getVendorContext, listCategoryOptions } from "@/lib/services/listing"
import { createListingAction } from "../actions"

export const metadata: Metadata = { title: "New listing" }

export default async function NewListingPage() {
  await enforceSurface("vendor", "/vendor/listings/new")

  const context = await getVendorContext()

  if (!context) notFound()

  if (context.vendor.status !== "APPROVED") {
    return (
      <SurfaceShell eyebrow="Vendor" title="New listing">
        <p className="text-sm">
          You can add listings once your vendor account has been approved.
        </p>
      </SurfaceShell>
    )
  }

  const categories = await listCategoryOptions()

  return (
    <SurfaceShell eyebrow="Vendor" title="New listing">
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Start with the basics. You can add pictures next, and nothing is shown
          to visitors until you submit it and we approve it.{" "}
          <Link href="/vendor/listings" className="underline">
            Back to listings
          </Link>
        </p>
        <ListingForm
          action={createListingAction}
          categories={categories}
          vendorId={context.vendor.id}
          submitLabel="Create draft"
        />
      </div>
    </SurfaceShell>
  )
}
