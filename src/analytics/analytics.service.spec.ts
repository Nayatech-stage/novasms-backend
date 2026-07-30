import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnalyticsService — analytics réelles (US-013/US-014)', () => {
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  const prisma = {
    campaign: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    analytic: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    engagementHeatmap: {
      findMany: jest.fn(),
    },
    clickHeatmap: {
      findMany: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  };

  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  describe('getOverview', () => {
    it('agrège envois, taux et évolution sur la période', async () => {
      const recent = [
        {
          id: 'c1',
          name: 'Promo',
          sentCount: 100,
          openedCount: 40,
          clickedCount: 10,
          channelType: 'EMAIL',
          createdAt: daysAgo(1),
        },
        {
          id: 'c2',
          name: 'SMS Flash',
          sentCount: 50,
          openedCount: 0,
          clickedCount: 5,
          channelType: 'SMS',
          createdAt: daysAgo(2),
        },
      ];
      prisma.campaign.findMany
        .mockResolvedValueOnce(recent) // période courante
        .mockResolvedValueOnce(recent) // top 5
        .mockResolvedValueOnce([
          { sentCount: 200, openedCount: 50, clickedCount: 20 },
        ]); // période précédente
      prisma.analytic.count
        .mockResolvedValueOnce(3) // bounces
        .mockResolvedValueOnce(6); // unsubscribes
      prisma.engagementHeatmap.findMany.mockResolvedValue([
        { hour: 9, openCount: 12, clickCount: 4 },
        { hour: 9, openCount: 3, clickCount: 1 },
        { hour: 18, openCount: 7, clickCount: 2 },
      ]);

      const overview = await service.getOverview('acc-1', 30);

      expect(overview.messagesSent).toBe(150);
      expect(overview.openRate).toBeCloseTo((40 / 150) * 100);
      expect(overview.clickRate).toBeCloseTo((15 / 150) * 100);
      expect(overview.bounceRate).toBeCloseTo(2);
      expect(overview.unsubscribeRate).toBeCloseTo(4);

      expect(overview.byChannel).toEqual(
        expect.arrayContaining([
          { channel: 'EMAIL', count: 100 },
          { channel: 'SMS', count: 50 },
        ]),
      );

      expect(overview.evolution).toHaveLength(30);
      const totalEvolutionSent = overview.evolution.reduce(
        (s, d) => s + d.sent,
        0,
      );
      expect(totalEvolutionSent).toBe(150);

      // Heatmap agrégée par heure (24 entrées)
      expect(overview.heatmap).toHaveLength(24);
      expect(overview.heatmap[9]).toEqual({
        hour: 9,
        openCount: 15,
        clickCount: 5,
      });
      expect(overview.heatmap[0]).toEqual({
        hour: 0,
        openCount: 0,
        clickCount: 0,
      });

      // Comparaison période précédente
      expect(overview.previous.messagesSent).toBe(200);
      expect(overview.previous.openRate).toBeCloseTo(25);
    });

    it('retourne des taux à 0 sans division par zéro quand aucun envoi', async () => {
      prisma.campaign.findMany.mockResolvedValue([]);
      prisma.analytic.count.mockResolvedValue(0);
      prisma.engagementHeatmap.findMany.mockResolvedValue([]);

      const overview = await service.getOverview('acc-1', 7);

      expect(overview.messagesSent).toBe(0);
      expect(overview.openRate).toBe(0);
      expect(overview.clickRate).toBe(0);
      expect(overview.bounceRate).toBe(0);
      expect(overview.unsubscribeRate).toBe(0);
      expect(overview.previous.openRate).toBe(0);
    });

    it('isole les données par accountId', async () => {
      prisma.campaign.findMany.mockResolvedValue([]);
      prisma.analytic.count.mockResolvedValue(0);
      prisma.engagementHeatmap.findMany.mockResolvedValue([]);

      await service.getOverview('acc-isole', 30);

      for (const call of prisma.campaign.findMany.mock.calls) {
        expect(call[0].where.accountId).toBe('acc-isole');
      }
      for (const call of prisma.analytic.count.mock.calls) {
        expect(call[0].where.campaign).toEqual({ accountId: 'acc-isole' });
      }
    });
  });

  describe('getSummary', () => {
    it('calcule les taux sur la fenêtre demandée', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        { sentCount: 80, openedCount: 20, clickedCount: 8 },
        { sentCount: 20, openedCount: 5, clickedCount: 2 },
      ]);
      prisma.analytic.count.mockResolvedValue(4);

      const summary = await service.getSummary('acc-1', 7);

      expect(summary.totalSent).toBe(100);
      expect(summary.openRate).toBeCloseTo(25);
      expect(summary.clickRate).toBeCloseTo(10);
      expect(summary.unsubRate).toBeCloseTo(4);
    });
  });

  describe('getActivity', () => {
    it('retourne les derniers audit logs du compte', async () => {
      const rows = [{ id: 'log-1', action: 'login', createdAt: new Date() }];
      prisma.auditLog.findMany.mockResolvedValue(rows);

      const activity = await service.getActivity('acc-1', 5);

      expect(activity).toBe(rows);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'acc-1' },
          take: 5,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('getCampaignReport', () => {
    it("retourne une erreur quand la campagne n'appartient pas au compte", async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      const report = await service.getCampaignReport('acc-1', 'camp-x');

      expect(report).toEqual({ error: 'Campaign not found' });
      expect(prisma.campaign.findFirst).toHaveBeenCalledWith({
        where: { id: 'camp-x', accountId: 'acc-1' },
      });
    });

    it('compile compteurs, contacts et heatmap de clics', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        name: 'Lancement',
        sentCount: 200,
      });
      prisma.analytic.count
        .mockResolvedValueOnce(60) // opened
        .mockResolvedValueOnce(20) // clicked
        .mockResolvedValueOnce(5) // bounced
        .mockResolvedValueOnce(2); // unsubscribed
      const openedAt = new Date();
      prisma.analytic.findMany
        .mockResolvedValueOnce([
          { contactId: 'ct-1', createdAt: openedAt, contact: { id: 'ct-1' } },
        ])
        .mockResolvedValueOnce([]);
      prisma.clickHeatmap.findMany.mockResolvedValue([
        { campaignId: 'camp-1', url: 'https://x', clickCount: 9 },
      ]);

      const report = await service.getCampaignReport('acc-1', 'camp-1');

      expect(report).toMatchObject({
        campaign: { id: 'camp-1', name: 'Lancement' },
        totalSent: 200,
        opened: 60,
        clicked: 20,
        bounced: 5,
        unsubscribed: 2,
        contactsOpened: [
          {
            contact: { email: '', firstName: undefined, lastName: undefined },
            createdAt: openedAt.toISOString(),
          },
        ],
        contactsClicked: [],
      });
      expect(report.clickHeat).toHaveLength(1);
    });
  });
});
