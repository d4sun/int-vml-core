import type { PrismaClient } from "@prisma/client"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import type { StripeAdapter } from "@/lib/stripe/adapter"

/** One booking item as the charge needs it: which vendor, and the money split. */
export type PlannedItem = {
  vendorId: string
  /** The vendor's connected account; null until payout setup is complete. */
  stripeAccountId: string | null
  subtotal: number
  commissionAmount: number
}

export type ChargePlan =
  | {
      /** Single vendor: charged to the vendor's account; the platform keeps the commission. */
      mode: "DESTINATION"
      amount: number
      destinationAccountId: string
      applicationFeeAmount: number
      transfers: []
    }
  | {
      /** Several vendors: one charge to the platform; transfers to each vendor follow confirmation. */
      mode: "PLATFORM"
      amount: number
      transfers: { vendorId: string; stripeAccountId: string; amount: number }[]
    }

/**
 * How a booking is charged (decision D3, confirmed 2026-11-28):
 * - one vendor: a destination charge; the fee is the sum of the commissions;
 * - several vendors: one platform charge, with one planned transfer per vendor
 *   for its subtotal less its commission.
 * Pure: the caller supplies the items, so the rule is tested without Stripe.
 */
export function planCharge(items: PlannedItem[]): ChargePlan {
  if (items.length === 0)
    throw new ConflictError("Nothing to charge", {
      details: { reason: "EMPTY" },
    })

  for (const item of items) {
    if (!item.stripeAccountId) {
      throw new ConflictError("A vendor in this booking cannot be paid yet", {
        details: { reason: "VENDOR_NOT_PAYABLE", vendorId: item.vendorId },
      })
    }
  }

  const amount = items.reduce((sum, item) => sum + item.subtotal, 0)
  const vendors = new Map<string, { stripeAccountId: string; amount: number }>()

  for (const item of items) {
    const entry = vendors.get(item.vendorId) ?? {
      stripeAccountId: item.stripeAccountId!,
      amount: 0,
    }
    entry.amount += item.subtotal - item.commissionAmount
    vendors.set(item.vendorId, entry)
  }

  if (vendors.size === 1) {
    const [only] = [...vendors.values()]
    const applicationFeeAmount = items.reduce(
      (sum, item) => sum + item.commissionAmount,
      0
    )

    return {
      mode: "DESTINATION",
      amount,
      destinationAccountId: only!.stripeAccountId,
      applicationFeeAmount,
      transfers: [],
    }
  }

  return {
    mode: "PLATFORM",
    amount,
    transfers: [...vendors.entries()].map(([vendorId, entry]) => ({
      vendorId,
      stripeAccountId: entry.stripeAccountId,
      amount: entry.amount,
    })),
  }
}

export type StartPaymentDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "booking" | "payment">
  stripe?: StripeAdapter
}

export type StartedPayment = {
  bookingId: string
  stripePaymentIntentId: string
  clientSecret: string | null
  plan: ChargePlan
}

const DUPLICATE = "P2002"

/**
 * Starts the card payment for the signed-in visitor's pending booking (E2-S2-02).
 *
 * The Stripe call uses the key `checkout:<bookingId>:<attempt>`, so a repeated
 * submit of the same attempt returns the same intent (E2-S2-03, TC-E2S2-05).
 * The booking holds at most one `Payment`, enforced by a unique column, so a
 * second attempt that races the first finds the first and returns it.
 */
export async function startPayment(
  bookingId: string,
  attempt: number,
  deps: StartPaymentDeps = {}
): Promise<StartedPayment> {
  const user = await requireUser(deps.session)
  const db = deps.db ?? ((await import("@/lib/prisma")).prisma as PrismaClient)
  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()

  const booking = await db.booking.findFirst({
    where: { id: bookingId, touristUserId: user.id },
    select: {
      id: true,
      status: true,
      total: true,
      items: {
        select: {
          vendorId: true,
          subtotal: true,
          commissionAmount: true,
          vendor: { select: { stripeAccountId: true } },
        },
      },
      payment: { select: { stripePaymentIntentId: true } },
    },
  })

  if (!booking) throw new NotFoundError("That booking was not found")

  if (booking.status !== "PENDING") {
    throw new ConflictError("This booking can no longer be paid.", {
      details: { reason: "NOT_PAYABLE" },
    })
  }

  const plan = planCharge(
    booking.items.map((item) => ({
      vendorId: item.vendorId,
      stripeAccountId: item.vendor.stripeAccountId,
      subtotal: item.subtotal,
      commissionAmount: item.commissionAmount,
    }))
  )

  if (plan.amount !== booking.total) {
    throw new ConflictError("The booking total no longer matches its items.", {
      details: { reason: "TOTAL_MISMATCH" },
    })
  }

  if (booking.payment) {
    return {
      bookingId,
      stripePaymentIntentId: booking.payment.stripePaymentIntentId,
      clientSecret: null,
      plan,
    }
  }

  const intent = await stripe.createPaymentIntent(
    plan.mode === "DESTINATION"
      ? {
          amount: plan.amount,
          bookingId,
          destinationAccountId: plan.destinationAccountId,
          applicationFeeAmount: plan.applicationFeeAmount,
        }
      : {
          amount: plan.amount,
          bookingId,
          transferGroup: `booking:${bookingId}`,
        },
    { idempotencyKey: `checkout:${bookingId}:${attempt}` }
  )

  try {
    await db.payment.create({
      data: {
        bookingId,
        stripePaymentIntentId: intent.id,
        amount: plan.amount,
        status: intent.status,
        applicationFeeAmount:
          plan.mode === "DESTINATION" ? plan.applicationFeeAmount : 0,
      },
    })
  } catch (error) {
    if ((error as { code?: string }).code !== DUPLICATE) throw error

    // A racing attempt recorded its payment first; use that one.
    const existing = await db.payment.findUniqueOrThrow({
      where: { bookingId },
    })

    return {
      bookingId,
      stripePaymentIntentId: existing.stripePaymentIntentId,
      clientSecret: null,
      plan,
    }
  }

  return {
    bookingId,
    stripePaymentIntentId: intent.id,
    clientSecret: intent.clientSecret,
    plan,
  }
}
