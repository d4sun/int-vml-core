import type { ReactNode } from "react"

/** Page frame shared by the role-restricted areas (vendor, admin). */
export function SurfaceShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <p className="text-[11px] font-semibold tracking-wide text-vml-red uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-1 text-3xl font-bold text-vml-ink">{title}</h1>
      <div className="mt-6">{children}</div>
    </div>
  )
}
