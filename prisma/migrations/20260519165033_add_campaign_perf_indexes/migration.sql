-- CreateIndex
CREATE INDEX "campaigns_accountId_createdAt_idx" ON "campaigns"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "sends_campaignId_status_idx" ON "sends"("campaignId", "status");

-- CreateIndex
CREATE INDEX "sends_campaignId_status_variant_idx" ON "sends"("campaignId", "status", "variant");
