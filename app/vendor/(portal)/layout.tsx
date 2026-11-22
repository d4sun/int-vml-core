import type { Metadata } from "next"
import type { ReactNode } from "react"
import { enforceSurface } from "@/lib/auth/enforce-surface"

export const metadata: Metadata = {
  title: { default: "Vendor", template: "%s · Vendor · Visit My London" },
  robots: { index: false, follow: false },
}

// The portal sits in its own route group so that `/vendor/apply` (becoming a
// vendor) can live beside it without requiring the VENDOR role it grants.
// Every page in here must also call `enforceSurface`: see that function.
export default async function VendorPortalLayout({
  children,
}: {
  children: ReactNode
}) {
  await enforceSurface("vendor")

  return children
}
