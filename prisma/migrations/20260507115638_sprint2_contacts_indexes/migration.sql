/*
  Warnings:

  - You are about to drop the column `primaryChannels` on the `accounts` table. All the data in the column will be lost.
  - You are about to drop the column `sector` on the `accounts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "primaryChannels",
DROP COLUMN "sector",
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "segments" ADD COLUMN     "contactCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "contacts_accountId_email_idx" ON "contacts"("accountId", "email");

-- CreateIndex
CREATE INDEX "contacts_accountId_phone_idx" ON "contacts"("accountId", "phone");
