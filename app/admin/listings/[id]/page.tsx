import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ListingModerationActions } from "@/components/admin/listing-moderation-actions"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { NotFoundError } from "@/lib/errors"
import { LISTING_STATUS_LABEL } from "@/lib/listings/presentation"
import { moderationAuditAction } from "@/lib/listings/moderation"
import { getListingForReview } from "@/lib/services/listing-admin"
import { moderateListingAction } from "./actions"

export const metadata: Metadata = { title: "Review listing" }

const when = (date: Date) =>
  date.toLocaleString("en-GB", { timeZone: "Europe/London" })

const ACTION_LABEL: Record<string, string> = {
  [moderationAuditAction("approve")]: "Approved and published",
  [moderationAuditAction("reject")]: "Rejected",
}

function reasonOf(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null
  const reason = (meta as { reason?: unknown }).reason

  return typeof reason === "string" ? reason : null
}

export default async function AdminListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  await enforceSurface("admin", `/admin/listings/${id}`)

  const listing = await getListingForReview(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()

    throw error
  })

  return (
    <SurfaceShell eyebrow="Admin · Listings" title={listing.title}>
      <Link
        href="/admin/listings"
        className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
      >
        ← Listings to review
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section
            aria-labelledby="details"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="details" className="text-lg font-bold text-vml-ink">
              Details
            </h2>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field
                label="Status"
                value={LISTING_STATUS_LABEL[listing.status]}
              />
              <Field label="Category" value={listing.categoryName} />
              <Field label="Vendor" value={listing.vendor.name} />
              <Field label="Address" value={listing.address ?? "—"} />
              <Field
                label="Location"
                value={
                  listing.lat !== null && listing.lng !== null
                    ? `${listing.lat}, ${listing.lng}`
                    : "—"
                }
              />
              <Field label="Pictures" value={String(listing.imageCount)} />
              <Field label="Products" value={String(listing.productCount)} />
              <Field label="Last changed" value={when(listing.waitingSince)} />
            </dl>
            {listing.description ? (
              <p className="mt-4 text-sm whitespace-pre-line text-vml-ink">
                {listing.description}
              </p>
            ) : null}
          </section>

          <section
            aria-labelledby="history"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="history" className="text-lg font-bold text-vml-ink">
              History
            </h2>
            {listing.history.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No decisions recorded yet.
              </p>
            ) : (
              <ol className="mt-3 space-y-3 text-sm">
                {listing.history.map((entry) => {
                  const reason = reasonOf(entry.meta)

                  return (
                    <li key={entry.id}>
                      <span className="font-medium text-vml-ink">
                        {ACTION_LABEL[entry.action] ?? entry.action}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {when(entry.at)}
                        {entry.actor ? ` · ${entry.actor.name}` : ""}
                      </span>
                      {reason ? (
                        <p className="mt-1 text-muted-foreground">
                          Reason: {reason}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>

        <section
          aria-labelledby="decision"
          className="h-fit rounded-2xl border border-border bg-card p-5"
        >
          <h2 id="decision" className="text-lg font-bold text-vml-ink">
            Decision
          </h2>
          {listing.status === "PENDING_REVIEW" ? (
            <div className="mt-4">
              <ListingModerationActions
                listingId={listing.id}
                blockReason={listing.vendor.blockReason}
                action={moderateListingAction}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              This listing is{" "}
              {LISTING_STATUS_LABEL[listing.status].toLowerCase()}; there is no
              decision to make.
            </p>
          )}
        </section>
      </div>
    </SurfaceShell>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-vml-ink">{value}</dd>
    </div>
  )
}
