-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "resetPasswordExpiry" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "location" VARCHAR(100);

-- CreateIndex
CREATE INDEX "audit_logs_accountId_createdAt_idx" ON "audit_logs"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "contacts_accountId_createdAt_idx" ON "contacts"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "contacts_accountId_location_idx" ON "contacts"("accountId", "location");

-- CreateIndex
CREATE INDEX "contacts_accountId_optOut_idx" ON "contacts"("accountId", "optOut");

-- CreateIndex
CREATE INDEX "contacts_accountId_firstName_idx" ON "contacts"("accountId", "firstName");

-- CreateIndex
CREATE INDEX "contacts_accountId_lastName_idx" ON "contacts"("accountId", "lastName");

-- CreateIndex
CREATE INDEX "segments_accountId_idx" ON "segments"("accountId");
