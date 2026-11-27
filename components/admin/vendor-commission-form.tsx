"use client"

import { useActionState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import { bpsToPercent } from "@/lib/categories/commission"
import type { ActionState } from "@/lib/actions/result"
import type { VendorCommission } from "@/lib/services/vendor-commission"

type Action = (
  previous: ActionState<VendorCommission> | null,
  formData: FormData
) => Promise<ActionState<VendorCommission>>

/**
 * Sets this vendor's commission. A blank box clears the override, so each
 * category's default applies again. Applies to sales from now on.
 */
export function VendorCommissionForm({
  vendorId,
  current,
  action,
}: {
  vendorId: string
  current: number | null
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const error =
    state?.status === "error"
      ? state.fieldErrors?.commissionBps?.[0]
      : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="vendorId" value={vendorId} />

      <TextField
        id="vendor-commission"
        name="commission"
        label="Commission for this vendor (%)"
        inputMode="decimal"
        defaultValue={current === null ? "" : bpsToPercent(current)}
        placeholder="Use each category's default"
        hint="Leave blank to use each category's default. Up to two decimal places. Applies to new sales only; existing bookings keep their commission."
        error={error}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save commission
        </Button>
        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}
        {state?.status === "success" ? (
          <p role="status" className="text-sm text-vml-ink">
            Saved.
          </p>
        ) : null}
      </div>
    </form>
  )
}
