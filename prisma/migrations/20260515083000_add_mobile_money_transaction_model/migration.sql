CREATE TABLE IF NOT EXISTS "mobile_money_transactions" (
  "id" VARCHAR(64) NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "operator" VARCHAR(20) NOT NULL,
  "phoneNumber" VARCHAR(30) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  "externalTransactionId" VARCHAR(255),
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP,

  CONSTRAINT "mobile_money_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mobile_money_transactions_accountId_createdAt_idx"
ON "mobile_money_transactions"("accountId", "createdAt");

CREATE INDEX IF NOT EXISTS "mobile_money_transactions_userId_createdAt_idx"
ON "mobile_money_transactions"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'mobile_money_transactions_accountId_fkey'
      AND table_name = 'mobile_money_transactions'
  ) THEN
    ALTER TABLE "mobile_money_transactions"
      ADD CONSTRAINT "mobile_money_transactions_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'mobile_money_transactions_userId_fkey'
      AND table_name = 'mobile_money_transactions'
  ) THEN
    ALTER TABLE "mobile_money_transactions"
      ADD CONSTRAINT "mobile_money_transactions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
