"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"

export function CategoryDelete({
  id,
  action,
}: {
  id: string
  action: (
    previous: ActionState<{ id: string }> | null,
    formData: FormData
  ) => Promise<ActionState<{ id: string }>>
}) {
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" disabled={pending}>
        Delete category
      </Button>
      {state?.status === "error" ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
