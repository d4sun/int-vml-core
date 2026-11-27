import type { Prisma, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError, RateLimitedError } from "@/lib/errors"
import { placeHold, type PlacedHold } from "@/lib/services/hold"
import {
  CART_ADDS_PER_WINDOW,
  CART_WINDOW_MINUTES,
  removeCartItemSchema,
  updateCartItemSchema,
} from "@/lib/validation/cart"
import { placeHoldSchema } from "@/lib/validation/hold"

export type CartItem = {
  holdId: string
  availabilityId: string
  vendorId: string
  vendorName: string
  listingTitle: string
  listingSlug: string
  productName: string
  startAt: Date
  quantity: number
  /** Pence per place: the slot's own price if set, otherwise the product's. */
  unitPrice: number
  lineTotal: number
  expiresAt: Date
}

export type CartVendorGroup = {
  vendorId: string
  vendorName: string
  items: CartItem[]
  subtotal: number
}

export type Cart = {
  groups: CartVendorGroup[]
  /** Sum of every line, in pence. Computed here, never supplied by the caller. */
  total: number
  /** The soonest hold expiry, so the page can count down; null when empty. */
  expiresAt: Date | null
}

export type CartDeps = {
  session?: SessionSource
  db?: Pick<
    PrismaClient,
    "$transaction" | "hold" | "availability" | "$queryRaw"
  >
  now?: () => Date
  /** Schedules a hold's release (E2-S1-03); optional so tests need no job server. */
  scheduleExpiry?: (hold: PlacedHold) => Promise<unknown>
}

/** A visitor's active holds, with prices computed from the database. */
type HoldRow = Prisma.HoldGetPayload<{
  include: {
    availability: {
      include: {
        product: {
          include: {
            listing: {
              include: { vendor: { select: { id: true; name: true } } }
            }
          }
        }
      }
    }
  }
}>

/**
 * Groups cart lines by vendor, in the order the visitor added them, and works
 * out every price. Pure: the caller supplies the lines, so this is unit-tested
 * without a database.
 */
export function groupByVendor(items: CartItem[]): Cart {
  const groups = new Map<string, CartVendorGroup>()

  for (const item of items) {
    let group = groups.get(item.vendorId)

    if (!group) {
      group = {
        vendorId: item.vendorId,
        vendorName: item.vendorName,
        items: [],
        subtotal: 0,
      }
      groups.set(item.vendorId, group)
    }

    group.items.push(item)
    group.subtotal += item.lineTotal
  }

  const ordered = [...groups.values()]
  const total = ordered.reduce((sum, group) => sum + group.subtotal, 0)
  const expiries = items.map((item) => item.expiresAt.getTime())

  return {
    groups: ordered,
    total,
    expiresAt: expiries.length ? new Date(Math.min(...expiries)) : null,
  }
}

function toCartItem(row: HoldRow): CartItem {
  const product = row.availability.product
  const unitPrice = row.availability.priceOverride ?? product.basePrice

  return {
    holdId: row.id,
    availabilityId: row.availabilityId,
    vendorId: product.listing.vendor.id,
    vendorName: product.listing.vendor.name,
    listingTitle: product.listing.title,
    listingSlug: product.listing.slug,
    productName: product.name,
    startAt: row.availability.startAt,
    quantity: row.quantity,
    unitPrice,
    lineTotal: unitPrice * row.quantity,
    expiresAt: row.expiresAt,
  }
}

