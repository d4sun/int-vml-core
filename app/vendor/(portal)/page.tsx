import Link from "next/link"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"

export default async function VendorHomePage() {
  await enforceSurface("vendor", "/vendor")

  return (
    <SurfaceShell eyebrow="Vendor" title="Vendor dashboard">
      <p className="text-sm text-muted-foreground">
        Your listings, bookings and payouts will appear here.
      </p>
      <p className="mt-4 flex gap-4 text-sm">
        <Link href="/vendor/listings" className="underline">
          Listings
        </Link>
        <Link href="/vendor/payouts/setup" className="underline">
          Payout setup
        </Link>
      </p>
    </SurfaceShell>
  )
}
