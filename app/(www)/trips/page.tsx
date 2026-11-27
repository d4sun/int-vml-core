import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { CreateTripForm } from "@/components/trips/create-trip-form"
import { UnauthenticatedError } from "@/lib/errors"
import { listTrips } from "@/lib/services/trip"
import { createTripAction } from "./actions"

export const metadata: Metadata = {
  title: "Your trips",
  robots: { index: false, follow: false },
}

export default async function TripsPage() {
  const trips = await listTrips().catch((error: unknown) => {
    if (error instanceof UnauthenticatedError) redirect("/sign-in?next=/trips")
    throw error
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-vml-ink">Your trips</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Save places you like into a trip, put them in order, and plan when you
        go.
      </p>

      <section
        aria-labelledby="new"
        className="mt-6 rounded-2xl border border-border bg-card p-5"
      >
        <h2 id="new" className="sr-only">
          Create a trip
        </h2>
        <CreateTripForm action={createTripAction} />
      </section>

      {trips.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          You have no trips yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex items-center justify-between gap-3 p-4"
            >
              <Link
                href={`/trips/${trip.id}`}
                className="font-semibold text-vml-navy underline-offset-4 hover:underline"
              >
                {trip.name}
              </Link>
              <span className="text-sm text-muted-foreground">
                {trip.items.length}{" "}
                {trip.items.length === 1 ? "place" : "places"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
