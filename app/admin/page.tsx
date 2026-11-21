import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"

export default async function AdminHomePage() {
  await enforceSurface("admin", "/admin")

  return (
    <SurfaceShell eyebrow="Admin" title="Admin dashboard">
      <p className="text-sm text-muted-foreground">
        Vendor approvals, moderation and refunds will appear here.
      </p>
    </SurfaceShell>
  )
}
