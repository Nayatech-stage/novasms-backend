-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
