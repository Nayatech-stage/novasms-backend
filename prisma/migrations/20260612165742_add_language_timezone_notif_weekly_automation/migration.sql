-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "language" VARCHAR(10) NOT NULL DEFAULT 'fr',
ADD COLUMN     "timezone" VARCHAR(100) NOT NULL DEFAULT 'Africa/Abidjan';

-- AlterTable
ALTER TABLE "notification_prefs" ADD COLUMN     "automationAlertsEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weeklyReportEmail" BOOLEAN NOT NULL DEFAULT true;
