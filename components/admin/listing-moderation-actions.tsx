"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import { SELL_BLOCK_LABEL } from "@/lib/listings/presentation"
import type { SellBlockReason } from "@/lib/catalog/visibility"
import type { ModeratedListing } from "@/lib/services/listing-moderation"

type Action = (
  previous: ActionState<ModeratedListing> | null,
  formData: FormData
) => Promise<ActionState<ModeratedListing>>

/**
 * Approve or reject. Approval is offered only when the vendor is able to sell;
 * otherwise the reason is shown. The server still checks everything.
 */
export function ListingModerationActions({
  listingId,
  blockReason,
  action,
}: {
  listingId: string
  blockReason: SellBlockReason | null
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)

  const reasonError =
    state?.status === "error" ? state.fieldErrors?.reason?.[0] : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="listingId" value={listingId} />

      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-sm font-medium text-vml-ink">
          Reason{" "}
          <span className="font-normal text-muted-foreground">
            (required to reject; shown to the vendor)
          </span>
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          maxLength={500}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? "reason-error" : undefined}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        {reasonError ? (
          <p id="reason-error" className="text-xs font-medium text-destructive">
            {reasonError}
          </p>
        ) : null}
      </div>

      {blockReason ? (
        <p className="text-sm text-muted-foreground">
          Approval is blocked: {SELL_BLOCK_LABEL[blockReason].toLowerCase()}.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="action"
          value="approve"
          disabled={pending || blockReason !== null}
        >
          Approve and publish
        </Button>
        <Button
          type="submit"
          name="action"
          value="reject"
          variant="outline"
          disabled={pending}
        >
          Reject
        </Button>
      </div>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}
      {state?.status === "success" ? (
        <p role="status" className="text-sm font-medium text-vml-ink">
          Saved.
        </p>
      ) : null}
    </form>
  )
}
