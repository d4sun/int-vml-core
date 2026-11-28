import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { formatPence } from "@/lib/money/format"
import { UnauthenticatedError } from "@/lib/errors"
import { listMyBookings, londonTime } from "@/lib/services/my-bookings"

export const metadata: Metadata = {
  title: "Your bookings",
  robots: { index: false, follow: false },
}

export default async function MyBookingsPage() {
  const bookings = await listMyBookings().catch((error: unknown) => {
    if (error instanceof UnauthenticatedError)
      redirect("/sign-in?next=/account/bookings")
    throw error
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-vml-ink">Your bookings</h1>

      {bookings.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          You have no bookings yet.{" "}
          <Link
            href="/explore"
            className="font-medium text-vml-navy underline-offset-4 hover:underline"
          >
            Find something to book
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
          {bookings.map((booking) => (
            <li key={booking.id} className="p-4">
              <Link
                href={`/account/bookings/${booking.id}`}
                className="font-semibold text-vml-navy underline-offset-4 hover:underline"
              >
                Booking {booking.ref}
              </Link>
              <p className="text-sm text-muted-foreground">
                {booking.items
                  .map(
                    (item) =>
                      `${item.listingTitle} · ${londonTime(item.startAt)}`
                  )
                  .join(" · ")}
              </p>
              <p className="text-sm text-vml-ink">
                {formatPence(booking.total)} ·{" "}
                {booking.status.toLowerCase().replace("_", " ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
