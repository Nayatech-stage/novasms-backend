-- Reset password (US-002)
-- Ajout des colonnes token/expiry sur accounts

ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "resetPasswordToken" TEXT,
  ADD COLUMN IF NOT EXISTS "resetPasswordExpiry" TIMESTAMP;

-- Contrainte d’unicité (si déjà présente, on ignore)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'accounts_resetPasswordToken_key'
  ) THEN
    ALTER TABLE "accounts"
      ADD CONSTRAINT "accounts_resetPasswordToken_key" UNIQUE ("resetPasswordToken");
  END IF;
END $$;
