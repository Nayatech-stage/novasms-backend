/*
  Warnings:

  - The `action` column on the `analytics` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `automations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `campaigns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `hour` on the `engagement_heatmap` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `SmallInt`.
  - The `role` column on the `invitations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `invitations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `jobs` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `sends` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `method` column on the `transactions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `transactions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `role` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[accountId,email]` on the table `contacts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[accountId,phone]` on the table `contacts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[campaignId,hour]` on the table `engagement_heatmap` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[campaignId,contactId]` on the table `sends` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `campaigns` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CampaignVariant" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "SendVariant" AS ENUM ('A', 'B', 'NONE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('PENDING', 'SENT', 'OPENED', 'CLICKED', 'BOUNCED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Admin', 'Editor', 'Analyst');

-- CreateEnum
CREATE TYPE "TransactionMethod" AS ENUM ('MobileMoney', 'Visa');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('Pending', 'Validated', 'Refused', 'Timeout');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('Active', 'Inactive', 'Draft');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('Sent', 'Accepted', 'Expired');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('Pending', 'Done', 'Failed', 'QueueError');

-- CreateEnum
CREATE TYPE "AnalyticAction" AS ENUM ('Open', 'Click', 'Unsubscribe', 'Bounce');

-- AlterTable
ALTER TABLE "analytics" DROP COLUMN "action",
ADD COLUMN     "action" "AnalyticAction";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "ipAddress" VARCHAR(45);

-- AlterTable
ALTER TABLE "automations" ADD COLUMN     "sendCount" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "status",
ADD COLUMN     "status" "AutomationStatus" NOT NULL DEFAULT 'Draft';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "abSplitPct" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "abTestDuration" INTEGER,
ADD COLUMN     "abWinner" "CampaignVariant",
ADD COLUMN     "bestSendTime" JSONB,
ADD COLUMN     "clickedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clickedCountA" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clickedCountB" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contentJson" JSONB,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deliveredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openedCountA" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openedCountB" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentCountA" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentCountB" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subjectA" VARCHAR(255),
ADD COLUMN     "subjectB" VARCHAR(255),
ADD COLUMN     "timezone" VARCHAR(50) NOT NULL DEFAULT 'Africa/Abidjan',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "engagement_heatmap" ALTER COLUMN "hour" SET DATA TYPE SMALLINT;

-- AlterTable
ALTER TABLE "invitations" DROP COLUMN "role",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'Editor',
DROP COLUMN "status",
ADD COLUMN     "status" "InvitationStatus" NOT NULL DEFAULT 'Sent';

-- AlterTable
ALTER TABLE "jobs" DROP COLUMN "status",
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "sends" ADD COLUMN     "bouncedReason" VARCHAR(255),
ADD COLUMN     "deliveredAt" TIMESTAMP,
ADD COLUMN     "variant" "SendVariant" NOT NULL DEFAULT 'NONE',
DROP COLUMN "status",
ADD COLUMN     "status" "SendStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "method",
ADD COLUMN     "method" "TransactionMethod",
DROP COLUMN "status",
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'Editor';

-- CreateTable
CREATE TABLE "ab_test_results" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variant" "CampaignVariant" NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "evaluatedAt" TIMESTAMP,

    CONSTRAINT "ab_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentNodeId" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ab_test_results_campaignId_variant_key" ON "ab_test_results"("campaignId", "variant");

-- CreateIndex
CREATE INDEX "workflow_executions_automationId_contactId_idx" ON "workflow_executions"("automationId", "contactId");

-- CreateIndex
CREATE INDEX "analytics_campaignId_action_idx" ON "analytics"("campaignId", "action");

-- CreateIndex
CREATE INDEX "analytics_contactId_createdAt_idx" ON "analytics"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "automations_accountId_status_idx" ON "automations"("accountId", "status");

-- CreateIndex
CREATE INDEX "campaigns_accountId_status_channelType_idx" ON "campaigns"("accountId", "status", "channelType");

-- CreateIndex
CREATE INDEX "campaigns_scheduledAt_idx" ON "campaigns"("scheduledAt");

-- CreateIndex
CREATE INDEX "campaigns_abWinner_idx" ON "campaigns"("abWinner");

-- CreateIndex
CREATE INDEX "click_heatmap_campaignId_idx" ON "click_heatmap"("campaignId");

-- CreateIndex
CREATE INDEX "consents_contactId_idx" ON "consents"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_accountId_email_key" ON "contacts"("accountId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_accountId_phone_key" ON "contacts"("accountId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_heatmap_campaignId_hour_key" ON "engagement_heatmap"("campaignId", "hour");

-- CreateIndex
CREATE INDEX "import_reports_accountId_createdAt_idx" ON "import_reports"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "invitations_accountId_status_idx" ON "invitations"("accountId", "status");

-- CreateIndex
CREATE INDEX "jobs_accountId_status_idx" ON "jobs"("accountId", "status");

-- CreateIndex
CREATE INDEX "sends_contactId_idx" ON "sends"("contactId");

-- CreateIndex
CREATE INDEX "sends_campaignId_variant_idx" ON "sends"("campaignId", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "sends_campaignId_contactId_key" ON "sends"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "templates_accountId_isPreset_idx" ON "templates"("accountId", "isPreset");

-- CreateIndex
CREATE INDEX "transactions_accountId_createdAt_idx" ON "transactions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "users_accountId_idx" ON "users"("accountId");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_test_results" ADD CONSTRAINT "ab_test_results_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
