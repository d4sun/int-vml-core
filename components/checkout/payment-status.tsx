"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

const POLL_MS = 3000
const MAX_POLLS = 40

/**
 * Asks the server for the booking's state until it is confirmed or the wait is
 * long enough to say "still working on it". It only reads: the webhook is what
 * confirms a payment (CR-4), never this page.
 */
export function PaymentStatus({
  bookingId,
  initial,
}: {
  bookingId: string
  initial: string
}) {
  const [status, setStatus] = useState(initial)
  const [polls, setPolls] = useState(0)

  useEffect(() => {
    if (status !== "PENDING" || polls >= MAX_POLLS) return

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/bookings/${bookingId}/status`, {
          cache: "no-store",
        })

        if (response.ok) {
          const body = (await response.json()) as { status: string }
          setStatus(body.status)
        }
      } catch {
        // A failed poll is simply tried again.
      }

      setPolls((n) => n + 1)
    }, POLL_MS)

    return () => clearTimeout(timer)
  }, [bookingId, status, polls])

  if (status === "CONFIRMED") {
    return (
      <p role="status" className="text-lg font-semibold text-vml-ink">
        Your booking is confirmed.{" "}
        <Link
          href="/explore"
          className="text-vml-navy underline-offset-4 hover:underline"
        >
          Keep exploring
        </Link>
        .
      </p>
    )
  }

  if (status === "CANCELLED") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        This booking was cancelled because payment was not completed in time.
      </p>
    )
  }

  if (polls >= MAX_POLLS) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Your payment is still being confirmed. Refresh this page in a minute, or
        check your bookings later.
      </p>
    )
  }

  return (
    <p role="status" className="text-sm text-muted-foreground">
      Confirming your payment…
    </p>
  )
}
