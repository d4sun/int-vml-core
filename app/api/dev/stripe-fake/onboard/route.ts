import { getFakeStripe } from "@/lib/stripe"
import { isStripeAccountNotFoundError } from "@/lib/stripe/adapter"
import type { FakeStripe } from "@/lib/stripe/fake"
import {
  FAKE_ONBOARDING_OUTCOMES,
  applyFakeOutcome,
  isSafeReturn,
  renderFakeOnboardingPage,
  type FakeOnboardingOutcome,
} from "@/lib/stripe/fake-onboarding"
import { handleStripeWebhook } from "@/lib/webhooks/stripe"

// Development only: the stand-in for Stripe's hosted onboarding page. It
// exists only while the in-memory fake is the Stripe adapter, which the
// factory refuses to select in production, so with real Stripe it is a 404.
const notFoundResponse = () => new Response(null, { status: 404 })

function fake(): FakeStripe | null {
  return getFakeStripe()
}

export function GET(request: Request) {
  if (!fake()) return notFoundResponse()

  const { searchParams, origin } = new URL(request.url)
  const account = searchParams.get("account")
  const returnUrl = searchParams.get("return")
  const refreshUrl = searchParams.get("refresh")

  if (!account || !isSafeReturn(returnUrl, origin) || !refreshUrl) {
    return new Response("Bad request", { status: 400 })
  }

  return new Response(
    renderFakeOnboardingPage({ account, returnUrl: returnUrl!, refreshUrl }),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  )
}

export async function POST(request: Request) {
  const stripe = fake()

  if (!stripe) return notFoundResponse()

  const form = await request.formData()
  const account = String(form.get("account") ?? "")
  const returnUrl = String(form.get("return") ?? "")
  const outcome = String(form.get("outcome") ?? "")
  const { origin } = new URL(request.url)

  if (
    !account ||
    !isSafeReturn(returnUrl, origin) ||
    !FAKE_ONBOARDING_OUTCOMES.includes(outcome as FakeOnboardingOutcome)
  ) {
    return new Response("Bad request", { status: 400 })
  }

  try {
    const event = applyFakeOutcome(
      stripe,
      account,
      outcome as FakeOnboardingOutcome
    )

    // Deliver the event through the real webhook path, as Stripe would.
    if (event) {
      const result = await handleStripeWebhook(event.rawBody, event.signature)

      if (result.status !== 200) {
        return new Response("Webhook failed", { status: 500 })
      }
    }
  } catch (error) {
    if (isStripeAccountNotFoundError(error)) return notFoundResponse()

    throw error
  }

  return Response.redirect(returnUrl, 303)
}
