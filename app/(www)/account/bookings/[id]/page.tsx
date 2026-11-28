import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { formatPence } from "@/lib/money/format"
import { NotFoundError, UnauthenticatedError } from "@/lib/errors"
import { getMyBooking, londonTime } from "@/lib/services/my-bookings"

export const metadata: Metadata = {
  title: "Booking",
  robots: { index: false, follow: false },
}

export default async function MyBookingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const booking = await getMyBooking(id).catch((error: unknown) => {
    if (error instanceof UnauthenticatedError)
      redirect(`/sign-in?next=/account/bookings/${id}`)
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/account/bookings"
        className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
      >
        ← Your bookings
      </Link>
      <h1 className="mt-3 text-3xl font-bold text-vml-ink">
        Booking {booking.ref}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Status: {booking.status.toLowerCase().replace("_", " ")} · Total{" "}
        {formatPence(booking.total)}
      </p>

      <ul className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {booking.items.map((item) => (
          <li key={item.id} className="p-4" data-status={item.status}>
            <p className="font-semibold text-vml-ink">
              {item.listingTitle}: {item.productName}
            </p>
            <p className="text-sm text-muted-foreground">
              {londonTime(item.startAt)} · {item.quantity}{" "}
              {item.quantity === 1 ? "place" : "places"} ·{" "}
              {formatPence(item.subtotal)}
            </p>
            <p className="text-sm text-vml-ink">
              {item.status.toLowerCase().replace("_", " ")}
            </p>
          </li>
        ))}
      </ul>
    </main>
  )
}
