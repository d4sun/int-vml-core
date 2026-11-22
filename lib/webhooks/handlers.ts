import type { StripeHandlerTable } from "./stripe"

/**
 * The dispatch table for the Stripe webhook endpoint. Each story that needs a
 * Stripe event adds its handler here (`account.updated` for onboarding,
 * payment and refund events for checkout), so the endpoint itself never
 * changes.
 */
export const stripeHandlers: StripeHandlerTable = {}
