-- CreateEnum
CREATE TYPE "PhoneStatus" AS ENUM ('VALID', 'INVALID', 'UNVERIFIED');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "birthdaySettings" JSONB;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "phoneStatus" "PhoneStatus" NOT NULL DEFAULT 'UNVERIFIED';
