"use client"

import { useActionState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { Profile } from "@/lib/services/profile"

type Action = (
  previous: ActionState<Profile> | null,
  formData: FormData
) => Promise<ActionState<Profile>>

export function ProfileForm({
  name,
  action,
}: {
  name: string
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)

  const nameError =
    state?.status === "error" ? state.fieldErrors?.name?.[0] : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form action={formAction} className="space-y-4">
      <TextField
        id="name"
        name="name"
        label="Full name"
        autoComplete="name"
        defaultValue={name}
        error={nameError}
      />

      <div role="status" aria-live="polite" className="text-sm">
        {state?.status === "success" ? (
          <p className="font-medium text-vml-green">Profile updated.</p>
        ) : null}
        {formError ? (
          <p role="alert" className="font-medium text-destructive">
            {formError}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        className="h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
        disabled={pending}
      >
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}
