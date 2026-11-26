import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SurfaceShell } from "@/components/surface-shell"
import { ListingStatusBadge } from "@/components/vendor/listing-status-badge"
import { buttonVariants } from "@/components/ui/button"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { getVendorContext, listVendorListings } from "@/lib/services/listing"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Listings" }

export default async function VendorListingsPage() {
  await enforceSurface("vendor", "/vendor/listings")

  const context = await getVendorContext()

  if (!context) notFound()

  const approved = context.vendor.status === "APPROVED"
  const listings = approved
    ? await listVendorListings({ vendorId: context.vendor.id })
    : []

  return (
    <SurfaceShell eyebrow="Vendor" title="Listings">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{context.vendor.name}</p>

        {!approved ? (
          <p data-testid="listings-not-approved" className="text-sm">
            You can add listings once your vendor account has been approved.
          </p>
        ) : (
          <>
            <Link
              href="/vendor/listings/new"
              className={cn(
                buttonVariants(),
                "h-10 rounded-xl bg-vml-red px-5 text-white hover:bg-vml-red/90"
              )}
            >
              New listing
            </Link>

            {listings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have no listings yet.
              </p>
            ) : (
              <ul
                data-testid="listing-list"
                className="divide-y rounded-2xl border"
              >
                {listings.map((listing) => (
                  <li
                    key={listing.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <Link
                      href={`/vendor/listings/${listing.id}`}
                      className="font-semibold text-vml-ink underline"
                    >
                      {listing.title}
                    </Link>
                    <ListingStatusBadge status={listing.status} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </SurfaceShell>
  )
}
