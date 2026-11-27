-- DropIndex
DROP INDEX "Availability_productId_startAt_idx";

-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "closed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Availability_productId_startAt_key" ON "Availability"("productId", "startAt");

