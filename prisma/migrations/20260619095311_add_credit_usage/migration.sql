-- CreateTable
CREATE TABLE "credit_usage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" VARCHAR(20) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "sourceId" VARCHAR(36),
    "sourceName" VARCHAR(255),
    "contacts" INTEGER NOT NULL DEFAULT 1,
    "parts" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_usage_accountId_createdAt_idx" ON "credit_usage"("accountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "credit_usage_accountId_userId_createdAt_idx" ON "credit_usage"("accountId", "userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "credit_usage" ADD CONSTRAINT "credit_usage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_usage" ADD CONSTRAINT "credit_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
