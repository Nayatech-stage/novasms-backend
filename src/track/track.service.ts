import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyticAction,
  Prisma,
  SendStatus,
  SendVariant,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import {
  verifyTrackingToken,
  verifyUnsubscribeToken,
} from './track-token.util';

@Injectable()
export class TrackService {
  private readonly logger = new Logger(TrackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async trackOpen(sendId: string, token?: string): Promise<void> {
    if (!sendId || !verifyTrackingToken(sendId, token)) {
      return;
    }

    const send = await this.prisma.send.findUnique({
      where: { id: sendId },
      select: {
        id: true,
        campaignId: true,
        contactId: true,
        status: true,
        variant: true,
        openedAt: true,
        campaign: { select: { accountId: true } },
      },
    });

    if (!send || send.openedAt) {
      return;
    }

    const now = new Date();
    const hour = now.getHours();
    const preserveClicked = send.status === SendStatus.CLICKED;

    await this.prisma.$transaction(async (tx) => {
      await tx.send.update({
        where: { id: send.id },
        data: {
          openedAt: now,
          status: preserveClicked ? SendStatus.CLICKED : SendStatus.OPENED,
        },
      });

      const campaignUpdate: Prisma.CampaignUpdateInput = {
        openedCount: { increment: 1 },
      };

      if (send.variant === SendVariant.A) {
        campaignUpdate.openedCountA = { increment: 1 };
      } else if (send.variant === SendVariant.B) {
        campaignUpdate.openedCountB = { increment: 1 };
      }

      await tx.campaign.update({
        where: { id: send.campaignId },
        data: campaignUpdate,
      });

      await tx.engagementHeatmap.upsert({
        where: {
          campaignId_hour: {
            campaignId: send.campaignId,
            hour,
          },
        },
        update: { openCount: { increment: 1 } },
        create: {
          campaignId: send.campaignId,
          hour,
          openCount: 1,
          clickCount: 0,
        },
      });

      await tx.analytic.create({
        data: {
          campaignId: send.campaignId,
          contactId: send.contactId,
          action: AnalyticAction.Open,
          createdAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          accountId: send.campaign.accountId,
          action: 'track_open',
          details: {
            sendId: send.id,
            campaignId: send.campaignId,
          },
        },
      });
    });

    // Déclenche les automations "campaign_opened" (même chemin que le webhook Resend)
    this.eventEmitter.emit('campaign.opened', {
      accountId: send.campaign.accountId,
      campaignId: send.campaignId,
      contactId: send.contactId,
    });
  }

  async trackClick(
    sendId: string,
    token: string | undefined,
    zone: string | undefined,
  ): Promise<void> {
    if (!sendId || !verifyTrackingToken(sendId, token)) {
      return;
    }

    const send = await this.prisma.send.findUnique({
      where: { id: sendId },
      select: {
        id: true,
        campaignId: true,
        contactId: true,
        status: true,
        variant: true,
        clickedAt: true,
        campaign: { select: { accountId: true } },
      },
    });

    if (!send || send.clickedAt) {
      return;
    }

    const now = new Date();
    const hour = now.getHours();
    const safeZone = zone?.trim().slice(0, 255) || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.send.update({
        where: { id: send.id },
        data: {
          status: SendStatus.CLICKED,
          clickedAt: now,
        },
      });

      const campaignUpdate: Prisma.CampaignUpdateInput = {
        clickedCount: { increment: 1 },
      };

      if (send.variant === SendVariant.A) {
        campaignUpdate.clickedCountA = { increment: 1 };
      } else if (send.variant === SendVariant.B) {
        campaignUpdate.clickedCountB = { increment: 1 };
      }

      await tx.campaign.update({
        where: { id: send.campaignId },
        data: campaignUpdate,
      });

      await tx.engagementHeatmap.upsert({
        where: {
          campaignId_hour: {
            campaignId: send.campaignId,
            hour,
          },
        },
        update: { clickCount: { increment: 1 } },
        create: {
          campaignId: send.campaignId,
          hour,
          openCount: 0,
          clickCount: 1,
        },
      });

      const clickRow = await tx.clickHeatmap.findFirst({
        where: {
          campaignId: send.campaignId,
          zone: safeZone,
        },
        select: { id: true },
      });

      if (clickRow) {
        await tx.clickHeatmap.update({
          where: { id: clickRow.id },
          data: { clickCount: { increment: 1 } },
        });
      } else {
        await tx.clickHeatmap.create({
          data: {
            campaignId: send.campaignId,
            zone: safeZone,
            clickCount: 1,
          },
        });
      }

      await tx.analytic.create({
        data: {
          campaignId: send.campaignId,
          contactId: send.contactId,
          action: AnalyticAction.Click,
          createdAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          accountId: send.campaign.accountId,
          action: 'track_click',
          details: {
            sendId: send.id,
            campaignId: send.campaignId,
            zone: safeZone,
          },
        },
      });
    });

    // Déclenche les automations "link_clicked" (même chemin que le webhook Resend)
    this.eventEmitter.emit('campaign.clicked', {
      accountId: send.campaign.accountId,
      campaignId: send.campaignId,
      contactId: send.contactId,
    });

    this.logger.debug(`Tracked click for send ${sendId}`);
  }

  async trackUnsubscribe(
    contactId: string,
    accountId: string,
    token?: string,
  ): Promise<boolean> {
    if (
      !contactId ||
      !accountId ||
      !verifyUnsubscribeToken(contactId, accountId, token)
    ) {
      this.logger.warn(`Invalid unsubscribe token for contact ${contactId}`);
      return false;
    }

    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, accountId },
      select: { id: true, optOut: true },
    });

    if (!contact) {
      this.logger.warn(
        `Unsubscribe: contact ${contactId} not found in account ${accountId}`,
      );
      return false;
    }

    if (!contact.optOut) {
      await this.prisma.contact.update({
        where: { id: contactId },
        data: { optOut: true, optOutAt: new Date() },
      });

      await this.prisma.auditLog.create({
        data: {
          accountId,
          action: 'contact_unsubscribed',
          details: { contactId, source: 'email_link' },
        },
      });

      this.logger.log(`Contact ${contactId} unsubscribed via email link`);
    }

    return true;
  }
}
