/*
  Warnings:

  - You are about to drop the column `campagneId` on the `analytics` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `analytics` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `utilisateurId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `dateAjout` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `nom` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `prenom` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `telephone` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `invitations` table. All the data in the column will be lost.
  - You are about to drop the column `expiry` on the `invitations` table. All the data in the column will be lost.
  - You are about to drop the column `statut` on the `invitations` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `jobs` table. All the data in the column will be lost.
  - You are about to drop the column `dateCreation` on the `jobs` table. All the data in the column will be lost.
  - You are about to drop the column `dateFin` on the `jobs` table. All the data in the column will be lost.
  - You are about to drop the column `statut` on the `jobs` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `segments` table. All the data in the column will be lost.
  - You are about to drop the column `criteres` on the `segments` table. All the data in the column will be lost.
  - You are about to drop the column `dernierCalcul` on the `segments` table. All the data in the column will be lost.
  - You are about to drop the column `nom` on the `segments` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `contenuHTML` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `estPreset` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `nom` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `typeCanal` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `compteId` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `methode` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `montant` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `statut` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the `automatisations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `campagnes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `comptes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `consentements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `envois` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `factures` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `heatmap_clicks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `heatmap_engagement` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rapports_import` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `utilisateurs` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `accountId` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `contacts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `invitations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expiresAt` to the `invitations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `invitations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `jobs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `jobs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `segments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `templates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "analytics" DROP CONSTRAINT "analytics_campagneId_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_compteId_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_utilisateurId_fkey";

-- DropForeignKey
ALTER TABLE "automatisations" DROP CONSTRAINT "automatisations_compteId_fkey";

-- DropForeignKey
ALTER TABLE "campagnes" DROP CONSTRAINT "campagnes_compteId_fkey";

-- DropForeignKey
ALTER TABLE "consentements" DROP CONSTRAINT "consentements_contactId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_compteId_fkey";

-- DropForeignKey
ALTER TABLE "envois" DROP CONSTRAINT "envois_campagneId_fkey";

-- DropForeignKey
ALTER TABLE "envois" DROP CONSTRAINT "envois_contactId_fkey";

-- DropForeignKey
ALTER TABLE "factures" DROP CONSTRAINT "factures_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "heatmap_clicks" DROP CONSTRAINT "heatmap_clicks_campagneId_fkey";

-- DropForeignKey
ALTER TABLE "heatmap_engagement" DROP CONSTRAINT "heatmap_engagement_campagneId_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_compteId_fkey";

-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_compteId_fkey";

-- DropForeignKey
ALTER TABLE "rapports_import" DROP CONSTRAINT "rapports_import_compteId_fkey";

-- DropForeignKey
ALTER TABLE "segments" DROP CONSTRAINT "segments_compteId_fkey";

-- DropForeignKey
ALTER TABLE "templates" DROP CONSTRAINT "templates_compteId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_compteId_fkey";

-- DropForeignKey
ALTER TABLE "utilisateurs" DROP CONSTRAINT "utilisateurs_compteId_fkey";

-- AlterTable
ALTER TABLE "analytics" DROP COLUMN "campagneId",
DROP COLUMN "timestamp",
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP;

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "compteId",
DROP COLUMN "date",
DROP COLUMN "utilisateurId",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "compteId",
DROP COLUMN "dateAjout",
DROP COLUMN "nom",
DROP COLUMN "prenom",
DROP COLUMN "telephone",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "firstName" VARCHAR(100),
ADD COLUMN     "lastName" VARCHAR(100),
ADD COLUMN     "phone" VARCHAR(20);

-- AlterTable
ALTER TABLE "invitations" DROP COLUMN "compteId",
DROP COLUMN "expiry",
DROP COLUMN "statut",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "expiresAt" TIMESTAMP NOT NULL,
ADD COLUMN     "status" VARCHAR(20) NOT NULL;

-- AlterTable
ALTER TABLE "jobs" DROP COLUMN "compteId",
DROP COLUMN "dateCreation",
DROP COLUMN "dateFin",
DROP COLUMN "statut",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "finishedAt" TIMESTAMP,
ADD COLUMN     "status" VARCHAR(20) NOT NULL;

-- AlterTable
ALTER TABLE "segments" DROP COLUMN "compteId",
DROP COLUMN "criteres",
DROP COLUMN "dernierCalcul",
DROP COLUMN "nom",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "criteria" JSONB,
ADD COLUMN     "lastCalculated" TIMESTAMP,
ADD COLUMN     "name" VARCHAR(255);

-- AlterTable
ALTER TABLE "templates" DROP COLUMN "compteId",
DROP COLUMN "contenuHTML",
DROP COLUMN "estPreset",
DROP COLUMN "nom",
DROP COLUMN "typeCanal",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "channelType" VARCHAR(20),
ADD COLUMN     "htmlContent" TEXT,
ADD COLUMN     "isPreset" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" VARCHAR(255);

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "compteId",
DROP COLUMN "date",
DROP COLUMN "methode",
DROP COLUMN "montant",
DROP COLUMN "statut",
ADD COLUMN     "accountId" TEXT NOT NULL,
ADD COLUMN     "amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "method" VARCHAR(20),
ADD COLUMN     "status" VARCHAR(20) NOT NULL;

-- DropTable
DROP TABLE "automatisations";

-- DropTable
DROP TABLE "campagnes";

-- DropTable
DROP TABLE "comptes";

-- DropTable
DROP TABLE "consentements";

-- DropTable
DROP TABLE "envois";

-- DropTable
DROP TABLE "factures";

-- DropTable
DROP TABLE "heatmap_clicks";

-- DropTable
DROP TABLE "heatmap_engagement";

-- DropTable
DROP TABLE "rapports_import";

-- DropTable
DROP TABLE "utilisateurs";

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "companyName" VARCHAR(255) NOT NULL,
    "adminEmail" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "country" CHAR(3) NOT NULL,
    "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "alertThreshold" DECIMAL(12,2),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gdprStatus" VARCHAR(50) NOT NULL DEFAULT 'active',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "confirmationToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLogin" TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "channelType" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(255),
    "content" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "scheduledAt" TIMESTAMP,
    "estimatedCost" DECIMAL(12,2),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sends" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "sentAt" TIMESTAMP,
    "openedAt" TIMESTAMP,
    "clickedAt" TIMESTAMP,

    CONSTRAINT "sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" VARCHAR(255),
    "triggerEvent" VARCHAR(100),
    "delaySeconds" INTEGER,
    "workflow" JSONB,
    "status" VARCHAR(20) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_reports" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileName" VARCHAR(255),
    "totalRecords" INTEGER,
    "successCount" INTEGER,
    "duplicateCount" INTEGER,
    "errorCount" INTEGER,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_heatmap" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "engagement_heatmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_heatmap" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "zone" VARCHAR(255),
    "clickCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "click_heatmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "consentedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(255),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "s3Path" VARCHAR(255),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_adminEmail_key" ON "accounts"("adminEmail");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_confirmationToken_key" ON "accounts"("confirmationToken");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_transactionId_key" ON "invoices"("transactionId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sends" ADD CONSTRAINT "sends_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sends" ADD CONSTRAINT "sends_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_reports" ADD CONSTRAINT "import_reports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_heatmap" ADD CONSTRAINT "engagement_heatmap_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_heatmap" ADD CONSTRAINT "click_heatmap_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
