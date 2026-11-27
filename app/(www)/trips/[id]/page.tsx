import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { UnauthenticatedError, NotFoundError } from "@/lib/errors"
import { getTrip } from "@/lib/services/trip"
import {
  deleteTripFormAction,
  moveTripItemFormAction,
  removeTripItemFormAction,
} from "../actions"

export const metadata: Metadata = {
  title: "Your trip",
  robots: { index: false, follow: false },
}

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const trip = await getTrip(id).catch((error: unknown) => {
    if (error instanceof UnauthenticatedError)
      redirect(`/sign-in?next=/trips/${id}`)
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/trips"
        className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
      >
        ← All trips
      </Link>
      <h1 className="mt-3 text-3xl font-bold text-vml-ink">{trip.name}</h1>

      {trip.items.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No places yet. Open a listing and choose “Save to trip”.
        </p>
      ) : (
        <ol className="mt-8 space-y-3" aria-label="Places in this trip">
          {trip.items.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Stop {index + 1}
                </p>
                <Link
                  href={`/listings/${item.listingSlug}`}
                  className="font-semibold text-vml-ink hover:underline"
                >
                  {item.listingTitle}
                </Link>
                {item.plannedDate ? (
                  <p className="text-sm text-muted-foreground">
                    Planned for {item.plannedDate}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="text-sm text-muted-foreground">{item.note}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <form action={moveTripItemFormAction}>
                  <input type="hidden" name="tripId" value={trip.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button
                    type="submit"
                    name="direction"
                    value="up"
                    variant="outline"
                    size="sm"
                    disabled={index === 0}
                    aria-label={`Move ${item.listingTitle} up`}
                  >
                    Up
                  </Button>
                </form>
                <form action={moveTripItemFormAction}>
                  <input type="hidden" name="tripId" value={trip.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button
                    type="submit"
                    name="direction"
                    value="down"
                    variant="outline"
                    size="sm"
                    disabled={index === trip.items.length - 1}
                    aria-label={`Move ${item.listingTitle} down`}
                  >
                    Down
                  </Button>
                </form>
                <form action={removeTripItemFormAction}>
                  <input type="hidden" name="tripId" value={trip.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Remove
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form action={deleteTripFormAction} className="mt-10">
        <input type="hidden" name="tripId" value={trip.id} />
        <Button type="submit" variant="outline">
          Delete this trip
        </Button>
      </form>
    </main>
  )
}
