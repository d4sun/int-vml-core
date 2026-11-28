"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { SettlementOutcome } from "@/lib/services/refund-settlement"

type Action = (
  previous: ActionState<SettlementOutcome> | null,
  formData: FormData
) => Promise<ActionState<SettlementOutcome>>

/** Sends a flagged refund's reversal again, once the vendor's balance covers it (E10-S1-08). */
export function RetryReversalForm({
  bookingId,
  refundId,
  action,
}: {
  bookingId: string
  refundId: string
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <form
      action={formAction}
      className="inline-flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="refundId" value={refundId} />
      <Button type="submit" variant="outline" disabled={pending}>
        Retry reversal
      </Button>
      {state?.status === "error" ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      ) : null}
      {state?.status === "success" && state.data.outcome === "flagged" ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          The vendor&apos;s balance still cannot cover this reversal.
        </p>
      ) : null}
    </form>
  )
}
