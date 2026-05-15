import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  constructor(private prisma: PrismaService) {}

  async create(accountId: string, data: Record<string, unknown>) {
    const payload: Record<string, unknown> = { accountId, ...(data || {}) };
    const c = await this.prisma.campaign.create({
      data: payload as any,
    });
    return c;
  }

  async list(accountId: string) {
    return this.prisma.campaign.findMany({
      where: { accountId },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async get(accountId: string, id: string) {
    return this.prisma.campaign.findFirst({ where: { accountId, id } });
  }
}
