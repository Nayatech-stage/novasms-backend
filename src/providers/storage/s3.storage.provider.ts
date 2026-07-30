import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider } from './storage.provider.interface';

export class S3StorageProvider implements StorageProvider {
  constructor(
    private readonly s3Client: S3Client,
    private readonly bucketName: string,
    private readonly publicBaseUrl: string | null,
    private readonly s3Endpoint: string,
  ) {}

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  async read(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
    const buffer = await this.bufferFromBody(response.Body);
    return {
      buffer,
      mimeType: response.ContentType || 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
  }

  getPublicUrl(key: string): string | null {
    const base =
      this.publicBaseUrl ||
      `${this.s3Endpoint.replace(/\/$/, '')}/${this.bucketName}`;
    return `${base}/${key}`;
  }

  async getPresignedUrl(
    key: string,
    expiresSeconds = 3600,
  ): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      return await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresSeconds,
      });
    } catch {
      return null;
    }
  }

  private async bufferFromBody(body: unknown): Promise<Buffer> {
    if (!body) throw new Error('Image body is empty');
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof (body as any).transformToByteArray === 'function') {
      const bytes = await (body as any).transformToByteArray();
      return Buffer.from(bytes);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<
      Buffer | Uint8Array | string
    >) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
