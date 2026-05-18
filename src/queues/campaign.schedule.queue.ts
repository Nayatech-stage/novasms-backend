import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';

import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus } from '@prisma/client';

export interface ScheduleCampaignJob {
  campaignId: string;
  accountId: string;
  channelType: string;
}

@Processor('campaign-schedule')
export class CampaignScheduleProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignScheduleProcessor.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('campaign-dispatch') private dispatchQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ScheduleCampaignJob>) {
    return this.handleTrigger(job);
  }

  async handleTrigger(job: Job<ScheduleCampaignJob>) {
    const { campaignId, accountId } = job.data;
    this.logger.log(`Triggering scheduled campaign ${campaignId}`);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId, accountId },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };
    if (campaign.status === CampaignStatus.CANCELLED)
      return { success: false, reason: 'cancelled' };

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { creditBalance: true },
    });
    if (!account || account.creditBalance < (campaign.estimatedCost || 0)) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.FAILED },
      });
      return { success: false, error: 'Insufficient credits' };
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.SENDING },
    });
    await this.dispatchQueue.add(
      'dispatch-campaign',
      { campaignId, chunkSize: 500, cursor: null },
      { jobId: `dispatch-${campaignId}`, removeOnComplete: true },
    );

    this.logger.log(`Campaign ${campaignId} triggered successfully`);
    return { success: true, campaignId };
  }
}
