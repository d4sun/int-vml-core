import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import { HOLD_TTL_MINUTES, placeHoldSchema } from "@/lib/validation/hold"

export type PlacedHold = {
  id: string
  availabilityId: string
  quantity: number
  expiresAt: Date
}

export type HoldDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  /** The clock, so tests can pin "now". */
  now?: () => Date
}

type SlotRow = {
  id: string
  remaining: number
  closed: boolean
  startAt: Date
  productActive: boolean
  policy: unknown
}

/** Booking cutoff in hours from the product's policy; missing or invalid reads as 0. */
function cutoffHoursOf(policy: unknown): number {
  if (typeof policy !== "object" || policy === null) return 0
  const hours = (policy as { bookingCutoffHours?: unknown }).bookingCutoffHours

  return typeof hours === "number" && Number.isFinite(hours) ? hours : 0
}

/**
 * Holds places on one slot for the signed-in visitor for HOLD_TTL_MINUTES.
 *
 * The slot row is locked (`FOR UPDATE`) before it is read, so two holds on the
 * last place cannot both see it free: the second waits, then sees the first's
 * decrement and is refused. `remaining` is decremented in the same transaction
 * as the hold row, so the two cannot disagree. The database also refuses a
 * negative `remaining` (a CHECK constraint), as a last line of defence.
 *
 * A refused hold leaves no row and changes nothing.
 */
export async function placeHold(
  input: unknown,
  deps: HoldDeps = {}
): Promise<PlacedHold> {
  const user = await requireUser(deps.session)

  const parsed = placeHoldSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { availabilityId, quantity } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const now = deps.now?.() ?? new Date()

  return db.$transaction(async (tx) => {
    const [slot] = await tx.$queryRaw<SlotRow[]>`
      SELECT a."id", a."remaining", a."closed", a."startAt",
             p."active" AS "productActive", p."policy"
      FROM "Availability" a
      JOIN "Product" p ON p."id" = a."productId"
      WHERE a."id" = ${availabilityId}
      FOR UPDATE OF a
    `

    if (!slot) throw new NotFoundError("That time slot does not exist")

    if (!slot.productActive || slot.closed) {
      throw new ConflictError("That time slot is not available to book.", {
        details: { reason: "CLOSED" },
      })
    }

    const cutoffAt = now.getTime() + cutoffHoursOf(slot.policy) * 60 * 60 * 1000

    if (slot.startAt.getTime() <= cutoffAt) {
      throw new ConflictError(
        "That time slot is too close to its start to book.",
        {
          details: { reason: "PAST_CUTOFF" },
        }
      )
    }

    if (slot.remaining < quantity) {
      throw new ConflictError(
        slot.remaining === 0
          ? "That time slot has just sold out."
          : `Only ${slot.remaining} place${slot.remaining === 1 ? "" : "s"} left.`,
        { details: { reason: "NOT_ENOUGH", remaining: slot.remaining } }
      )
    }

    await tx.availability.update({
      where: { id: slot.id },
      data: { remaining: { decrement: quantity } },
    })

    const expiresAt = new Date(now.getTime() + HOLD_TTL_MINUTES * 60 * 1000)

    const hold = await tx.hold.create({
      data: {
        availabilityId: slot.id,
        userId: user.id,
        quantity,
        expiresAt,
      },
      select: { id: true },
    })

    return { id: hold.id, availabilityId: slot.id, quantity, expiresAt }
  })
}
