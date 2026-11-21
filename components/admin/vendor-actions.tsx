"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { GovernedVendor } from "@/lib/services/vendor-governance"
import {
  VENDOR_ACTION_LABEL,
  VENDOR_STATUS_LABEL,
} from "@/lib/vendors/presentation"
import { REASON_REQUIRED, type VendorAction } from "@/lib/vendors/transitions"

type Action = (
  previous: ActionState<GovernedVendor> | null,
  formData: FormData
) => Promise<ActionState<GovernedVendor>>

export function VendorActions({
  vendorId,
  status,
  allowed,
  action,
}: {
  vendorId: string
  status: keyof typeof VENDOR_STATUS_LABEL
  allowed: VendorAction[]
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)

  if (allowed.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This vendor is {VENDOR_STATUS_LABEL[status].toLowerCase()}; no further
        action is possible.
      </p>
    )
  }

  const needsReason = allowed.some((a) => REASON_REQUIRED.includes(a))
  const reasonError =
    state?.status === "error" ? state.fieldErrors?.reason?.[0] : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="vendorId" value={vendorId} />

      {needsReason ? (
        <div className="space-y-1.5">
          <label htmlFor="reason" className="text-sm font-medium text-vml-ink">
            Reason{" "}
            <span className="font-normal text-muted-foreground">
              (required to reject or suspend)
            </span>
          </label>
          {/* Keyed on the status so the box clears once an action has applied. */}
          <textarea
            key={status}
            id="reason"
            name="reason"
            rows={3}
            maxLength={500}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? "reason-error" : undefined}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          {reasonError ? (
            <p
              id="reason-error"
              className="text-xs font-medium text-destructive"
            >
              {reasonError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {allowed.map((a) => (
          <Button
            key={a}
            type="submit"
            name="action"
            value={a}
            disabled={pending}
            variant={a === "reject" || a === "suspend" ? "outline" : "default"}
            className={
              a === "approve" || a === "reinstate"
                ? "h-9 rounded-xl bg-vml-red px-4 text-white hover:bg-vml-red/90"
                : "h-9 rounded-xl px-4"
            }
          >
            {VENDOR_ACTION_LABEL[a]}
          </Button>
        ))}
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {state?.status === "success" ? (
          <p className="font-medium text-vml-green">
            Done: this vendor is now{" "}
            {VENDOR_STATUS_LABEL[state.data.status].toLowerCase()}.
          </p>
        ) : null}
        {formError ? (
          <p role="alert" className="font-medium text-destructive">
            {formError}
          </p>
        ) : null}
      </div>
    </form>
  )
}
