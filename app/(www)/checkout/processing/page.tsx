import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { PaymentStatus } from "@/components/checkout/payment-status"
import { Button } from "@/components/ui/button"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/auth/guards"
import { UnauthenticatedError } from "@/lib/errors"
import { continuePaymentAction } from "../actions"

export const metadata: Metadata = {
  title: "Confirming your booking",
  robots: { index: false, follow: false },
}

/**
 * Where Stripe sends the visitor back, paid or cancelled. It shows what the
 * booking's state is and waits for the webhook; it never marks anything paid.
 */
export default async function ProcessingPage({
  searchParams,
}: {
  searchParams: Promise<{
    booking?: string
    cancelled?: string
    error?: string
  }>
}) {
  const { booking: bookingId, cancelled, error } = await searchParams

  if (!bookingId) notFound()

  const user = await requireUser().catch((e: unknown) => {
    if (e instanceof UnauthenticatedError)
      redirect(`/sign-in?next=/checkout/processing?booking=${bookingId}`)
    throw e
  })

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, touristUserId: user.id },
    select: { id: true, status: true },
  })

  if (!booking) notFound()

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold text-vml-ink">Your booking</h1>
      <div className="mt-6">
        <PaymentStatus bookingId={booking.id} initial={booking.status} />
      </div>

      {booking.status === "PENDING" && (cancelled || error) ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {error
            ? "We could not open the payment page. Try again."
            : "Payment was not completed."}
        </p>
      ) : null}

      {booking.status === "PENDING" ? (
        <form action={continuePaymentAction} className="mt-6">
          <input type="hidden" name="bookingId" value={booking.id} />
          <Button type="submit">Continue to payment</Button>
        </form>
      ) : null}
    </main>
  )
}
