import type { ComponentProps } from "react"
import { Input } from "@/components/ui/input"

/** Labelled input with an accessible, associated error message. */
export function TextField({
  id,
  label,
  error,
  hint,
  ...props
}: Omit<ComponentProps<typeof Input>, "id"> & {
  id: string
  label: string
  error?: string | undefined
  hint?: string
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-vml-ink">
        {label}
      </label>
      <Input
        id={id}
        className="h-10 rounded-xl"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
