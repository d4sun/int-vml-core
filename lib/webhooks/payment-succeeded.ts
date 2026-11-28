import type { Prisma } from "@prisma/client"
import { z } from "zod"
import {
  bookingConfirmedEmail,
  newBookingEmail,
  type BookingEmailLine,
} from "@/lib/email/templates"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { EmailMessage } from "@/lib/email/types"
import { deterministicUuid } from "@/lib/jobs/deterministic-id"
import { audit } from "@/lib/services/audit"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"
import type { StripeEventHandler } from "@/lib/webhooks/stripe"

/** The parts of Stripe's PaymentIntent this handler reads. */
const intentSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  metadata: z.object({ bookingId: z.string().min(1) }).nullish(),
})

/**
 * `payment_intent.succeeded` (CR-4: the webhook decides, not the browser).
 *
 * Runs inside the event's own transaction (see `handleStripeWebhook`), so a
 * repeat of the same event is recorded once and never reaches this code twice.
 * The payment and its booking are changed only if they are still in their
 * pending state, so a late or out-of-order event cannot undo a later decision.
 *
 * - The booking and its items become CONFIRMED. The places were taken when the
 *   hold was made, so nothing is decremented here (the holds were removed at
 *   checkout).
 * - An amount that does not match what we asked for is recorded and not
 *   confirmed, so money that did not come from this booking never confirms it.
 * - A payment that is recorded after the booking was cancelled (its unpaid
 *   window passed) is written to the audit log for review, not confirmed.
 * - A payment we have no record of yet is an error, so Stripe retries the
 *   event once our own write has committed.
 */
export type PaymentSucceededDeps = {
  /** The queue the booking emails go to; defaults to the app's transactional queue. */
  emailQueue?: TransactionalEmailQueue
  /** Public origin for email links; defaults to `BETTER_AUTH_URL`. */
  appUrl?: string
}

/** The handler, with its email queue and origin injectable for tests. */
export function paymentSucceededHandler(
  deps: PaymentSucceededDeps = {}
): StripeEventHandler {
  return (event, tx) => confirmPayment(event, tx, deps)
}

/** The handler as registered in the webhook table. */
export const handlePaymentSucceeded: StripeEventHandler = (event, tx) =>
  confirmPayment(event, tx, {})

