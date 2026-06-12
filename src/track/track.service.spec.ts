import { SendStatus, SendVariant } from '@prisma/client';
import { TrackService } from './track.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createTrackingToken,
  verifyTrackingToken,
  getTrackingBaseUrl,
} from './track-token.util';

describe('track-token.util — jetons HMAC de tracking', () => {
  it('génère un token vérifiable pour un sendId', () => {
    const token = createTrackingToken('send-1');

    expect(verifyTrackingToken('send-1', token)).toBe(true);
  });

  it('rejette un token altéré ou vide', () => {
    const token = createTrackingToken('send-1');

    expect(verifyTrackingToken('send-1', undefined)).toBe(false);
    expect(verifyTrackingToken('send-1', 'court')).toBe(false);
    expect(verifyTrackingToken('send-2', token)).toBe(false);
  });

  it('construit la base URL de tracking depuis les variables d’env', () => {
    const original = process.env;
    process.env = {
      ...original,
      TRACKING_BASE_URL: 'https://api.novasms.com/',
    };
    expect(getTrackingBaseUrl()).toBe('https://api.novasms.com');
    process.env = original;
  });
});

describe('TrackService — pixels /track/open et /track/click (NEW-T01/NEW-T02)', () => {
  const tx = {
    send: { update: jest.fn() },
    campaign: { update: jest.fn() },
    engagementHeatmap: { upsert: jest.fn() },
    clickHeatmap: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    analytic: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const prisma = {
    send: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
  };

  const baseSend = {
    id: 'send-1',
    campaignId: 'camp-1',
    contactId: 'ct-1',
    status: SendStatus.SENT,
    variant: SendVariant.A,
    openedAt: null,
    clickedAt: null,
    campaign: { accountId: 'acc-1' },
  };

  let service: TrackService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.clickHeatmap.findFirst.mockResolvedValue(null);
    service = new TrackService(prisma as unknown as PrismaService);
  });

  describe('trackOpen', () => {
    it('ignore un token invalide (anti-fraude)', async () => {
      await service.trackOpen('send-1', 'token-falsifie');

      expect(prisma.send.findUnique).not.toHaveBeenCalled();
    });

    it('est idempotent : ignore un send déjà ouvert', async () => {
      prisma.send.findUnique.mockResolvedValue({
        ...baseSend,
        openedAt: new Date(),
      });

      await service.trackOpen('send-1', createTrackingToken('send-1'));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('marque Opened, incrémente les compteurs A/B et trace analytics + audit', async () => {
      prisma.send.findUnique.mockResolvedValue(baseSend);

      await service.trackOpen('send-1', createTrackingToken('send-1'));

      expect(tx.send.update).toHaveBeenCalledWith({
        where: { id: 'send-1' },
        data: expect.objectContaining({ status: SendStatus.OPENED }),
      });
      const campaignData = tx.campaign.update.mock.calls[0][0].data;
      expect(campaignData.openedCount).toEqual({ increment: 1 });
      expect(campaignData.openedCountA).toEqual({ increment: 1 });
      expect(tx.engagementHeatmap.upsert).toHaveBeenCalled();
      expect(tx.analytic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'Open', campaignId: 'camp-1' }),
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-1',
          action: 'track_open',
        }),
      });
    });

    it('préserve le statut CLICKED lors d’une ouverture tardive', async () => {
      prisma.send.findUnique.mockResolvedValue({
        ...baseSend,
        status: SendStatus.CLICKED,
      });

      await service.trackOpen('send-1', createTrackingToken('send-1'));

      expect(tx.send.update).toHaveBeenCalledWith({
        where: { id: 'send-1' },
        data: expect.objectContaining({ status: SendStatus.CLICKED }),
      });
    });
  });

  describe('trackClick', () => {
    it('marque Clicked et incrémente la heatmap de clics par zone', async () => {
      prisma.send.findUnique.mockResolvedValue(baseSend);

      await service.trackClick(
        'send-1',
        createTrackingToken('send-1'),
        'cta-header',
      );

      expect(tx.send.update).toHaveBeenCalledWith({
        where: { id: 'send-1' },
        data: expect.objectContaining({ status: SendStatus.CLICKED }),
      });
      const campaignData = tx.campaign.update.mock.calls[0][0].data;
      expect(campaignData.clickedCount).toEqual({ increment: 1 });
      expect(campaignData.clickedCountA).toEqual({ increment: 1 });
      expect(tx.clickHeatmap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp-1',
          zone: 'cta-header',
        }),
      });
    });

    it('est idempotent : ignore un send déjà cliqué', async () => {
      prisma.send.findUnique.mockResolvedValue({
        ...baseSend,
        clickedAt: new Date(),
      });

      await service.trackClick('send-1', createTrackingToken('send-1'), 'z');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
