import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';

import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CampaignStatus, SendStatus } from '@prisma/client';

export interface DispatchCampaignJob {
  campaignId: string;
  chunkSize?: number;
  cursor?: string | null;
  variant?: 'A' | 'B';
}

@Processor('campaign-dispatch')
export class CampaignDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignDispatchProcessor.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('campaign-dispatch') private dispatchQueue: Queue,
    private mailService: MailService,
  ) {
    super();
  }

  async process(job: Job<DispatchCampaignJob>) {
    return this.handleDispatch(job);
  }

  async handleDispatch(job: Job<DispatchCampaignJob>) {
    const { campaignId, chunkSize = 500, cursor, variant } = job.data;

    this.logger.log(
      `Dispatching campaign ${campaignId}${variant ? ` (variant ${variant})` : ''}`,
    );

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        segment: {
          select: { id: true, name: true, type: true, criteria: true },
        },
        sends: {
          where: {
            status: {
              in: [SendStatus.SENT, SendStatus.OPENED, SendStatus.CLICKED],
            },
          },
          select: { contactId: true },
        },
      },
    });

    if (!campaign) return { success: false, error: 'Campaign not found' };
    if (campaign.status === CampaignStatus.CANCELLED)
      return { success: false, reason: 'cancelled' };
    if (
      campaign.status !== CampaignStatus.SENDING &&
      campaign.status !== CampaignStatus.SCHEDULED
    ) {
      return { success: false, error: 'Invalid status' };
    }

    const sentIds = campaign.sends.map((s) => s.contactId);
    if (campaign.segmentId) {
      this.logger.log(`Segment filtering pending for ${campaign.segmentId}`);
    }

    const where = {
      accountId: campaign.accountId,
      optOut: false,
      ...(sentIds.length > 0 ? { NOT: { id: { in: sentIds } } } : {}),
    };

    const contacts = await this.prisma.contact.findMany({
      where,
      take: chunkSize,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
    });

    if (contacts.length === 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SENT },
      });
      return { success: true, sent: 0, campaignId };
    }

    const results = await Promise.allSettled(
      contacts.map(async (contact) => {
        try {
          let content = campaign.content || '';
          if (contact.firstName)
            content = content.replace(/{{pr[eé]nom}}/gi, contact.firstName);

          if (campaign.channelType === 'SMS')
            await this.sendSms(contact.phone!, content);
          else
            await this.sendEmail(
              contact.email!,
              campaign.subject || '',
              content,
            );

          await this.prisma.send.create({
            data: {
              campaignId,
              contactId: contact.id,
              status: SendStatus.SENT,
              variant: variant ?? 'NONE',
              sentAt: new Date(),
            },
          });
          return { success: true };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.prisma.send.create({
            data: {
              campaignId,
              contactId: contact.id,
              status: SendStatus.BOUNCED,
              variant: variant ?? 'NONE',
              sentAt: new Date(),
              bouncedReason: errMsg,
            },
          });
          return { success: false };
        }
      }),
    );

    const successCount = results.filter(
      (r): r is PromiseFulfilledResult<{ success: boolean }> =>
        r.status === 'fulfilled' && r.value.success,
    ).length;
    const nextCursor = contacts[contacts.length - 1]?.id || null;

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: { increment: successCount },
        failedCount: { increment: results.length - successCount },
      },
    });

    if (contacts.length === chunkSize) {
      await this.dispatchQueue.add(
        'dispatch-campaign',
        { campaignId, chunkSize, cursor: nextCursor, variant },
        {
          jobId: `dispatch-${campaignId}-${nextCursor}`,
          removeOnComplete: true,
        },
      );
    }

    // ✅ Send notification email when campaign dispatch completes
    if (successCount > 0) {
      try {
        const campaign = await this.prisma.campaign.findUnique({
          where: { id: campaignId },
          include: { account: { select: { adminEmail: true } } },
        });
        if (campaign?.account) {
          await this.mailService.sendCampaignSentNotification(
            campaign.account.adminEmail,
            {
              campaignName: campaign.name,
              channelType: campaign.channelType,
              sentAt: new Date(),
            },
          );
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to send notification for campaign ${campaignId}: ${errMsg}`,
        );
      }
    }

    return {
      success: true,
      sent: successCount,
      total: results.length,
      nextCursor,
      campaignId,
    };
  }

  async handleWinnerDispatch(
    job: Job<{ campaignId: string; variant: 'A' | 'B' }>,
  ) {
    return this.handleDispatch({
      data: { ...job.data, chunkSize: 500 },
    } as unknown as Job<DispatchCampaignJob>);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendSms(_phone: string, _content: string) {
    /* TODO */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendEmail(_email: string, _subject: string, _content: string) {
    /* TODO */
  }
}
