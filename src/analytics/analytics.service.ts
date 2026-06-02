import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(accountId: string) {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // messages sent: sum of campaign.sentCount for account
    const agg = await this.prisma.campaign.aggregate({
      where: { accountId },
      _sum: { sentCount: true },
    });

    const messagesSent = agg._sum?.sentCount || 0;

    // analytics counts
    const [opens, clicks, unsubscribes] = await Promise.all([
      this.prisma.analytic.count({
        where: {
          action: 'Open',
          createdAt: { gte: since30 },
          campaign: { accountId },
        } as any,
      }),
      this.prisma.analytic.count({
        where: {
          action: 'Click',
          createdAt: { gte: since30 },
          campaign: { accountId },
        } as any,
      }),
      this.prisma.analytic.count({
        where: {
          action: 'Unsubscribe',
          createdAt: { gte: since30 },
          campaign: { accountId },
        } as any,
      }),
    ]);

    const openRate = messagesSent ? (opens / messagesSent) * 100 : 0;
    const clickRate = messagesSent ? (clicks / messagesSent) * 100 : 0;
    const unsubscribeRate = messagesSent
      ? (unsubscribes / messagesSent) * 100
      : 0;

    // top 5 campaigns
    const top5 = await this.prisma.campaign.findMany({
      where: { accountId },
      orderBy: { sentCount: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        sentCount: true,
        openedCount: true,
        clickedCount: true,
      },
    });

    // heatmap: aggregate EngagementHeatmap last 30 days
    const heatmap = await this.prisma.engagementHeatmap.findMany({
      where: {},
      take: 168,
    });

    return {
      messagesSent,
      openRate,
      clickRate,
      unsubscribeRate,
      top5,
      heatmap,
    };
  }

  async getCampaignReport(accountId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
    });
    if (!campaign) return { error: 'Campaign not found' };

    const totalSent = campaign.sentCount || 0;
    const opened = await this.prisma.analytic.count({
      where: { campaignId, action: 'Open' } as any,
    });
    const clicked = await this.prisma.analytic.count({
      where: { campaignId, action: 'Click' } as any,
    });
    const bounced = await this.prisma.analytic.count({
      where: { campaignId, action: 'Bounce' } as any,
    });
    const unsubscribed = await this.prisma.analytic.count({
      where: { campaignId, action: 'Unsubscribe' } as any,
    });

    const contactsOpened = await this.prisma.analytic.findMany({
      where: { campaignId, action: 'Open' } as any,
      include: { contact: true },
    });
    const contactsClicked = await this.prisma.analytic.findMany({
      where: { campaignId, action: 'Click' } as any,
      include: { contact: true },
    });

    const clickHeat = await this.prisma.clickHeatmap.findMany({
      where: { campaignId },
    });

    return {
      campaign: { id: campaign.id, name: campaign.name },
      totalSent,
      opened,
      clicked,
      bounced,
      unsubscribed,
      contactsOpened: contactsOpened.map((a) => ({
        contactId: a.contactId,
        at: a.createdAt,
      })),
      contactsClicked: contactsClicked.map((a) => ({
        contactId: a.contactId,
        at: a.createdAt,
      })),
      clickHeat,
    };
  }
}
