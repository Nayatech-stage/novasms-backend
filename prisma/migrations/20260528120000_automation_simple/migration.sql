-- Sprint 4: simple automations

ALTER TABLE "automations"
  RENAME COLUMN "triggerEvent" TO "trigger";

ALTER TABLE "workflow_executions"
  RENAME COLUMN "completedAt" TO "finishedAt";

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "delaySeconds" INTEGER;

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "channel" VARCHAR(20);

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "templateId" TEXT;

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "automations"
SET "name" = COALESCE("name", 'Automatisation')
WHERE "name" IS NULL;

UPDATE "automations"
SET "trigger" = COALESCE("trigger", 'contact_added')
WHERE "trigger" IS NULL;

UPDATE "automations"
SET "delaySeconds" = COALESCE("delaySeconds", 0)
WHERE "delaySeconds" IS NULL;

UPDATE "automations"
SET "channel" = COALESCE("channel", 'Email')
WHERE "channel" IS NULL;

UPDATE "workflow_executions"
SET "status" = COALESCE("status", 'Running')
WHERE "status" IS NULL;

ALTER TABLE "automations"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "trigger" SET NOT NULL,
  ALTER COLUMN "delaySeconds" SET DEFAULT 0,
  ALTER COLUMN "delaySeconds" SET NOT NULL,
  ALTER COLUMN "channel" SET DEFAULT 'Email',
  ALTER COLUMN "channel" SET NOT NULL,
  ALTER COLUMN "sendCount" SET DEFAULT 0;

ALTER TABLE "workflow_executions"
  ALTER COLUMN "status" SET DEFAULT 'Running',
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "startedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "automations"
  ADD CONSTRAINT "automations_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "templates" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
