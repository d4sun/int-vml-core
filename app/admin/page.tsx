import Link from "next/link"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"

export default async function AdminHomePage() {
  await enforceSurface("admin", "/admin")

  return (
    <SurfaceShell eyebrow="Admin" title="Admin dashboard">
      <ul className="grid gap-4 sm:grid-cols-2">
        <li>
          <Link
            href="/admin/vendors"
            className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md"
          >
            <span className="text-lg font-bold text-vml-ink">Vendors</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Review applications, approve, suspend and reinstate.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/listings"
            className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md"
          >
            <span className="text-lg font-bold text-vml-ink">Listings</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Approve or reject listings waiting for review.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/categories"
            className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md"
          >
            <span className="text-lg font-bold text-vml-ink">Categories</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Organise the catalogue and set default commission.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/ledger"
            className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md"
          >
            <span className="text-lg font-bold text-vml-ink">Ledger</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Payments, vendor transfers and refunds, with totals.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/disputes"
            className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md"
          >
            <span className="text-lg font-bold text-vml-ink">Disputes</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Chargebacks opened against payments.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/metrics"
            className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md"
          >
            <span className="text-lg font-bold text-vml-ink">Metrics</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Gross value, commission, refunds and counts by date.
            </span>
          </Link>
        </li>
      </ul>
    </SurfaceShell>
  )
}
