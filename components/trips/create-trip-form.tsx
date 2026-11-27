"use client"

import { useActionState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { TripRecord } from "@/lib/services/trip"

type Action = (
  previous: ActionState<TripRecord> | null,
  formData: FormData
) => Promise<ActionState<TripRecord>>

export function CreateTripForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null)
  const error =
    state?.status === "error" ? state.fieldErrors?.name?.[0] : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <TextField
          id="trip-name"
          name="name"
          label="New trip"
          placeholder="Summer in London"
          maxLength={80}
          error={error}
        />
      </div>
      <Button type="submit" disabled={pending}>
        Create trip
      </Button>
      {formError ? (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}
    </form>
  )
}
