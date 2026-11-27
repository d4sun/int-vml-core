import type { PrismaClient } from "@prisma/client"

export type ReleaseOutcome =
  | { released: true; places: number }
  | { released: false; reason: "NOT_FOUND" | "NOT_EXPIRED" }

export type ReleaseDeps = {
  db?: Pick<PrismaClient, "$transaction">
  /** The clock: a hold is released only once `expiresAt` has passed. */
  now?: () => Date
}

/**
 * Gives a hold's places back, once its ten minutes are up (E2-S1-03).
 *
 * The hold row and its slot are locked together, so two releases (a job and a
 * sweep, say) cannot both return the places: the hold row is deleted in the
 * same transaction that returns them, and the second finds nothing to do. A
 * hold that is not yet expired is left alone, and so is one that no longer
 * exists (already released, or converted into a booking later).
 */
export async function releaseHold(
  holdId: string,
  deps: ReleaseDeps = {}
): Promise<ReleaseOutcome> {
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const now = deps.now?.() ?? new Date()

  return db.$transaction(async (tx) => {
    const [hold] = await tx.$queryRaw<
      {
        id: string
        availabilityId: string
        quantity: number
        expiresAt: Date
      }[]
    >`
      SELECT h."id", h."availabilityId", h."quantity", h."expiresAt"
      FROM "Hold" h
      WHERE h."id" = ${holdId}
      FOR UPDATE
    `

    if (!hold) return { released: false, reason: "NOT_FOUND" as const }

    if (hold.expiresAt.getTime() > now.getTime()) {
      return { released: false, reason: "NOT_EXPIRED" as const }
    }

    // Lock the slot too, so the places are returned against a settled count.
    await tx.$queryRaw`SELECT 1 FROM "Availability" WHERE "id" = ${hold.availabilityId} FOR UPDATE`

    await tx.hold.delete({ where: { id: hold.id } })
    await tx.availability.update({
      where: { id: hold.availabilityId },
      data: { remaining: { increment: hold.quantity } },
    })

    return { released: true, places: hold.quantity }
  })
}
