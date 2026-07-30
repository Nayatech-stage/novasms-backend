/*
  Warnings:

  - A unique constraint covering the columns `[key]` on the table `templates` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `key` to the `templates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `templates` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "avatarUrl" VARCHAR(512),
ADD COLUMN     "logoUrl" VARCHAR(512);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "userAgent" VARCHAR(512);

-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "contentText" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" VARCHAR(255),
ADD COLUMN     "key" VARCHAR(255) NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "variables" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" VARCHAR(512),
ADD COLUMN     "firstName" VARCHAR(100),
ADD COLUMN     "lastName" VARCHAR(100);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerType" VARCHAR(50) NOT NULL,
    "providerName" VARCHAR(50) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "emailOnCampaignDone" BOOLEAN NOT NULL DEFAULT true,
    "emailOnLowCredits" BOOLEAN NOT NULL DEFAULT true,
    "emailOnTeamInvite" BOOLEAN NOT NULL DEFAULT true,
    "smsOnCampaignDone" BOOLEAN NOT NULL DEFAULT false,
    "smsOnLowCredits" BOOLEAN NOT NULL DEFAULT true,
    "creditAlertThreshold" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_configs_accountId_providerType_idx" ON "provider_configs"("accountId", "providerType");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_accountId_providerType_providerName_key" ON "provider_configs"("accountId", "providerType", "providerName");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_accountId_key" ON "notification_prefs"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "templates_key_key" ON "templates"("key");

-- AddForeignKey
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
