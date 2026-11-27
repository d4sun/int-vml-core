import type { PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { publiclyVisibleListingWhere } from "@/lib/catalog/visibility"
import { ConflictError, NotFoundError } from "@/lib/errors"
import {
  addTripItemSchema,
  createTripSchema,
  deleteTripSchema,
  removeTripItemSchema,
  renameTripSchema,
  reorderTripSchema,
} from "@/lib/validation/trip"

export type TripItemRecord = {
  id: string
  position: number
  listingId: string
  listingTitle: string
  listingSlug: string
  plannedDate: string | null
  note: string | null
}

export type TripRecord = {
  id: string
  name: string
  items: TripItemRecord[]
}

export type TripDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "trip" | "tripItem" | "listing" | "$transaction">
}

const SELECT_TRIP = {
  id: true,
  name: true,
  items: {
    orderBy: { position: "asc" as const },
    select: {
      id: true,
      position: true,
      listingId: true,
      plannedDate: true,
      note: true,
      listing: { select: { title: true, slug: true } },
    },
  },
}

function toRecord(row: {
  id: string
  name: string
  items: {
    id: string
    position: number
    listingId: string
    plannedDate: Date | null
    note: string | null
    listing: { title: string; slug: string }
  }[]
}): TripRecord {
  return {
    id: row.id,
    name: row.name,
    items: row.items.map((item) => ({
      id: item.id,
      position: item.position,
      listingId: item.listingId,
      listingTitle: item.listing.title,
      listingSlug: item.listing.slug,
      plannedDate: item.plannedDate
        ? item.plannedDate.toISOString().slice(0, 10)
        : null,
      note: item.note,
    })),
  }
}

async function resolveDb(deps: TripDeps) {
  return deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
}

/**
 * A trip the signed-in visitor owns. A trip that belongs to someone else, or
 * does not exist, is the same "not found" (CR-1, CR-2): nothing about another
 * visitor's trips is revealed.
 */
async function ownedTrip(
  db: Pick<PrismaClient, "trip">,
  tripId: string,
  userId: string
) {
  const trip = await db.trip.findFirst({
    where: { id: tripId, touristUserId: userId },
    select: { id: true },
  })

  if (!trip) throw new NotFoundError("That trip was not found")

  return trip
}

export async function listTrips(deps: TripDeps = {}): Promise<TripRecord[]> {
  const user = await requireUser(deps.session)
  const db = await resolveDb(deps)

  const rows = await db.trip.findMany({
    where: { touristUserId: user.id },
    orderBy: { createdAt: "asc" },
    select: SELECT_TRIP,
  })

  return rows.map(toRecord)
}

export async function getTrip(
  tripId: unknown,
  deps: TripDeps = {}
): Promise<TripRecord> {
  const user = await requireUser(deps.session)
  const parsed = deleteTripSchema.safeParse({ tripId })

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)
  const row = await db.trip.findFirst({
    where: { id: parsed.data.tripId, touristUserId: user.id },
    select: SELECT_TRIP,
  })

  if (!row) throw new NotFoundError("That trip was not found")

  return toRecord(row)
}

export async function createTrip(
  input: unknown,
  deps: TripDeps = {}
): Promise<TripRecord> {
  const user = await requireUser(deps.session)
  const parsed = createTripSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)
  const row = await db.trip.create({
    data: { touristUserId: user.id, name: parsed.data.name },
    select: SELECT_TRIP,
  })

  return toRecord(row)
}

export async function renameTrip(
  input: unknown,
  deps: TripDeps = {}
): Promise<TripRecord> {
  const user = await requireUser(deps.session)
  const parsed = renameTripSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)
  await ownedTrip(db, parsed.data.tripId, user.id)
  const row = await db.trip.update({
    where: { id: parsed.data.tripId },
    data: { name: parsed.data.name },
    select: SELECT_TRIP,
  })

  return toRecord(row)
}

/** Deleting a trip removes its items with it (cascade). Listings are untouched. */
export async function deleteTrip(
  input: unknown,
  deps: TripDeps = {}
): Promise<void> {
  const user = await requireUser(deps.session)
  const parsed = deleteTripSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)
  await ownedTrip(db, parsed.data.tripId, user.id)
  await db.trip.delete({ where: { id: parsed.data.tripId } })
}

/**
 * Adds a listing to the end of a trip. The listing must be publicly visible
 * right now: a visitor cannot pin a draft or a suspended vendor's listing.
 * The position is one more than the last, so the order is always stable.
 */
export async function addTripItem(
  input: unknown,
  deps: TripDeps = {}
): Promise<TripRecord> {
  const user = await requireUser(deps.session)
  const parsed = addTripItemSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { tripId, listingId, plannedDate, note } = parsed.data
  const db = await resolveDb(deps)

  await ownedTrip(db, tripId, user.id)

  const listing = await db.listing.findFirst({
    where: publiclyVisibleListingWhere({ id: listingId }),
    select: { id: true },
  })

  if (!listing) throw new NotFoundError("That listing is not available")

  return db.$transaction(async (tx) => {
    const last = await tx.tripItem.findFirst({
      where: { tripId },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    await tx.tripItem.create({
      data: {
        tripId,
        listingId,
        position: (last?.position ?? -1) + 1,
        plannedDate: plannedDate ? new Date(`${plannedDate}T00:00:00Z`) : null,
        note: note ?? null,
      },
    })

    const row = await tx.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: SELECT_TRIP,
    })

    return toRecord(row)
  })
}

export async function removeTripItem(
  input: unknown,
  deps: TripDeps = {}
): Promise<TripRecord> {
  const user = await requireUser(deps.session)
  const parsed = removeTripItemSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)
  const item = await db.tripItem.findFirst({
    where: { id: parsed.data.itemId, trip: { touristUserId: user.id } },
    select: { id: true, tripId: true },
  })

  if (!item) throw new NotFoundError("That item was not found")

  return db.$transaction(async (tx) => {
    await tx.tripItem.delete({ where: { id: item.id } })

    const row = await tx.trip.findUniqueOrThrow({
      where: { id: item.tripId },
      select: SELECT_TRIP,
    })

    return toRecord(row)
  })
}

/**
 * Puts a trip's items in the order given. `itemIds` must name every item of the
 * trip exactly once: a missing, extra or repeated id is refused and nothing
 * moves. The trip row is locked first, so two reorders cannot interleave, and
 * the positions are rewritten as 0..n-1 in one transaction, so there are never
 * gaps or duplicates.
 */
export async function reorderTripItems(
  input: unknown,
  deps: TripDeps = {}
): Promise<TripRecord> {
  const user = await requireUser(deps.session)
  const parsed = reorderTripSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = await resolveDb(deps)
  const { tripId, itemIds } = parsed.data

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${tripId} AND "touristUserId" = ${user.id} FOR UPDATE`

    const owned = await tx.trip.findFirst({
      where: { id: tripId, touristUserId: user.id },
      select: { id: true },
    })

    if (!owned) throw new NotFoundError("That trip was not found")

    const items = await tx.tripItem.findMany({
      where: { tripId },
      select: { id: true },
    })
    const current = new Set(items.map((item) => item.id))

    const complete =
      itemIds.length === current.size && itemIds.every((id) => current.has(id))

    if (!complete) {
      throw new ConflictError(
        "The trip changed while you were reordering it. Refresh and try again.",
        {
          details: { reason: "STALE_ORDER" },
        }
      )
    }

    for (const [position, id] of itemIds.entries()) {
      await tx.tripItem.update({ where: { id }, data: { position } })
    }

    const row = await tx.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: SELECT_TRIP,
    })

    return toRecord(row)
  })
}
