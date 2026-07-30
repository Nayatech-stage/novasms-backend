/*
  Warnings:

  - You are about to drop the column `estimatedRecipients` on the `campaigns` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE 'AUTOMATION';

-- AlterTable
ALTER TABLE "automations" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "triggerConfig" JSONB,
ADD COLUMN     "triggerType" VARCHAR(100) NOT NULL DEFAULT 'contact_added',
ALTER COLUMN "channel" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "campaigns" DROP COLUMN "estimatedRecipients";

-- AlterTable
ALTER TABLE "workflow_executions" ADD COLUMN     "context" JSONB;

-- CreateIndex
CREATE INDEX "automations_campaignId_idx" ON "automations"("campaignId");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
