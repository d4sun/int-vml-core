import type { Prisma, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { assertVendorCanSell } from "@/lib/catalog/visibility"
import { effectiveCommissionBps } from "@/lib/commission/rate"
import { ConflictError, NotFoundError } from "@/lib/errors"
import { commissionAmount } from "@/lib/money/commission"
import { HOLD_TTL_MINUTES } from "@/lib/validation/hold"
import { checkoutSchema } from "@/lib/validation/checkout"

export type CheckoutDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction">
  now?: () => Date
  /**
   * Test seam: called before each item is written, so a test can make one
   * write fail and prove the whole checkout rolls back (IT-04).
   */
  beforeItemWrite?: (index: number) => void
}

export type CheckoutResult = {
  bookingId: string
  /** Pence: the sum of every item's subtotal, computed here. */
  total: number
  items: { vendorId: string; subtotal: number; commissionAmount: number }[]
  /** How many expired holds were taken again because the places were still free. */
  reheld: number
}

/** Booking cutoff in hours from the product's policy; missing or invalid reads as 0. */
function cutoffOf(policy: unknown): number {
  const hours = (policy as { bookingCutoffHours?: unknown } | null)
    ?.bookingCutoffHours

  return typeof hours === "number" && Number.isFinite(hours) ? hours : 0
}

type Priced = {
  availabilityId: string
  productId: string
  vendorId: string
  quantity: number
  unitPrice: number
  subtotal: number
  commissionAmount: number
}

/**
 * Turns the visitor's cart (their holds) into a PENDING booking, atomically.
 *
 * - Every hold must be the visitor's own, else "not in your cart".
 * - Each item's vendor must be able to sell right now (`assertVendorCanSell`);
 *   otherwise the whole checkout is refused with the reason.
 * - A hold whose time has run out is taken again if its places are still free
 *   (its old places are returned first, so nothing is counted twice); if they
 *   are not, the checkout says "just sold out" and nothing is booked.
 * - Prices, the vendor and the commission come from the database (IT-19,
 *   TC-E2S2-06). The booking total is the sum of the items.
 * - The booking, its items, and the removal of the holds that became items
 *   are one transaction: an item that fails to write undoes everything (IT-04).
 *
 * The booking is PENDING until payment is confirmed (E2-S2-02, E2-S3).
 */
export async function checkout(
  input: unknown,
  deps: CheckoutDeps = {}
): Promise<CheckoutResult> {
  const user = await requireUser(deps.session)
  const parsed = checkoutSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const now = deps.now?.() ?? new Date()
  const expiry = new Date(now.getTime() + HOLD_TTL_MINUTES * 60 * 1000)

  return db.$transaction(async (tx) => {
    const priced: Priced[] = []
    let reheld = 0

    for (const holdId of parsed.data.holdIds) {
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
        throw new NotFoundError("One of those items is not in your cart")
      }

      // Lock the slot as every other writer does (holds, releases), so a checkout
      // and a hold on the same slot are serialised.
      await tx.$queryRaw`SELECT 1 FROM "Availability" WHERE "id" = ${hold.availabilityId} FOR UPDATE`

      const quantity = hold.quantity

      // An expired hold that still exists still holds its places (the release
      // job removes the row and returns them, and both lock the row). So taking
      // it again only means extending its time; there is no seat to check.
      if (hold.expiresAt.getTime() <= now.getTime()) {
        await tx.hold.update({
          where: { id: hold.id },
          data: { expiresAt: expiry },
        })
        reheld += 1
      }

      const row = await tx.availability.findUniqueOrThrow({
        where: { id: hold.availabilityId },
        select: {
          id: true,
          startAt: true,
          closed: true,
          priceOverride: true,
          product: {
            select: {
              id: true,
              basePrice: true,
              active: true,
              policy: true,
              listing: {
                select: {
                  vendorId: true,
                  category: { select: { commissionBpsDefault: true } },
                  vendor: { select: { commissionBpsOverride: true } },
                },
              },
            },
          },
        },
      })

      if (!row.product.active || row.closed) {
        throw new ConflictError("That time is no longer available to book.", {
          details: { reason: "CLOSED" },
        })
      }

      const cutoffHours = cutoffOf(row.product.policy)

      if (
        row.startAt.getTime() <=
        now.getTime() + cutoffHours * 60 * 60 * 1000
      ) {
        throw new ConflictError(
          "That time is too close to its start to book.",
          {
            details: { reason: "PAST_CUTOFF" },
          }
        )
      }

      // The vendor must be able to sell right now (CR-1 for money: the gate, not the UI).
      await assertVendorCanSell(row.product.listing.vendorId, tx)

      const unitPrice = row.priceOverride ?? row.product.basePrice
      const subtotal = unitPrice * quantity
      const { bps } = effectiveCommissionBps({
        vendorOverrideBps: row.product.listing.vendor.commissionBpsOverride,
        categoryDefaultBps: row.product.listing.category.commissionBpsDefault,
      })

      priced.push({
        availabilityId: row.id,
        productId: row.product.id,
        vendorId: row.product.listing.vendorId,
        quantity,
        unitPrice,
        subtotal,
        commissionAmount: commissionAmount(subtotal, bps),
      })
    }

    const total = priced.reduce((sum, item) => sum + item.subtotal, 0)

    const booking = await tx.booking.create({
      data: { touristUserId: user.id, status: "PENDING", total },
      select: { id: true },
    })

    for (const [index, item] of priced.entries()) {
      deps.beforeItemWrite?.(index)

      await tx.bookingItem.create({
        data: {
          bookingId: booking.id,
          productId: item.productId,
          availabilityId: item.availabilityId,
          vendorId: item.vendorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
          commissionAmount: item.commissionAmount,
        } satisfies Prisma.BookingItemUncheckedCreateInput,
      })
    }

    // The holds are now booked places: remove them so the expiry job has nothing to give back.
    await tx.hold.deleteMany({
      where: { id: { in: parsed.data.holdIds }, userId: user.id },
    })

    return {
      bookingId: booking.id,
      total,
      items: priced.map((item) => ({
        vendorId: item.vendorId,
        subtotal: item.subtotal,
        commissionAmount: item.commissionAmount,
      })),
      reheld,
    }
  })
}
