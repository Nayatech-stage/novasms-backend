-- CreateTable
CREATE TABLE "campaign_images" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_images_campaignId_idx" ON "campaign_images"("campaignId");

-- AddForeignKey
ALTER TABLE "campaign_images" ADD CONSTRAINT "campaign_images_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
