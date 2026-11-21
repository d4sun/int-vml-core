import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"

export default async function VendorHomePage() {
  await enforceSurface("vendor", "/vendor")

  return (
    <SurfaceShell eyebrow="Vendor" title="Vendor dashboard">
      <p className="text-sm text-muted-foreground">
        Your listings, bookings and payouts will appear here.
      </p>
    </SurfaceShell>
  )
}
