import { Injectable } from '@nestjs/common';
import { join } from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination: string;
  filename: string;
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
  private readonly uploadDir = join(process.cwd(), 'uploads', 'campaigns');

  constructor(private prisma: PrismaService) {
    this.ensureUploadDirExists();
  }

  private getPublicApiBaseUrl(): string {
    const baseUrl =
      process.env.BACKEND_PUBLIC_URL ||
      process.env.API_BASE_URL ||
      'http://localhost:3000';
    return `${baseUrl.replace(/\/$/, '')}/api`;
  }

  private ensureUploadDirExists() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadCampaignImage(
    campaignId: string,
    file: Express.Multer.File | UploadedFile,
  ): Promise<{
    id: string;
    url: string;
    fileName: string;
    size: number;
    type: string;
    uploadedAt: Date;
  }> {
    if (!file) {
      throw new Error('No file provided');
    }

    // Ensure upload dir exists (defensive)
    this.ensureUploadDirExists();

    // Cast to strongly typed interface
    const typedFile = file;

    // Validate file
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (typedFile.size > maxSize) {
      throw new Error('File too large. Maximum 5MB allowed.');
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(typedFile.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, GIF, WebP allowed.');
    }

    // Generate unique filename
    const originalName = (typedFile as any).originalname || (typedFile as any).filename || 'file.jpg';
    const fileExtension = originalName.split('.').pop() || 'jpg';
    const fileName = `${randomUUID()}.${fileExtension}`;
    const filePath = join(this.uploadDir, fileName);

    // Save file to disk. Support both memory buffer (preferred) and disk-stored multer file.
    if (typedFile && (typedFile as any).buffer && Buffer.isBuffer((typedFile as any).buffer)) {
      fs.writeFileSync(filePath, (typedFile as any).buffer);
    } else if ((typedFile as any).path) {
      // Multer may store file on disk; copy it to our uploads dir
      const source = (typedFile as any).path as string;
      if (!fs.existsSync(source)) {
        throw new Error('Uploaded file not found on disk');
      }
      fs.copyFileSync(source, filePath);
    } else {
      throw new Error('File buffer or path missing');
    }

    // Save metadata to database
    const relativeUrl = `/api/campaigns/images/${fileName}`;
    const campaignImage = await this.prisma.campaignImage.create({
      data: {
        campaignId,
        fileName: typedFile.originalname,
        fileSize: typedFile.size,
        mimeType: typedFile.mimetype,
        storageUrl: relativeUrl,
      },
    });

    return {
      id: campaignImage.id,
      url: `${this.getPublicApiBaseUrl()}/campaigns/images/${fileName}`,
      fileName: campaignImage.fileName,
      size: campaignImage.fileSize,
      type: campaignImage.mimeType,
      uploadedAt: campaignImage.uploadedAt,
    };
  }

  async getCampaignImage(
    fileName: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const filePath = join(this.uploadDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error('Image not found');
    }

    const imageRecord = await this.prisma.campaignImage.findFirst({
      where: {
        storageUrl: {
          endsWith: `/${fileName}`,
        },
      },
      select: { mimeType: true },
    });

    return {
      buffer: fs.readFileSync(filePath),
      mimeType: imageRecord?.mimeType || 'application/octet-stream',
    };
  }

  deleteCampaignImage(fileName: string): void {
    const filePath = join(this.uploadDir, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
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

    return images.map((image) => ({
      ...image,
      storageUrl: image.storageUrl.startsWith('http')
        ? image.storageUrl
        : `${this.getPublicApiBaseUrl()}${image.storageUrl.replace(/^\/api/, '')}`,
    }));
  }

  async deleteAllCampaignImages(campaignId: string): Promise<void> {
    const images = await this.prisma.campaignImage.findMany({
      where: { campaignId },
    });

    for (const image of images) {
      const fileName = image.storageUrl.split('/').pop();
      if (fileName) {
        const filePath = join(this.uploadDir, fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    await this.prisma.campaignImage.deleteMany({
      where: { campaignId },
    });
  }
}
