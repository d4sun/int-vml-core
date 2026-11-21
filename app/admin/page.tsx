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
      </ul>
    </SurfaceShell>
  )
}
