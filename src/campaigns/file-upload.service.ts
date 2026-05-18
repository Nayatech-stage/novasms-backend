import { Injectable } from '@nestjs/common';
import { join } from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
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
    const fileExtension = typedFile.originalname.split('.').pop() || 'jpg';
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = join(this.uploadDir, fileName);

    // Save file to disk
    fs.writeFileSync(filePath, typedFile.buffer);

    // Save metadata to database
    const campaignImage = await this.prisma.campaignImage.create({
      data: {
        campaignId,
        fileName: typedFile.originalname,
        fileSize: typedFile.size,
        mimeType: typedFile.mimetype,
        storageUrl: `/api/campaigns/images/${fileName}`,
      },
    });

    return {
      id: campaignImage.id,
      url: campaignImage.storageUrl,
      fileName: campaignImage.fileName,
      size: campaignImage.fileSize,
      type: campaignImage.mimeType,
      uploadedAt: campaignImage.uploadedAt,
    };
  }

  getCampaignImage(fileName: string): Buffer {
    const filePath = join(this.uploadDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error('Image not found');
    }

    return fs.readFileSync(filePath);
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

    return images;
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
