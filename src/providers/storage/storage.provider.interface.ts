export interface StorageProvider {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  read(key: string): Promise<{ buffer: Buffer; mimeType: string }>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string | null;
  getPresignedUrl(key: string, expiresSeconds?: number): Promise<string | null>;
}