async function confirmPayment(
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient,
  deps: PaymentSucceededDeps
): Promise<void> {
  const intent = intentSchema.parse(event.data.object)

  const [payment] = await tx.$queryRaw<
    { id: string; bookingId: string; amount: number; status: string }[]
  >`
    SELECT "id", "bookingId", "amount", "status"
    FROM "Payment" WHERE "stripePaymentIntentId" = ${intent.id} FOR UPDATE
  `

  if (!payment) {
    throw new Error(
      `payment ${intent.id} is not recorded yet; Stripe will retry`
    )
  }

  if (payment.status === "succeeded") return

  if (payment.amount !== intent.amount) {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "amount_mismatch" },
    })
    await audit.record(tx, {
      actorId: null,
      action: "payment.amount_mismatch",
      entityType: "Payment",
      entityId: payment.id,
      meta: { expected: payment.amount, received: intent.amount },
    })

    return
  }

  const [booking] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT "id", "status" FROM "Booking" WHERE "id" = ${payment.bookingId} FOR UPDATE
  `

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "succeeded" },
  })

  if (booking?.status !== "PENDING") {
    await audit.record(tx, {
      actorId: null,
      action: "booking.paid_after_close",
      entityType: "Booking",
      entityId: payment.bookingId,
      meta: { status: booking?.status ?? null, paymentIntentId: intent.id },
    })

    return
  }

  await tx.booking.update({
    where: { id: payment.bookingId },
    data: { status: "CONFIRMED" },
  })
  await tx.bookingItem.updateMany({
    where: { bookingId: payment.bookingId, status: "PENDING" },
    data: { status: "CONFIRMED" },
  })

  // Several vendors: the platform holds the money, so each item's share (its
  // subtotal less its commission) is recorded as a pending transfer. The
  // transfers are sent to Stripe afterwards, never from inside this handler
  // (E2-S3-02). A single-vendor booking is a destination charge: nothing to split.
  const items = await tx.bookingItem.findMany({
    where: { bookingId: payment.bookingId },
    select: {
      id: true,
      vendorId: true,
      subtotal: true,
      commissionAmount: true,
    },
  })

  if (new Set(items.map((item) => item.vendorId)).size > 1) {
    await tx.transfer.createMany({
      data: items.map((item) => ({
        bookingItemId: item.id,
        amount: item.subtotal - item.commissionAmount,
        status: "pending",
      })),
    })
  }

  await queueBookingEmails(tx, payment.bookingId, deps)
}

const LONDON = (date: Date) =>
  date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  })

const bookingRef = (bookingId: string) => bookingId.slice(0, 8).toUpperCase()

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

/**
 * The tourist's confirmation, and one new-booking notice per vendor owner
 * (E2-S3-03). They are queued in this transaction, so a queue failure undoes
 * the confirmation too (CR-7), and each email has its own id, so a repeated
 * event cannot send it twice.
 */
async function queueBookingEmails(
  tx: Prisma.TransactionClient,
  bookingId: string,
  deps: PaymentSucceededDeps
): Promise<void> {
  const queue =
    deps.emailQueue ??
    (await (
      await import("@/lib/jobs/transactional")
    ).getTransactionalEmailQueue())
  const appUrl = (
    deps.appUrl ?? (await import("@/lib/env")).getEnv().BETTER_AUTH_URL
  ).replace(/\/+$/, "")

  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      total: true,
      tourist: { select: { name: true, email: true } },
      items: {
        select: {
          vendorId: true,
          quantity: true,
          availability: { select: { startAt: true } },
          product: {
            select: {
              name: true,
              listing: {
                select: { title: true, vendor: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  })

  const line = (item: (typeof booking.items)[number]): BookingEmailLine => ({
    title: `${item.product.listing.title}: ${item.product.name}`,
    when: LONDON(item.availability.startAt),
    places: item.quantity,
  })

  const send = async (message: EmailMessage, id: string) => {
    await queue.enqueueInTransaction(tx, message, id)
  }

  const confirmed = bookingConfirmedEmail({
    name: booking.tourist.name,
    bookingRef: bookingRef(booking.id),
    total: pounds(booking.total),
    lines: booking.items.map(line),
    bookingsUrl: `${appUrl}/account/bookings`,
  })

  await send(
    {
      to: booking.tourist.email,
      subject: confirmed.subject,
      html: confirmed.html,
      text: confirmed.text,
      tags: { kind: "booking-confirmed" },
    },
    deterministicUuid(
      `booking-confirmed:${booking.id}:${booking.tourist.email.toLowerCase()}`
    )
  )

  const vendorIds = [...new Set(booking.items.map((item) => item.vendorId))]

  for (const vendorId of vendorIds) {
    const items = booking.items.filter((item) => item.vendorId === vendorId)
    const vendorName = items[0]!.product.listing.vendor.name
    const owners = await tx.vendorMember.findMany({
      where: { vendorId, role: "OWNER" },
      select: { user: { select: { name: true, email: true } } },
    })

    for (const { user } of owners) {
      const notice = newBookingEmail({
        name: user.name,
        vendorName,
        bookingRef: bookingRef(booking.id),
        lines: items.map(line),
        dashboardUrl: `${appUrl}/vendor/listings`,
      })

      await send(
        {
          to: user.email,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          tags: { kind: "new-booking" },
        },
        deterministicUuid(
          `new-booking:${booking.id}:${vendorId}:${user.email.toLowerCase()}`
        )
      )
    }
  }
}
