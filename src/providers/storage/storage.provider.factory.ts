import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { S3Client } from '@aws-sdk/client-s3';
import { StorageProvider } from './storage.provider.interface';
import { LocalStorageProvider } from './local.storage.provider';
import { S3StorageProvider } from './s3.storage.provider';

function resolveBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolvePublicApiBaseUrl(): string {
  const base =
    process.env.BACKEND_PUBLIC_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api`;
}

@Injectable()
export class StorageProviderFactory {
  private readonly logger = new Logger(StorageProviderFactory.name);
  private readonly provider: StorageProvider;

  constructor() {
    this.provider = this.buildProvider();
  }

  getProvider(): StorageProvider {
    return this.provider;
  }

  getHealthStatus() {
    const selected = this.resolveProviderType();
    return {
      providerType: 'storage',
      selected,
      s3Configured: Boolean(
        process.env.CAMPAIGN_IMAGE_BUCKET &&
        process.env.CAMPAIGN_IMAGE_S3_ACCESS_KEY_ID &&
        process.env.CAMPAIGN_IMAGE_S3_SECRET_ACCESS_KEY,
      ),
    };
  }

  private resolveProviderType(): 's3' | 'local' {
    const bucketName = process.env.CAMPAIGN_IMAGE_BUCKET?.trim();
    const explicit = (
      process.env.CAMPAIGN_IMAGE_STORAGE_PROVIDER || ''
    ).toLowerCase();
    if (explicit === 's3' || (!explicit && bucketName)) return 's3';
    return 'local';
  }

  private buildProvider(): StorageProvider {
    const providerType = this.resolveProviderType();

    if (providerType === 's3') {
      const s3Provider = this.tryBuildS3Provider();
      if (s3Provider) {
        this.logger.log('Storage provider: S3/MinIO');
        return s3Provider;
      }
      this.logger.warn(
        'S3 storage not fully configured, falling back to local storage',
      );
    }

    this.logger.log('Storage provider: local filesystem');
    return new LocalStorageProvider(
      join(process.cwd(), 'uploads', 'campaigns'),
      resolvePublicApiBaseUrl(),
    );
  }

  private tryBuildS3Provider(): S3StorageProvider | null {
    const endpoint =
      process.env.S3_ENDPOINT?.trim() ||
      process.env.CAMPAIGN_IMAGE_S3_ENDPOINT?.trim();
    const bucketName = process.env.CAMPAIGN_IMAGE_BUCKET?.trim();
    const region = process.env.CAMPAIGN_IMAGE_S3_REGION?.trim() || 'us-east-1';
    const accessKeyId = process.env.CAMPAIGN_IMAGE_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey =
      process.env.CAMPAIGN_IMAGE_S3_SECRET_ACCESS_KEY?.trim();

    if (!bucketName || !endpoint || !accessKeyId || !secretAccessKey) {
      return null;
    }

    const s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: resolveBool(
        process.env.CAMPAIGN_IMAGE_S3_FORCE_PATH_STYLE,
      ),
      credentials: { accessKeyId, secretAccessKey },
    });

    const publicBaseUrl =
      process.env.CAMPAIGN_IMAGE_PUBLIC_BASE_URL?.trim().replace(/\/$/, '') ||
      null;

    return new S3StorageProvider(s3Client, bucketName, publicBaseUrl, endpoint);
  }
}
