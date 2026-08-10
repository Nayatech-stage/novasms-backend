import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus, SendStatus, SendVariant } from '@prisma/client';

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
    @InjectQueue('campaign-schedule') private scheduleQueue: Queue,
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
      where: { id: campaignId },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };
    if (campaign.accountId !== accountId) {
      return { success: false, error: 'Campaign/account mismatch' };
    }
    if (campaign.status === CampaignStatus.CANCELLED) {
      // US-009: cleanup des jobs dispatch en attente
      try {
        await this.dispatchQueue.clean(0, 1000, 'delayed');
      } catch {
        /* non-bloquant */
      }
      return { success: false, reason: 'cancelled' };
    }

    // US-009: fenêtre horaire — ne pas envoyer entre 22h et 8h UTC
    const nowDate = new Date();
    const nowHour = nowDate.getUTCHours();
    const inQuietHours = nowHour >= 22 || nowHour < 8;
    if (inQuietHours) {
      // Calculer exactement la prochaine fenêtre 8h UTC
      const next8amUTC = new Date(nowDate);
      next8amUTC.setUTCHours(8, 0, 0, 0);
      if (next8amUTC <= nowDate) {
        next8amUTC.setUTCDate(next8amUTC.getUTCDate() + 1);
      }

      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SCHEDULED, scheduledAt: next8amUTC },
      });

      // Re-enqueue le job dans la schedule queue pour 8h UTC — le job BullMQ
      // actuel ayant déjà été consommé, sans re-enqueue la campagne resterait
      // bloquée en SCHEDULED pour toujours.
      const deferDelay = next8amUTC.getTime() - Date.now();
      await this.scheduleQueue.add(
        'trigger-campaign',
        { campaignId, accountId, channelType: job.data.channelType },
        {
          delay: Math.max(0, deferDelay),
          jobId: `sched-${campaignId}-quiet-${next8amUTC.getTime()}`,
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `Campaign ${campaignId} replanifiée à ${next8amUTC.toISOString()} (heure creuse ${nowHour}h UTC, délai ${Math.round(deferDelay / 60000)} min)`,
      );
      return { success: false, reason: 'quiet-hours-deferred' };
    }

    const realCost = Number(campaign.estimatedCost ?? 0);

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { creditBalance: true },
    });
    if (!account || Number(account.creditBalance) < realCost) {
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

    const isABCampaign = Boolean(campaign.subjectB);
    if (isABCampaign) {
      const [countA, countB] = await Promise.all([
        this.prisma.send.count({
          where: {
            campaignId,
            status: SendStatus.PENDING,
            variant: SendVariant.A,
          },
        }),
        this.prisma.send.count({
          where: {
            campaignId,
            status: SendStatus.PENDING,
            variant: SendVariant.B,
          },
        }),
      ]);

      if (countA > 0) {
        await this.dispatchQueue.add(
          'dispatch-campaign',
          { campaignId, variant: 'A', chunkSize: 500, cursor: null },
          {
            jobId: `dispatch-${campaignId}-A-scheduled`,
            removeOnComplete: true,
          },
        );
      }
      if (countB > 0) {
        await this.dispatchQueue.add(
          'dispatch-campaign',
          { campaignId, variant: 'B', chunkSize: 500, cursor: null },
          {
            jobId: `dispatch-${campaignId}-B-scheduled`,
            removeOnComplete: true,
          },
        );
      }

      const evaluationDelayMs = Math.max(
        60_000,
        (campaign.abTestDuration || 4) * 60 * 60 * 1000,
      );
      await this.dispatchQueue.add(
        'evaluate-ab-winner',
        { campaignId },
        {
          delay: evaluationDelayMs,
          jobId: `evaluate-ab-${campaignId}`,
          removeOnComplete: true,
        },
      );
    } else {
      await this.dispatchQueue.add(
        'dispatch-campaign',
        { campaignId, chunkSize: 500, cursor: null },
        { jobId: `dispatch-${campaignId}`, removeOnComplete: true },
      );
    }

    this.logger.log(`Campaign ${campaignId} triggered successfully`);
    return { success: true, campaignId };
  }
}
