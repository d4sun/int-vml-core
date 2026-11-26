import type { Prisma, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser } from "@/lib/auth/guards"
import { getAvailabilityModule } from "@/lib/availability/timed-slot"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import { assertVendorApproved } from "@/lib/services/listing"
import {
  editableOrThrow,
  loadOwnedProduct,
  productContext,
  type ProductDeps,
} from "@/lib/services/product"
import {
  createSlotsSchema,
  deleteSlotSchema,
  listSlotsSchema,
  setSlotClosedSchema,
  updateSlotSchema,
} from "@/lib/validation/slot"

export type SlotRecord = {
  id: string
  productId: string
  startAt: Date
  endAt: Date
  capacity: number
  remaining: number
  /** Places taken (booked or held): `capacity - remaining`. */
  committed: number
  priceOverride: number | null
  closed: boolean
  /** Started already: read-only history. */
  past: boolean
}

export type SlotDeps = Omit<ProductDeps, "db"> & {
  db?: Pick<
    PrismaClient,
    | "listing"
    | "vendor"
    | "category"
    | "vendorMember"
    | "product"
    | "bookingItem"
    | "availability"
    | "hold"
    | "$transaction"
  >
  /** The clock, so tests can pin "now". */
  now?: () => Date
}

const SELECT = {
  id: true,
  productId: true,
  startAt: true,
  endAt: true,
  capacity: true,
  remaining: true,
  priceOverride: true,
  closed: true,
} as const

type Row = {
  id: string
  productId: string
  startAt: Date
  endAt: Date
  capacity: number
  remaining: number
  priceOverride: number | null
  closed: boolean
}

const toRecord = (row: Row, now: Date): SlotRecord => ({
  ...row,
  committed: row.capacity - row.remaining,
  past: row.startAt.getTime() <= now.getTime(),
})

