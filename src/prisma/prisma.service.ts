import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as os from 'os';

const POOL_SIZE = Math.max(4, (os.cpus().length ?? 2) * 2);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const rawUrl = process.env.DATABASE_URL ?? '';
    let url = rawUrl;

    try {
      const parsed = new URL(rawUrl);
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', String(POOL_SIZE));
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', '20');
      }
      if (!parsed.searchParams.has('connect_timeout')) {
        parsed.searchParams.set('connect_timeout', '10');
      }
      url = parsed.toString();
    } catch {
      // Invalid URL — let Prisma surface the error naturally
    }

    super({
      datasources: { db: { url } },
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    this.$on('error' as never, (e: { message: string }) => {
      this.logger.error(`Prisma: ${e.message}`);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`DB connected — pool: ${POOL_SIZE} connections`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
