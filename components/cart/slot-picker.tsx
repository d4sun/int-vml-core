"use client"

import Link from "next/link"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { Cart } from "@/lib/services/cart"
import { formatPence } from "@/lib/money/format"

export type PickableSlot = {
  availabilityId: string
  label: string
  unitPrice: number
  remaining: number
}

type Action = (
  previous: ActionState<Cart> | null,
  formData: FormData
) => Promise<ActionState<Cart>>

/** Choose a time on a listing page and hold places for it. */
export function SlotPicker({
  slots,
  action,
}: {
  slots: PickableSlot[]
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)

  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No times are open to book right now.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <label
          htmlFor="slot-choice"
          className="text-sm font-medium text-vml-ink"
        >
          Time
        </label>
        <select
          id="slot-choice"
          name="availabilityId"
          required
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
        >
          {slots.map((slot) => (
            <option key={slot.availabilityId} value={slot.availabilityId}>
              {slot.label} · {formatPence(slot.unitPrice)} · {slot.remaining}{" "}
              left
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="slot-quantity"
          className="text-sm font-medium text-vml-ink"
        >
          Places
        </label>
        <select
          id="slot-quantity"
          name="quantity"
          defaultValue="1"
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        Add to cart
      </Button>
      {state?.status === "success" ? (
        <p role="status" className="text-sm text-vml-ink">
          Added.{" "}
          <Link
            href="/cart"
            className="font-medium text-vml-navy underline-offset-4 hover:underline"
          >
            View your cart
          </Link>
        </p>
      ) : null}
      {state?.status === "error" ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
