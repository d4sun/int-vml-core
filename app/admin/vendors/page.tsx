import type { Metadata } from "next"
import Link from "next/link"
import { SurfaceShell } from "@/components/surface-shell"
import { VendorStatusBadge } from "@/components/admin/vendor-status-badge"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { listVendorsForAdmin } from "@/lib/services/vendor-admin"
import {
  VENDOR_STATUS_LABEL,
  VENDOR_STATUS_ORDER,
  parseQueueFilter,
} from "@/lib/vendors/presentation"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Vendors" }

export default async function AdminVendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>
}) {
  await enforceSurface("admin", "/admin/vendors")

  const filter = parseQueueFilter((await searchParams).status)
  const { vendors, counts, truncated } = await listVendorsForAdmin({
    ...(filter === "ALL" ? {} : { status: filter }),
  })
  const total = VENDOR_STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0)

  const tabs = [
    ...VENDOR_STATUS_ORDER.map((s) => ({
      key: s,
      label: VENDOR_STATUS_LABEL[s],
      count: counts[s],
    })),
    { key: "ALL" as const, label: "All", count: total },
  ]

  return (
    <SurfaceShell eyebrow="Admin" title="Vendors">
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/vendors?status=${tab.key}`}
            aria-current={filter === tab.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium",
              filter === tab.key
                ? "border-vml-navy bg-vml-navy text-white"
                : "border-border bg-background text-vml-ink hover:bg-muted"
            )}
          >
            {tab.label} <span className="opacity-70">({tab.count})</span>
          </Link>
        ))}
      </nav>

      {vendors.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {filter === "PENDING"
            ? "No vendors are waiting for review."
            : "No vendors match this filter."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Applicant</th>
                <th className="px-4 py-3 font-semibold">Applied</th>
                <th className="px-4 py-3 font-semibold">Listings</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendors.map((vendor) => (
                <tr key={vendor.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/vendors/${vendor.id}`}
                      className="font-medium text-vml-navy underline-offset-4 hover:underline"
                    >
                      {vendor.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {vendor.slug}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {vendor.owner ? (
                      <>
                        <div>{vendor.owner.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {vendor.owner.email}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {vendor.contactEmail ?? "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <time dateTime={vendor.createdAt.toISOString()}>
                      {vendor.createdAt.toLocaleDateString("en-GB", {
                        timeZone: "Europe/London",
                      })}
                    </time>
                  </td>
                  <td className="px-4 py-3">{vendor.listingCount}</td>
                  <td className="px-4 py-3">
                    <VendorStatusBadge status={vendor.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {truncated ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the oldest 100. Narrow the filter to see the rest.
        </p>
      ) : null}
    </SurfaceShell>
  )
}
