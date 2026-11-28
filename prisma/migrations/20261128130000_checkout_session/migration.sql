-- Stripe Checkout (decided 2026-11-28): Stripe creates the payment intent when
-- the visitor pays, so a payment starts with a checkout session and no intent
-- id yet. The session's hosted page address is kept so a retry reuses it.
ALTER TABLE "Payment" ALTER COLUMN "stripePaymentIntentId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "stripeCheckoutSessionId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "checkoutUrl" TEXT;
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");
