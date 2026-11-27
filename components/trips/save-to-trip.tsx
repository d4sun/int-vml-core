"use client"

import Link from "next/link"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { TripRecord } from "@/lib/services/trip"

type Action = (
  previous: ActionState<TripRecord> | null,
  formData: FormData
) => Promise<ActionState<TripRecord>>

/** "Save to trip" on a listing page: choose a trip, optionally a date, and save. */
export function SaveToTrip({
  listingId,
  trips,
  action,
}: {
  listingId: string
  trips: { id: string; name: string }[]
  action: Action
}) {
  const [state, formAction, pending] = useActionState(action, null)

  if (trips.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link
          href="/trips"
          className="font-medium text-vml-navy underline-offset-4 hover:underline"
        >
          Create a trip
        </Link>{" "}
        to save this place for later.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="listingId" value={listingId} />
      <div className="space-y-1.5">
        <label htmlFor="save-trip" className="text-sm font-medium text-vml-ink">
          Trip
        </label>
        <select
          id="save-trip"
          name="tripId"
          required
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
        >
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending} variant="outline">
        Save to trip
      </Button>
      {state?.status === "success" ? (
        <p role="status" className="text-sm text-vml-ink">
          Saved to {state.data.name}.
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
