"use client"

import { useActionState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { IssuedRefund } from "@/lib/services/refund-issue"

type Action = (
  previous: ActionState<IssuedRefund> | null,
  formData: FormData
) => Promise<ActionState<IssuedRefund>>

export type RefundableItem = { id: string; label: string; refundable: number }

/**
 * Refunds part or all of one item. The amount is typed in pounds; the server
 * turns it into pence and checks it against what is still refundable.
 */
export function RefundForm({
  bookingId,
  items,
  action,
}: {
  bookingId: string
  items: RefundableItem[]
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const fieldError = (field: string) =>
    state?.status === "error" ? state.fieldErrors?.[field]?.[0] : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="space-y-1.5">
        <label
          htmlFor="refund-item"
          className="text-sm font-medium text-vml-ink"
        >
          Item
        </label>
        <select
          id="refund-item"
          name="bookingItemId"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          defaultValue={items[0]?.id}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {fieldError("bookingItemId") ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {fieldError("bookingItemId")}
          </p>
        ) : null}
      </div>

      <TextField
        id="refund-amount"
        name="amount"
        label="Amount to refund (£)"
        inputMode="decimal"
        placeholder="e.g. 5.00"
        hint="Up to what is still refundable on this item."
        error={fieldError("amount")}
      />

      <TextField
        id="refund-reason"
        name="reason"
        label="Reason (optional)"
        error={fieldError("reason")}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Issue refund
        </Button>
        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}
        {state?.status === "success" ? (
          <p role="status" className="text-sm text-vml-ink">
            Refund requested. It is confirmed once Stripe reports it.
          </p>
        ) : null}
      </div>
    </form>
  )
}
