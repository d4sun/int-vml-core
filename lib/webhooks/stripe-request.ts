import {
  handleStripeWebhook,
  type StripeWebhookDeps,
} from "@/lib/webhooks/stripe"

/** Stripe events are a few kilobytes; anything near this is not Stripe. */
export const MAX_WEBHOOK_BYTES = 1_000_000

const headers = { "Cache-Control": "no-store" }

/**
 * The HTTP layer of the Stripe webhook: reads the raw body (the signature
 * covers the exact bytes, so it is never parsed or re-serialised first) and
 * the `Stripe-Signature` header, and maps the result to a response. Bodies
 * carry a short machine code only, never an error message.
 */
export async function handleWebhookRequest(
  request: Request,
  deps: StripeWebhookDeps = {}
): Promise<Response> {
  const declared = Number(request.headers.get("content-length"))

  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return Response.json(
      { error: "payload_too_large" },
      { status: 413, headers }
    )
  }

  const rawBody = await request.text()

  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return Response.json(
      { error: "payload_too_large" },
      { status: 413, headers }
    )
  }

  const result = await handleStripeWebhook(
    rawBody,
    request.headers.get("stripe-signature"),
    deps
  )

  return Response.json(result.body, { status: result.status, headers })
}