async function setup(deps: SlotDeps) {
  const ctx = await productContext(deps as ProductDeps)

  return {
    ...ctx,
    db: (deps.db ?? ctx.db) as NonNullable<SlotDeps["db"]>,
    now: (deps.now ?? (() => new Date()))(),
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function lock(
  tx: Prisma.TransactionClient,
  table: "Product" | "Availability",
  id: string
) {
  if (table === "Product") {
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`
  } else {
    await tx.$queryRaw`SELECT "id" FROM "Availability" WHERE "id" = ${id} FOR UPDATE`
  }
}

/** The caller's own vendor's slot; a missing slot and another vendor's look alike. */
async function loadOwnedSlot(id: string, ctx: Ctx) {
  const row = await ctx.db.availability.findUnique({
    where: { id },
    select: SELECT,
  })

  if (!row) throw new ForbiddenError()

  const { product, listing } = await loadOwnedProduct(row.productId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  return { row, product }
}

function pastOrThrow(row: Row, now: Date) {
  if (row.startAt.getTime() <= now.getTime()) {
    throw new ConflictError(
      "This slot has already started and can no longer be changed.",
      {
        details: { reason: "PAST_SLOT" },
      }
    )
  }
}

export type CreateSlotsResult = {
  created: number
  /** Already there at exactly that start time: left as they were. */
  merged: number
  /** In the past, so not created. */
  skippedPast: number
  /** New slots that overlap a different existing slot of this product. */
  overlapping: Date[]
}

/**
 * Creates the slots a rule describes for the caller's own product. Slots that
 * would start in the past are skipped; one at exactly the same start time as
 * an existing slot is **merged** (the existing one is kept untouched, so a
 * repeat of the same request changes nothing); a new slot that overlaps a
 * *different* existing slot is created but **reported**. Concurrent requests
 * for the same product are serialised, and the database refuses two slots at
 * one start time as a last line of defence.
 */
export async function createSlots(
  input: unknown,
  deps: SlotDeps = {}
): Promise<CreateSlotsResult> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = createSlotsSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { productId } = parsed.data
  const { product, listing } = await loadOwnedProduct(productId, ctx)

  await assertVendorApproved(ctx.db, listing.vendorId)
  editableOrThrow(listing.status)

  const slotModule = getAvailabilityModule("TIMED_SLOT")
  const generated = slotModule.generate(slotModule.parseRule(parsed.data.rule))
  const future = generated.filter(
    (s) => s.startAt.getTime() > ctx.now.getTime()
  )
  const skippedPast = generated.length - future.length

  if (future.length === 0) {
    throw new ValidationError("Please check the highlighted fields.", {
      rule: ["Those times have already passed"],
    })
  }

  const first = future[0]!.startAt
  const last = future[future.length - 1]!.endAt

  return ctx.db.$transaction(async (tx) => {
    await lock(tx, "Product", product.id)

    const existing = await tx.availability.findMany({
      where: {
        productId: product.id,
        startAt: { lt: last },
        endAt: { gt: first },
      },
      select: { startAt: true, endAt: true },
    })
    const sameStart = new Set(existing.map((e) => e.startAt.getTime()))
    const fresh = future.filter((s) => !sameStart.has(s.startAt.getTime()))
    const overlapping = fresh
      .filter((s) =>
        existing.some(
          (e) =>
            e.startAt < s.endAt &&
            e.endAt > s.startAt &&
            e.startAt.getTime() !== s.startAt.getTime()
        )
      )
      .map((s) => s.startAt)

    const { count } = await tx.availability.createMany({
      data: fresh.map((s) => ({
        productId: product.id,
        startAt: s.startAt,
        endAt: s.endAt,
        capacity: s.capacity,
        remaining: s.remaining,
      })),
      skipDuplicates: true,
    })

    return {
      created: count,
      merged: future.length - fresh.length + (fresh.length - count),
      skippedPast,
      overlapping,
    }
  })
}

/**
 * Changes a future slot's capacity or price override. A past slot is
 * read-only. Capacity cannot drop below the places already taken, and the
 * places left follow it, all under a row lock so a booking made at the same
 * moment is never lost.
 */
export async function updateSlot(
  input: unknown,
  deps: SlotDeps = {}
): Promise<SlotRecord> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = updateSlotSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id, ...changes } = parsed.data

  await loadOwnedSlot(id, ctx)

  return ctx.db.$transaction(async (tx) => {
    await lock(tx, "Availability", id)

    const row = await tx.availability.findUnique({
      where: { id },
      select: SELECT,
    })

    if (!row) throw new ForbiddenError()

    pastOrThrow(row, ctx.now)

    const committed = row.capacity - row.remaining
    const capacity = changes.capacity ?? row.capacity

    if (capacity < committed) {
      throw new ConflictError(
        `${committed} ${committed === 1 ? "place is" : "places are"} already taken, so the capacity cannot go below ${committed}.`,
        { details: { reason: "BELOW_COMMITTED", committed } }
      )
    }

    const priceOverride =
      changes.priceOverride === undefined
        ? row.priceOverride
        : changes.priceOverride

    if (capacity === row.capacity && priceOverride === row.priceOverride) {
      return toRecord(row, ctx.now)
    }

    return toRecord(
      await tx.availability.update({
        where: { id },
        data: { capacity, remaining: capacity - committed, priceOverride },
        select: SELECT,
      }),
      ctx.now
    )
  })
}

/** Closes or reopens a future slot. Existing bookings are untouched. */
export async function setSlotClosed(
  input: unknown,
  deps: SlotDeps = {}
): Promise<SlotRecord> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = setSlotClosedSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id, closed } = parsed.data

  await loadOwnedSlot(id, ctx)

  return ctx.db.$transaction(async (tx) => {
    await lock(tx, "Availability", id)

    const row = await tx.availability.findUnique({
      where: { id },
      select: SELECT,
    })

    if (!row) throw new ForbiddenError()

    pastOrThrow(row, ctx.now)

    if (row.closed === closed) return toRecord(row, ctx.now)

    return toRecord(
      await tx.availability.update({
        where: { id },
        data: { closed },
        select: SELECT,
      }),
      ctx.now
    )
  })
}

/**
 * Deletes a future slot nobody has booked or is holding. A slot with places
 * taken, or with a live hold, cannot be deleted, only closed (TC-E5S2-02);
 * a past slot is history and stays.
 */
export async function deleteSlot(
  input: unknown,
  deps: SlotDeps = {}
): Promise<{ id: string }> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = deleteSlotSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id } = parsed.data

  await loadOwnedSlot(id, ctx)

  return ctx.db.$transaction(async (tx) => {
    await lock(tx, "Availability", id)

    const row = await tx.availability.findUnique({
      where: { id },
      select: SELECT,
    })

    if (!row) throw new ForbiddenError()

    pastOrThrow(row, ctx.now)

    const [bookings, holds] = await Promise.all([
      tx.bookingItem.count({ where: { availabilityId: id } }),
      tx.hold.count({
        where: { availabilityId: id, expiresAt: { gt: ctx.now } },
      }),
    ])

    if (bookings > 0 || row.capacity - row.remaining > 0 || holds > 0) {
      throw new ConflictError(
        "This slot has bookings or is being booked, so it cannot be deleted. Close it instead.",
        {
          details: {
            reason:
              bookings > 0 || row.capacity > row.remaining
                ? "HAS_BOOKINGS"
                : "HAS_HOLDS",
            bookings,
            holds,
          },
        }
      )
    }

    await tx.availability.delete({ where: { id } })

    return { id }
  })
}

/** A product's slots, soonest first; past ones only when asked for. */
export async function listSlots(
  input: unknown,
  deps: SlotDeps = {}
): Promise<SlotRecord[]> {
  const ctx = await setup(deps)

  await requireUser(ctx.session)

  const parsed = listSlotsSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { product } = await loadOwnedProduct(parsed.data.productId, ctx)
  const rows = await ctx.db.availability.findMany({
    where: {
      productId: product.id,
      ...(parsed.data.includePast ? {} : { startAt: { gt: ctx.now } }),
    },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    take: 500,
    select: SELECT,
  })

  return rows.map((row) => toRecord(row, ctx.now))
}
