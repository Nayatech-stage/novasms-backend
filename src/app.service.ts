import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { EmailProviderFactory } from './providers/email/email.provider.factory';
import { SmsProviderFactory } from './providers/sms/sms.provider.factory';
import Redis from 'ioredis';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProviderFactory: EmailProviderFactory,
    private readonly smsProviderFactory: SmsProviderFactory,
  ) {}

  getHealth(): string {
    return 'NovaSMS API is running';
  }

  async getStatus(): Promise<object> {
    const [dbOk, redisOk] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);

    const providers = {
      email: this.emailProviderFactory.getHealthStatus(),
      sms: this.smsProviderFactory.getHealthStatus(),
    };

    const allOk = dbOk && redisOk;

    return {
      status: allOk ? 'ok' : 'degraded',
      service: 'NovaSMS API',
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks: {
        database: { status: dbOk ? 'ok' : 'error' },
        redis: { status: redisOk ? 'ok' : 'error' },
      },
      providers,
    };
  }

  getProvidersHealth(): object {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      providers: {
        email: this.emailProviderFactory.getHealthStatus(),
        sms: this.smsProviderFactory.getHealthStatus(),
      },
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    const client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      connectTimeout: 2000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    } finally {
      client.disconnect();
    }
  }
}
