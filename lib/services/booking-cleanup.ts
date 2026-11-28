import type { PrismaClient } from "@prisma/client"

/**
 * How long a booking may stay unpaid before it is cancelled. 30 minutes is a
 * choice made here (the card gives no value); the places it holds come back
 * when it is cancelled.
 */
export const PAYMENT_WINDOW_MINUTES = 30

/** The periodic sweep: every five minutes. */
export const CLEANUP_CRON = "*/5 * * * *"

export type CleanupDeps = {
  db?: Pick<PrismaClient, "booking" | "$transaction" | "$queryRaw">
  now?: () => Date
}

export type CleanupResult = { cancelled: number; placesReturned: number }

/**
 * Cancels PENDING bookings whose payment window has passed, and gives their
 * places back (IT-10, TC-E2S3-04). Each booking is handled in its own
 * transaction: its row is locked and its status re-checked, so a booking that
 * was paid a moment ago is left alone, and a second sweep finds nothing to do.
 *
 * A payment still open on Stripe is marked cancelled here; if it succeeds
 * later anyway, the webhook records it for review instead of confirming it.
 */
export async function cancelExpiredBookings(
  deps: CleanupDeps = {}
): Promise<CleanupResult> {
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const now = deps.now?.() ?? new Date()
  const cutoff = new Date(now.getTime() - PAYMENT_WINDOW_MINUTES * 60 * 1000)

  const stale = await db.booking.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true },
    take: 200,
  })

  let cancelled = 0
  let placesReturned = 0

  for (const { id } of stale) {
    const returned = await db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT "id", "status" FROM "Booking" WHERE "id" = ${id} FOR UPDATE
      `

      if (!locked || locked.status !== "PENDING") return null

      const items = await tx.bookingItem.findMany({
        where: { bookingId: id, status: "PENDING" },
        select: { availabilityId: true, quantity: true },
      })

      for (const item of items) {
        await tx.$queryRaw`SELECT 1 FROM "Availability" WHERE "id" = ${item.availabilityId} FOR UPDATE`
        await tx.availability.update({
          where: { id: item.availabilityId },
          data: { remaining: { increment: item.quantity } },
        })
      }

      await tx.bookingItem.updateMany({
        where: { bookingId: id, status: "PENDING" },
        data: { status: "CANCELLED" },
      })
      await tx.booking.update({ where: { id }, data: { status: "CANCELLED" } })
      await tx.payment.updateMany({
        where: { bookingId: id, status: { not: "succeeded" } },
        data: { status: "cancelled" },
      })

      return items.reduce((sum, item) => sum + item.quantity, 0)
    })

    if (returned !== null) {
      cancelled += 1
      placesReturned += returned
    }
  }

  return { cancelled, placesReturned }
}
