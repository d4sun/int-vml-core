"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"

type Action = (
  previous: ActionState<{ status: "complete" }> | null,
  formData: FormData
) => Promise<ActionState<{ status: "complete" }>>

export function PayoutSetupForm({
  action,
  vendorId,
  label,
}: {
  action: Action
  vendorId: string
  label: string
}) {
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="vendorId" value={vendorId} />
      <Button
        type="submit"
        disabled={pending}
        className="h-10 rounded-xl bg-vml-red px-5 text-white hover:bg-vml-red/90"
      >
        {pending ? "Opening Stripe…" : label}
      </Button>
      {state?.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
