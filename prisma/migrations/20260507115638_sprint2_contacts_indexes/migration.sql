/*
  Warnings:

  - You are about to drop the column `primaryChannels` on the `accounts` table. All the data in the column will be lost.
  - You are about to drop the column `sector` on the `accounts` table. All the data in the column will be lost.

*/
-- AlterTable
DO $$
BEGIN
  -- Drop seulement si les colonnes existent (shadow DB)
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'primaryChannels'
  ) THEN
    ALTER TABLE "accounts" DROP COLUMN "primaryChannels";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'sector'
  ) THEN
    ALTER TABLE "accounts" DROP COLUMN "sector";
  END IF;

  -- Add seulement si la colonne n'existe pas
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'twoFactorEnabled'
  ) THEN
    ALTER TABLE "accounts"
      ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "segments" ADD COLUMN     "contactCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "contacts_accountId_email_idx" ON "contacts"("accountId", "email");

-- CreateIndex
CREATE INDEX "contacts_accountId_phone_idx" ON "contacts"("accountId", "phone");
