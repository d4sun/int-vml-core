import { handleWebhookRequest } from "@/lib/webhooks/stripe-request"

// Stripe posts events here. The signature is checked on the raw body before
// anything is parsed (see `lib/webhooks/stripe.ts`); the route holds no logic.
export function POST(request: Request) {
  return handleWebhookRequest(request)
}
