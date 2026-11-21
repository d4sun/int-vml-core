import type { Metadata } from "next"
import type { ReactNode } from "react"
import { enforceSurface } from "@/lib/auth/enforce-surface"

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Visit My London" },
  robots: { index: false, follow: false },
}

// Every page in here must also call `enforceSurface`: see that function.
export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await enforceSurface("admin")

  return children
}
