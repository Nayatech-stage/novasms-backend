import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { join } from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

type UploadedCampaignFile = Express.Multer.File & {
  buffer?: Buffer<ArrayBufferLike>;
  path?: string;
  originalname?: string;
  filename?: string;
};

function resolvePublicApiBaseUrl(): string {
  const baseUrl =
    process.env.BACKEND_PUBLIC_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:3000';

  return `${baseUrl.replace(/\/$/, '')}/api`;
}

function resolveBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

@Injectable()
export class FileUploadService implements OnModuleDestroy {
  private readonly logger = new Logger(FileUploadService.name);
  private readonly uploadDir = join(process.cwd(), 'uploads', 'campaigns');
  private readonly bucketName = process.env.CAMPAIGN_IMAGE_BUCKET?.trim();
  private readonly publicObjectBaseUrl =
    process.env.CAMPAIGN_IMAGE_PUBLIC_BASE_URL?.trim().replace(/\/$/, '') ||
    null;
  private readonly objectStorageProvider = (
    process.env.CAMPAIGN_IMAGE_STORAGE_PROVIDER ||
    (this.bucketName ? 's3' : 'local')
  ).toLowerCase();
  private readonly s3Client: S3Client | null;

  constructor(private prisma: PrismaService) {
    this.ensureUploadDirExists();
    this.s3Client = this.createS3Client();
  }

  onModuleDestroy() {
    try {
      if (this.s3Client && typeof (this.s3Client as any).destroy === 'function') {
        (this.s3Client as any).destroy();
        this.logger.log('Destroyed S3 client on module shutdown');
      }
    } catch (e) {
      this.logger.warn('Error while destroying S3 client: ' + e);
    }
  }

  private getPublicApiBaseUrl(): string {
    return resolvePublicApiBaseUrl();
  }

  private createS3Client(): S3Client | null {
    if (this.objectStorageProvider !== 's3') {
      return null;
    }

    const endpoint =
      process.env.S3_ENDPOINT?.trim() ||
      process.env.CAMPAIGN_IMAGE_S3_ENDPOINT?.trim();
    const region = process.env.CAMPAIGN_IMAGE_S3_REGION?.trim() || 'us-east-1';
    const accessKeyId = process.env.CAMPAIGN_IMAGE_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey =
      process.env.CAMPAIGN_IMAGE_S3_SECRET_ACCESS_KEY?.trim();

    if (!this.bucketName || !endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'Object storage not fully configured, falling back to local campaign image storage',
      );
      return null;
    }

    return new S3Client({
      region,
      endpoint,
      forcePathStyle: resolveBool(
        process.env.CAMPAIGN_IMAGE_S3_FORCE_PATH_STYLE,
      ),
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private usesObjectStorage(): boolean {
    return Boolean(this.s3Client && this.bucketName);
  }

  private resolvePublicObjectBaseUrl(): string | null {
    if (this.publicObjectBaseUrl) {
      return this.publicObjectBaseUrl;
    }

    const endpoint =
      process.env.S3_ENDPOINT?.trim() ||
      process.env.CAMPAIGN_IMAGE_S3_ENDPOINT?.trim();
    if (!endpoint || !this.bucketName) {
      return null;
    }

    return `${endpoint.replace(/\/$/, '')}/${this.bucketName}`;
  }

  private resolveStorageUrl(fileName: string): string {
    if (this.usesObjectStorage()) {
      const publicBaseUrl = this.resolvePublicObjectBaseUrl();
      if (publicBaseUrl) {
        return `${publicBaseUrl}/${fileName}`;
      }
    }

    return `${this.getPublicApiBaseUrl()}/campaigns/images/${fileName}`;
  }

  private async bufferFromBody(body: unknown): Promise<Buffer> {
    if (!body) {
      throw new Error('Image body is empty');
    }

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (
      typeof (body as { transformToByteArray?: () => Promise<Uint8Array> })
        .transformToByteArray === 'function'
    ) {
      const bytes = await (
        body as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray();
      return Buffer.from(bytes);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<
      Buffer | Uint8Array | string
    >) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }

    return Buffer.concat(chunks);
  }

  private async saveBuffer(fileName: string, buffer: Buffer, mimeType: string) {
    if (this.usesObjectStorage() && this.s3Client && this.bucketName) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: fileName,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
      return;
    }

    const filePath = join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);
  }

  private async readStoredImage(fileName: string): Promise<{
    buffer: Buffer<ArrayBufferLike>;
    mimeType: string;
  }> {
    if (this.usesObjectStorage() && this.s3Client && this.bucketName) {
      const imageRecord = await this.prisma.campaignImage.findFirst({
        where: {
          storageUrl: {
            endsWith: `/${fileName}`,
          },
        },
        select: { mimeType: true },
      });

      const response = (await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: fileName,
        }),
      )) as GetObjectCommandOutput;

      return {
        buffer: await this.bufferFromBody(response.Body),
        mimeType:
          response.ContentType || imageRecord?.mimeType || 'application/octet-stream',
      };
    }

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
    const fileLike = typedFile as UploadedCampaignFile;
    const originalName =
      fileLike.originalname || fileLike.filename || 'file.jpg';
    const fileExtension = originalName.split('.').pop() || 'jpg';
    const fileName = `${randomUUID()}.${fileExtension}`;
    const storageUrl = this.resolveStorageUrl(fileName);

    const buffer =
      fileLike.buffer && Buffer.isBuffer(fileLike.buffer)
        ? Buffer.from(fileLike.buffer)
        : fileLike.path
          ? fs.readFileSync(fileLike.path)
          : null;

    if (!buffer) {
      throw new Error('File buffer or path missing');
    }

    await this.saveBuffer(fileName, buffer, typedFile.mimetype);

    // Save metadata to database
    const campaignImage = await this.prisma.campaignImage.create({
      data: {
        campaignId,
        fileName: typedFile.originalname,
        fileSize: typedFile.size,
        mimeType: typedFile.mimetype,
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
    return this.readStoredImage(fileName);
  }

  /**
   * Generate a presigned GET URL for a campaign image when using object storage.
   * Returns null if object storage is not configured or presigning is not possible.
   */
  async getPresignedGetUrl(fileName: string, expiresSeconds = 3600): Promise<string | null> {
    if (!this.usesObjectStorage() || !this.s3Client || !this.bucketName) return null;

    try {
      const command = new GetObjectCommand({ Bucket: this.bucketName, Key: fileName });
      const url = await getSignedUrl(this.s3Client, command, { expiresIn: expiresSeconds });
      return url;
    } catch (e) {
      this.logger.warn(`Failed to generate presigned URL for ${fileName}: ${e}`);
      return null;
    }
  }

  async deleteCampaignImage(fileName: string): Promise<void> {
    if (this.usesObjectStorage() && this.s3Client && this.bucketName) {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: fileName,
        }),
      );
      return;
    }

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
        await this.deleteCampaignImage(fileName);
      }
    }

    await this.prisma.campaignImage.deleteMany({
      where: { campaignId },
    });
  }
}
