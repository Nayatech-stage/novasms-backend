-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyPrefix" VARCHAR(20) NOT NULL,
    "keySuffix" VARCHAR(4) NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
