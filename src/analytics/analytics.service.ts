import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(accountId: string, days = 30) {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const sincePrev = new Date(now.getTime() - days * 2 * 24 * 60 * 60 * 1000);

    const campaigns = await this.prisma.campaign.findMany({
      where: { accountId, createdAt: { gte: since } },
      select: {
        id: true,
        sentCount: true,
        openedCount: true,
        clickedCount: true,
        channelType: true,
        name: true,
        createdAt: true,
      },
    });

    const allCampaigns = await this.prisma.campaign.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        sentCount: true,
        openedCount: true,
        clickedCount: true,
        channelType: true,
        createdAt: true,
      },
      orderBy: { sentCount: 'desc' },
      take: 5,
    });

    const messagesSent = campaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
    const totalOpened = campaigns.reduce((s, c) => s + (c.openedCount || 0), 0);
    const totalClicked = campaigns.reduce(
      (s, c) => s + (c.clickedCount || 0),
      0,
    );

    const openRate = messagesSent > 0 ? (totalOpened / messagesSent) * 100 : 0;
    const clickRate =
      messagesSent > 0 ? (totalClicked / messagesSent) * 100 : 0;

    const [bounced, unsubscribed] = await Promise.all([
      this.prisma.analytic.count({
        where: {
          action: 'Bounce',
          createdAt: { gte: since },
          campaign: { accountId },
        } as any,
      }),
      this.prisma.analytic.count({
        where: {
          action: 'Unsubscribe',
          createdAt: { gte: since },
          campaign: { accountId },
        } as any,
      }),
    ]);

    const bounceRate = messagesSent > 0 ? (bounced / messagesSent) * 100 : 0;
    const unsubscribeRate =
      messagesSent > 0 ? (unsubscribed / messagesSent) * 100 : 0;

    const prevCampaigns = await this.prisma.campaign.findMany({
      where: { accountId, createdAt: { gte: sincePrev, lt: since } },
      select: { sentCount: true, openedCount: true, clickedCount: true },
    });
    const prevSent = prevCampaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
    const prevOpened = prevCampaigns.reduce(
      (s, c) => s + (c.openedCount || 0),
      0,
    );
    const prevClicked = prevCampaigns.reduce(
      (s, c) => s + (c.clickedCount || 0),
      0,
    );

    const top5 = allCampaigns.map((c) => ({
      id: c.id,
      name: c.name,
      sentCount: c.sentCount || 0,
      openedCount: c.openedCount || 0,
      clickedCount: c.clickedCount || 0,
    }));

    const byChannelMap: Record<string, number> = {};
    for (const c of campaigns) {
      const ch = c.channelType || 'SMS';
      byChannelMap[ch] = (byChannelMap[ch] || 0) + (c.sentCount || 0);
    }
    const byChannel = Object.entries(byChannelMap).map(([channel, count]) => ({
      channel,
      count,
    }));

    const evolution: { date: string; sent: number; opened: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const dayCampaigns = campaigns.filter((c) => {
        const d = new Date(c.createdAt);
        return d >= dayStart && d <= dayEnd;
      });
      evolution.push({
        date: dayStart.toISOString().split('T')[0],
        sent: dayCampaigns.reduce((s, c) => s + (c.sentCount || 0), 0),
        opened: dayCampaigns.reduce((s, c) => s + (c.openedCount || 0), 0),
      });
    }

    const heatmapRows = await this.prisma.engagementHeatmap.findMany({
      where: {
        campaign: {
          accountId,
        },
      },
      take: 168,
    });
    const heatByHour: Record<
      number,
      { openCount: number; clickCount: number }
    > = {};
    for (const row of heatmapRows) {
      const h = (row as any).hour ?? 0;
      if (!heatByHour[h]) heatByHour[h] = { openCount: 0, clickCount: 0 };
      heatByHour[h].openCount += (row as any).openCount || 0;
      heatByHour[h].clickCount += (row as any).clickCount || 0;
    }
    const heatmap = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      openCount: heatByHour[h]?.openCount ?? 0,
      clickCount: heatByHour[h]?.clickCount ?? 0,
    }));

    return {
      messagesSent,
      openRate,
      clickRate,
      unsubscribeRate,
      bounceRate,
      top5,
      byChannel,
      evolution,
      heatmap,
      previous: {
        messagesSent: prevSent,
        openRate: prevSent > 0 ? (prevOpened / prevSent) * 100 : 0,
        clickRate: prevSent > 0 ? (prevClicked / prevSent) * 100 : 0,
      },
    };
  }

  async getSummary(accountId: string, days = 7) {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const campaigns = await this.prisma.campaign.findMany({
      where: { accountId, createdAt: { gte: since } },
      select: { sentCount: true, openedCount: true, clickedCount: true },
    });
    const totalSent = campaigns.reduce((s, c) => s + (c.sentCount || 0), 0);
    const totalOpened = campaigns.reduce((s, c) => s + (c.openedCount || 0), 0);
    const totalClicked = campaigns.reduce(
      (s, c) => s + (c.clickedCount || 0),
      0,
    );
    const unsubCount = await this.prisma.analytic.count({
      where: {
        action: 'Unsubscribe',
        createdAt: { gte: since },
        campaign: { accountId },
      } as any,
    });
    return {
      totalSent,
      openRate: totalSent > 0 ? (totalOpened / totalSent) * 100 : 0,
      clickRate: totalSent > 0 ? (totalClicked / totalSent) * 100 : 0,
      unsubRate: totalSent > 0 ? (unsubCount / totalSent) * 100 : 0,
    };
  }

  async getActivity(accountId: string, limit = 10) {
    return this.prisma.auditLog.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, action: true, createdAt: true },
    });
  }

  async getCampaignReport(accountId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
    });
    if (!campaign) return { error: 'Campaign not found' };

    const totalSent = campaign.sentCount || 0;
    const [opened, clicked, bounced, unsubscribed] = await Promise.all([
      this.prisma.analytic.count({
        where: { campaignId, action: 'Open' } as any,
      }),
      this.prisma.analytic.count({
        where: { campaignId, action: 'Click' } as any,
      }),
      this.prisma.analytic.count({
        where: { campaignId, action: 'Bounce' } as any,
      }),
      this.prisma.analytic.count({
        where: { campaignId, action: 'Unsubscribe' } as any,
      }),
    ]);

    const [contactsOpened, contactsClicked, clickHeat] = await Promise.all([
      this.prisma.analytic.findMany({
        where: { campaignId, action: 'Open' } as any,
        include: { contact: true },
      }),
      this.prisma.analytic.findMany({
        where: { campaignId, action: 'Click' } as any,
        include: { contact: true },
      }),
      this.prisma.clickHeatmap.findMany({ where: { campaignId } }),
    ]);

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
