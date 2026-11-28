import { getFakeStripe } from "@/lib/stripe"
import { renderFakeCheckoutPage } from "@/lib/stripe/fake-checkout"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"

// Development only: the stand-in for Stripe's hosted Checkout page. It exists only
// while the in-memory fake is the Stripe adapter; with real Stripe it is a 404.
const notFound = () => new Response(null, { status: 404 })

export async function GET(request: Request) {
  const stripe = getFakeStripe()

  if (!stripe) return notFound()

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("session") ?? ""
  const session = stripe.checkoutSessions.get(id)

  if (!session) return notFound()

  const outcome = searchParams.get("outcome")

  if (outcome === null) {
    return new Response(
      renderFakeCheckoutPage({ session: id, amountPence: session.amount }),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    )
  }

  if (outcome === "paid") {
    // Deliver the payment through the real webhook path, as Stripe would.
    const event = stripe.paidEventFor(id)
    const result = await handleStripeWebhook(event.rawBody, event.signature)

    if (result.status !== 200)
      return new Response("Webhook failed", { status: 500 })

    return Response.redirect(session.successUrl, 303)
  }

  if (outcome === "cancel") return Response.redirect(session.cancelUrl, 303)

  return new Response("Bad request", { status: 400 })
}
