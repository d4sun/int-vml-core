import { handleAccountUpdated } from "./account-updated"
import { handleDispute } from "./dispute"
import { handlePaymentSucceeded } from "./payment-succeeded"
import { handleRefundUpdated } from "./refund-updated"
import type { StripeHandlerTable } from "./stripe"

/**
 * The dispatch table for the Stripe webhook endpoint. Each story that needs a
 * Stripe event adds its handler here (payment and refund events for checkout
 * and refunds), so the endpoint itself never changes.
 */
export const stripeHandlers: StripeHandlerTable = {
  "account.updated": handleAccountUpdated,
  "payment_intent.succeeded": handlePaymentSucceeded,
  "refund.updated": handleRefundUpdated,
  "charge.dispute.created": handleDispute,
  "charge.dispute.updated": handleDispute,
  "charge.dispute.closed": handleDispute,
}
