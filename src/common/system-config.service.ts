import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);
  private cache = new Map<string, string>();

  constructor(private prisma: PrismaService) {}

  async get(key: string, defaultValue: string): Promise<string> {
    if (this.cache.has(key)) return this.cache.get(key)!;
    const row = await this.prisma.systemConfig.findUnique({ where: { key } });
    const value = row?.value ?? defaultValue;
    this.cache.set(key, value);
    return value;
  }

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const raw = await this.get(key, String(defaultValue));
    const parsed = Number(raw);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.cache.set(key, value);
    this.logger.log(`SystemConfig updated: ${key}=${value}`);
  }

  invalidateCache(key?: string) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
