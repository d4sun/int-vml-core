import type { Metadata } from "next"
import Link from "next/link"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { SELL_BLOCK_LABEL } from "@/lib/listings/presentation"
import { listPendingListings } from "@/lib/services/listing-admin"

export const metadata: Metadata = { title: "Listings to review" }

const since = (date: Date) =>
  date.toLocaleString("en-GB", { timeZone: "Europe/London" })

export default async function AdminListingsPage() {
  await enforceSurface("admin", "/admin/listings")

  const queue = await listPendingListings()

  return (
    <SurfaceShell eyebrow="Admin · Listings" title="Listings to review">
      <Link
        href="/admin"
        className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
      >
        ← Admin home
      </Link>

      <section
        aria-labelledby="queue"
        className="mt-6 rounded-2xl border border-border bg-card p-5"
      >
        <h2 id="queue" className="text-lg font-bold text-vml-ink">
          Waiting for a decision
        </h2>

        {queue.listings.length === 0 ? (
          <p
            data-testid="listing-queue-empty"
            className="mt-3 text-sm text-muted-foreground"
          >
            Nothing is waiting for review.
          </p>
        ) : (
          <ul
            data-testid="listing-queue"
            className="mt-3 divide-y divide-border text-sm"
          >
            {queue.listings.map((listing) => (
              <li
                key={listing.id}
                data-listing-id={listing.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <Link
                    href={`/admin/listings/${listing.id}`}
                    className="font-semibold text-vml-navy underline-offset-4 hover:underline"
                  >
                    {listing.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {listing.vendor.name} · {listing.categoryName} · waiting
                    since {since(listing.waitingSince)}
                  </p>
                </div>
                {listing.vendor.blockReason ? (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    Cannot approve:{" "}
                    {SELL_BLOCK_LABEL[listing.vendor.blockReason]}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-vml-ink">
                    Vendor ready
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {queue.truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the first {queue.listings.length} listings.
          </p>
        ) : null}
      </section>
    </SurfaceShell>
  )
}
