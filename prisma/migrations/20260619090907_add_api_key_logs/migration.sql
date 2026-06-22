-- CreateTable
CREATE TABLE "api_key_logs" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "endpoint" VARCHAR(100) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 200,
    "creditsUsed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_key_logs_apiKeyId_createdAt_idx" ON "api_key_logs"("apiKeyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "api_key_logs_accountId_createdAt_idx" ON "api_key_logs"("accountId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "api_key_logs" ADD CONSTRAINT "api_key_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
