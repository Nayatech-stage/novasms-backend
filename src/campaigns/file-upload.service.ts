import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageProviderFactory } from '../providers/storage/storage.provider.factory';
import type { StorageProvider } from '../providers/storage/storage.provider.interface';

function resolvePublicApiBaseUrl(): string {
  const base =
    process.env.BACKEND_PUBLIC_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api`;
}

export interface CampaignImageResponse {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageUrl: string;
  uploadedAt: Date;
}

@Injectable()
export class FileUploadService {
  private readonly storage: StorageProvider;

  constructor(
    private prisma: PrismaService,
    private storageFactory: StorageProviderFactory,
  ) {
    this.storage = this.storageFactory.getProvider();
  }

  async uploadCampaignImage(
    campaignId: string,
    file: Express.Multer.File,
  ): Promise<{
    id: string;
    url: string;
    fileName: string;
    size: number;
    type: string;
    uploadedAt: Date;
  }> {
    if (!file) throw new Error('No file provided');

    if (file.size > 5 * 1024 * 1024) {
      throw new Error('File too large. Maximum 5MB allowed.');
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, GIF, WebP allowed.');
    }

    const ext = (file.originalname || 'file.jpg').split('.').pop() || 'jpg';
    const key = `${randomUUID()}.${ext}`;
    const buffer = file.buffer ?? Buffer.alloc(0);

    await this.storage.upload(key, buffer, file.mimetype);

    const storageUrl = this.storage.getPublicUrl(key) ?? key;

    const campaignImage = await this.prisma.campaignImage.create({
      data: {
        campaignId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storageUrl,
      },
    });

    return {
      id: campaignImage.id,
      url: storageUrl,
      fileName: campaignImage.fileName,
      size: campaignImage.fileSize,
      type: campaignImage.mimeType,
      uploadedAt: campaignImage.uploadedAt,
    };
  }

  async getCampaignImage(
    fileName: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const [{ buffer, mimeType: storageMimeType }, record] = await Promise.all([
      this.storage.read(fileName),
      this.prisma.campaignImage.findFirst({
        where: { storageUrl: { endsWith: `/${fileName}` } },
        select: { mimeType: true },
      }),
    ]);
    return { buffer, mimeType: record?.mimeType || storageMimeType };
  }

  async getPresignedGetUrl(
    fileName: string,
    expiresSeconds = 3600,
  ): Promise<string | null> {
    return this.storage.getPresignedUrl(fileName, expiresSeconds);
  }

  async deleteCampaignImage(fileName: string): Promise<void> {
    await this.storage.delete(fileName);
  }

  async deleteCampaignImageById(imageId: string): Promise<void> {
    const image = await this.prisma.campaignImage.findUnique({
      where: { id: imageId },
    });
    if (!image) throw new Error('Image not found');
    const fileName = image.storageUrl.split('/').pop();
    if (fileName) {
      try {
        await this.storage.delete(fileName);
      } catch {
        // ignore if file already missing from storage
      }
    }
    await this.prisma.campaignImage.delete({ where: { id: imageId } });
  }

  async getCampaignImages(
    campaignId: string,
  ): Promise<CampaignImageResponse[]> {
    const images = await this.prisma.campaignImage.findMany({
      where: { campaignId },
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        storageUrl: true,
        uploadedAt: true,
      },
    });
    const publicBase = resolvePublicApiBaseUrl();
    return images.map((image) => ({
      ...image,
      storageUrl: image.storageUrl.startsWith('http')
        ? image.storageUrl
        : `${publicBase}${image.storageUrl.replace(/^\/api/, '')}`,
    }));
  }

  async deleteAllCampaignImages(campaignId: string): Promise<void> {
    const images = await this.prisma.campaignImage.findMany({
      where: { campaignId },
    });

    for (const image of images) {
      const fileName = image.storageUrl.split('/').pop();
      if (fileName) await this.deleteCampaignImage(fileName);
    }

    await this.prisma.campaignImage.deleteMany({ where: { campaignId } });
  }
}
