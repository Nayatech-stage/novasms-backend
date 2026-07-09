import { join } from 'path';
import * as fs from 'fs';
import { StorageProvider } from './storage.provider.interface';

export class LocalStorageProvider implements StorageProvider {
  constructor(
    private readonly uploadDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const filePath = join(this.uploadDir, key);
    const dir = join(filePath, '..');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
  }

  async read(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const filePath = join(this.uploadDir, key);
    if (!fs.existsSync(filePath)) throw new Error('Image not found');
    return {
      buffer: fs.readFileSync(filePath),
      mimeType: 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.uploadDir, key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/campaigns/images/${key}`;
  }

  async getPresignedUrl(_key: string, _expiresSeconds?: number): Promise<null> {
    return null;
  }
}
