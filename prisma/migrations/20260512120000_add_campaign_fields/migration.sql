-- Add fields for campaign naming and targeting
ALTER TABLE "campaigns" ADD COLUMN "name" VARCHAR(255) NOT NULL DEFAULT 'Campagne';
ALTER TABLE "campaigns" ADD COLUMN "segmentId" TEXT;
