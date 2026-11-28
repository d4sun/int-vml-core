import type { PrismaClient } from "@prisma/client"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { ConflictError, NotFoundError } from "@/lib/errors"
import type { StripeAdapter } from "@/lib/stripe/adapter"
import { getEnvOrigin } from "@/lib/services/payment-origin"

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
  /** Public origin for the Stripe return pages; defaults to `BETTER_AUTH_URL`. */
  appUrl?: string
}

export type StartedPayment = {
  bookingId: string
  checkoutSessionId: string
  /** The Stripe-hosted page the visitor pays on. */
  checkoutUrl: string
  plan: ChargePlan
}

const DUPLICATE = "P2002"

/**
 * Starts the card payment for the signed-in visitor's pending booking through
 * Stripe Checkout (E2-S2-02, decided 2026-11-28).
 *
 * The session is created with the key `checkout:<bookingId>:<attempt>`, and a
 * booking holds at most one `Payment` (a unique column), so a repeated or racing
 * submit gets the same session and the same page address. Stripe's return
 * pages are the processing page, for success and for cancel: the page only
 * reads the booking's state; it never marks anything paid (CR-4).
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
      payment: { select: { stripeCheckoutSessionId: true, checkoutUrl: true } },
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

  const payment = booking.payment

  if (payment?.stripeCheckoutSessionId && payment.checkoutUrl) {
    return {
      bookingId,
      checkoutSessionId: payment.stripeCheckoutSessionId,
      checkoutUrl: payment.checkoutUrl,
      plan,
    }
  }

  const origin = deps.appUrl ?? (await getEnvOrigin())
  const returnPage = `${origin}/checkout/processing?booking=${bookingId}`
  const session = await stripe.createCheckoutSession(
    {
      amount: plan.amount,
      bookingId,
      description: `Booking ${bookingId.slice(0, 8).toUpperCase()}`,
      successUrl: returnPage,
      cancelUrl: `${returnPage}&cancelled=1`,
      ...(plan.mode === "DESTINATION"
        ? {
            destinationAccountId: plan.destinationAccountId,
            applicationFeeAmount: plan.applicationFeeAmount,
          }
        : { transferGroup: `booking:${bookingId}` }),
    },
    { idempotencyKey: `checkout:${bookingId}:${attempt}` }
  )

  try {
    await db.payment.create({
      data: {
        bookingId,
        stripeCheckoutSessionId: session.id,
        checkoutUrl: session.url,
        amount: plan.amount,
        status: "open",
        applicationFeeAmount:
          plan.mode === "DESTINATION" ? plan.applicationFeeAmount : 0,
      },
    })
  } catch (error) {
    if ((error as { code?: string }).code !== DUPLICATE) throw error

    // A racing attempt recorded its session first; use that one.
    const existing = await db.payment.findUniqueOrThrow({
      where: { bookingId },
    })

    return {
      bookingId,
      checkoutSessionId: existing.stripeCheckoutSessionId ?? session.id,
      checkoutUrl: existing.checkoutUrl ?? session.url,
      plan,
    }
  }

  return {
    bookingId,
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    plan,
  }
}
