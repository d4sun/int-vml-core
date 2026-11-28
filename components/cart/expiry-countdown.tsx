"use client"

import { useEffect, useState } from "react"

/**
 * Counts down to the soonest hold expiry. The server still decides: once the
 * time is up the page says so and asks for a refresh, rather than trusting the
 * clock on the device.
 */
export function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const end = new Date(expiresAt).getTime()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])

  if (now === null)
    return (
      <p className="text-sm text-muted-foreground">
        Your places are held for a short time.
      </p>
    )

  const left = Math.max(0, end - now)

  if (left === 0) {
    return (
      <p role="status" className="text-sm font-medium text-destructive">
        Your hold has run out. Refresh the page to see what is still available.
      </p>
    )
  }

  const minutes = Math.floor(left / 60000)
  const seconds = String(Math.floor((left % 60000) / 1000)).padStart(2, "0")

  return (
    <p role="status" className="text-sm text-vml-ink">
      Places held for{" "}
      <span className="font-semibold tabular-nums">
        {minutes}:{seconds}
      </span>
    </p>
  )
}
