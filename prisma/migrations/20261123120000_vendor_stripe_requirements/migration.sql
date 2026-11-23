-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "stripeDisabledReason" TEXT,
ADD COLUMN     "stripeRequirementsDue" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stripeStatusAt" TIMESTAMP(3);

