import type { ReactNode } from "react"

/** Shared shell for the auth pages: eyebrow, heading, copy and a card body. */
export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {eyebrow ? (
          <p className="text-[11px] font-semibold tracking-wide text-vml-red uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-3xl font-bold text-vml-ink">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
      {footer ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {footer}
        </p>
      ) : null}
    </div>
  )
}
