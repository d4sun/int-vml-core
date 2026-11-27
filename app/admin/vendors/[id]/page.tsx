import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { VendorActions } from "@/components/admin/vendor-actions"
import { VendorCommissionForm } from "@/components/admin/vendor-commission-form"
import { VendorStatusBadge } from "@/components/admin/vendor-status-badge"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { NotFoundError } from "@/lib/errors"
import { getVendorForAdmin } from "@/lib/services/vendor-admin"
import {
  describeAuditAction,
  readAuditDetails,
} from "@/lib/vendors/presentation"
import { allowedActions } from "@/lib/vendors/transitions"
import { setVendorCommissionAction, transitionVendorAction } from "./actions"

export const metadata: Metadata = { title: "Vendor" }

const when = (date: Date) =>
  date.toLocaleString("en-GB", { timeZone: "Europe/London" })

export default async function AdminVendorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  await enforceSurface("admin", `/admin/vendors/${id}`)

  const vendor = await getVendorForAdmin(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()

    throw error
  })

  return (
    <SurfaceShell eyebrow="Admin · Vendors" title={vendor.name}>
      <Link
        href="/admin/vendors"
        className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
      >
        ← All vendors
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section
            aria-labelledby="details"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="details" className="text-lg font-bold text-vml-ink">
                Details
              </h2>
              <VendorStatusBadge status={vendor.status} />
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Slug" value={vendor.slug} />
              <Field label="Contact email" value={vendor.contactEmail ?? "—"} />
              <Field label="Applied" value={when(vendor.createdAt)} />
              <Field label="Listings" value={String(vendor.listingCount)} />
              <Field
                label="Payout setup"
                value={
                  vendor.stripeOnboardingComplete ? "Complete" : "Not complete"
                }
              />
            </dl>
            {vendor.description ? (
              <p className="mt-4 text-sm text-vml-ink">{vendor.description}</p>
            ) : null}
          </section>

          <section
            aria-labelledby="commission"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="commission" className="text-lg font-bold text-vml-ink">
              Commission
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {vendor.commissionBpsOverride === null
                ? "Using each category's default commission."
                : `This vendor pays ${vendor.commissionBpsOverride / 100}% on its sales, whatever the category default is.`}
            </p>
            <div className="mt-4">
              <VendorCommissionForm
                vendorId={vendor.id}
                current={vendor.commissionBpsOverride}
                action={setVendorCommissionAction}
              />
            </div>
          </section>

          <section
            aria-labelledby="team"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="team" className="text-lg font-bold text-vml-ink">
              Team
            </h2>
            {vendor.members.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No members.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border text-sm">
                {vendor.members.map((member) => (
                  <li
                    key={member.email}
                    className="flex items-center justify-between py-2"
                  >
                    <span>
                      {member.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    </span>
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {member.role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="history"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="history" className="text-lg font-bold text-vml-ink">
              History
            </h2>
            {vendor.audit.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No actions recorded yet.
              </p>
            ) : (
              <ol className="mt-3 space-y-3 text-sm">
                {vendor.audit.map((entry) => {
                  const details = readAuditDetails(entry.meta)

                  return (
                    <li key={entry.id} data-audit-action={entry.action}>
                      <div className="font-medium text-vml-ink">
                        {describeAuditAction(entry.action)}
                        {details.from && details.to
                          ? ` (${details.from.toLowerCase()} → ${details.to.toLowerCase()})`
                          : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {when(entry.at)} ·{" "}
                        {entry.actor ? entry.actor.name : "a deleted admin"}
                      </div>
                      {details.reason ? (
                        <p className="mt-1 text-vml-ink">
                          Reason: {details.reason}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>

        <aside
          aria-labelledby="actions"
          className="h-fit rounded-2xl border border-border bg-card p-5"
        >
          <h2 id="actions" className="text-lg font-bold text-vml-ink">
            Actions
          </h2>
          <div className="mt-3">
            <VendorActions
              vendorId={vendor.id}
              status={vendor.status}
              allowed={allowedActions(vendor.status)}
              action={transitionVendorAction}
            />
          </div>
        </aside>
      </div>
    </SurfaceShell>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-vml-ink">{value}</dd>
    </div>
  )
}
