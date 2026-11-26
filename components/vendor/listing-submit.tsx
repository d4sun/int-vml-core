"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { ListingRecord } from "@/lib/services/listing"

export function ListingSubmit({
  id,
  action,
}: {
  id: string
  action: (
    previous: ActionState<ListingRecord> | null,
    formData: FormData
  ) => Promise<ActionState<ListingRecord>>
}) {
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        disabled={pending}
        className="h-10 rounded-xl bg-vml-red px-5 text-white hover:bg-vml-red/90"
      >
        {pending ? "Submitting…" : "Submit for review"}
      </Button>
      {state?.status === "error" ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
