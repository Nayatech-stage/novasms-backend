import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaignStatus } from '@prisma/client';

@Injectable()
export class CampaignScheduleWorker {
  private readonly logger = new Logger(CampaignScheduleWorker.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('campaign-schedule') private scheduleQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledCampaigns() {
    const now = new Date();
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.SCHEDULED,
        scheduledAt: { gte: new Date(now.getTime() - 5 * 60 * 1000), lte: now },
      },
    });

    for (const c of campaigns) {
      try {
        const account = await this.prisma.account.findUnique({
          where: { id: c.accountId },
          select: { creditBalance: true },
        });
        if (!account || account.creditBalance < (c.estimatedCost || 0)) {
          await this.prisma.campaign.update({
            where: { id: c.id },
            data: { status: CampaignStatus.FAILED },
          });
          continue;
        }
        await this.scheduleQueue.add(
          'trigger-campaign',
          {
            campaignId: c.id,
            accountId: c.accountId,
            channelType: c.channelType,
          },
          { jobId: `sched-${c.id}`, removeOnComplete: true },
        );
        await this.prisma.campaign.update({
          where: { id: c.id },
          data: { status: CampaignStatus.SENDING },
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Schedule failed ${c.id}: ${errMsg}`);
        await this.prisma.campaign.update({
          where: { id: c.id },
          data: { status: CampaignStatus.FAILED },
        });
      }
    }
  }
}