async function activeHolds(
  db: CartDeps["db"] & object,
  userId: string,
  now: Date
) {
  return (db as PrismaClient).hold.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    include: {
      availability: {
        include: {
          product: {
            include: {
              listing: {
                include: { vendor: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  })
}

/** The signed-in visitor's cart: their holds that have not expired. */
export async function getCart(deps: CartDeps = {}): Promise<Cart> {
  const user = await requireUser(deps.session)
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const now = deps.now?.() ?? new Date()

  const rows = await activeHolds(db as never, user.id, now)

  return groupByVendor(rows.map(toCartItem))
}

/**
 * Adds places to the cart: the same as placing a hold (E2-S1-02). A visitor
 * may add at most CART_ADDS_PER_WINDOW items in CART_WINDOW_MINUTES (CR-8);
 * the count comes from the holds themselves, so it survives restarts.
 */
export async function addToCart(
  input: unknown,
  deps: CartDeps = {}
): Promise<Cart> {
  const user = await requireUser(deps.session)
  const parsed = placeHoldSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const now = deps.now?.() ?? new Date()
  const since = new Date(now.getTime() - CART_WINDOW_MINUTES * 60 * 1000)

  const recent = await (db as PrismaClient).hold.count({
    where: { userId: user.id, createdAt: { gte: since } },
  })

  if (recent >= CART_ADDS_PER_WINDOW) {
    throw new RateLimitedError(undefined, { details: { reason: "CART_ADDS" } })
  }

  const hold = await placeHold(parsed.data, {
    session: deps.session,
    db: db as never,
    now: () => now,
  })

  if (deps.scheduleExpiry) await deps.scheduleExpiry(hold)

  return getCart({ ...deps, now: () => now })
}

/** Changes how many places a cart item holds. The expiry does not move. */
export async function updateCartItem(
  input: unknown,
  deps: CartDeps = {}
): Promise<Cart> {
  const user = await requireUser(deps.session)
  const parsed = updateCartItemSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = (deps.db ?? (await import("@/lib/prisma")).prisma) as PrismaClient
  const now = deps.now?.() ?? new Date()
  const { holdId, quantity } = parsed.data

  await db.$transaction(async (tx) => {
    const [hold] = await tx.$queryRaw<
      {
        id: string
        availabilityId: string
        quantity: number
        expiresAt: Date
        userId: string
      }[]
    >`
      SELECT "id", "availabilityId", "quantity", "expiresAt", "userId"
      FROM "Hold" WHERE "id" = ${holdId} FOR UPDATE
    `

    if (!hold || hold.userId !== user.id) {
      throw new NotFoundError("That item is not in your cart")
    }

    if (hold.expiresAt.getTime() <= now.getTime()) {
      throw new ConflictError(
        "That hold has run out. Add the time slot again.",
        {
          details: { reason: "EXPIRED" },
        }
      )
    }

    const delta = quantity - hold.quantity

    if (delta === 0) return

    const [slot] = await tx.$queryRaw<{ remaining: number }[]>`
      SELECT "remaining" FROM "Availability" WHERE "id" = ${hold.availabilityId} FOR UPDATE
    `

    if (delta > 0 && (slot?.remaining ?? 0) < delta) {
      throw new ConflictError(
        `Only ${slot?.remaining ?? 0} more place(s) left.`,
        {
          details: { reason: "NOT_ENOUGH", remaining: slot?.remaining ?? 0 },
        }
      )
    }

    await tx.availability.update({
      where: { id: hold.availabilityId },
      data: { remaining: { decrement: delta } },
    })
    await tx.hold.update({ where: { id: hold.id }, data: { quantity } })
  })

  return getCart({ ...deps, now: () => now })
}

/** Takes an item out of the cart and gives its places back. */
export async function removeFromCart(
  input: unknown,
  deps: CartDeps = {}
): Promise<Cart> {
  const user = await requireUser(deps.session)
  const parsed = removeCartItemSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = (deps.db ?? (await import("@/lib/prisma")).prisma) as PrismaClient
  const now = deps.now?.() ?? new Date()
  const { holdId } = parsed.data

  await db.$transaction(async (tx) => {
    const [hold] = await tx.$queryRaw<
      { id: string; availabilityId: string; quantity: number; userId: string }[]
    >`
      SELECT "id", "availabilityId", "quantity", "userId"
      FROM "Hold" WHERE "id" = ${holdId} FOR UPDATE
    `

    if (!hold || hold.userId !== user.id) {
      throw new NotFoundError("That item is not in your cart")
    }

    await tx.$queryRaw`SELECT 1 FROM "Availability" WHERE "id" = ${hold.availabilityId} FOR UPDATE`
    await tx.hold.delete({ where: { id: hold.id } })
    await tx.availability.update({
      where: { id: hold.availabilityId },
      data: { remaining: { increment: hold.quantity } },
    })
  })

  return getCart({ ...deps, now: () => now })
}
