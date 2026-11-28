-- A transfer is recorded when a booking is confirmed, and sent to Stripe later
-- (E2-S3-02). Until Stripe answers it has no id, and a failure keeps its reason.
ALTER TABLE "Transfer" ALTER COLUMN "stripeTransferId" DROP NOT NULL;
ALTER TABLE "Transfer" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "settledAt" TIMESTAMP(3);
