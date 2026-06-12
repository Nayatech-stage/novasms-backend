import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { CampaignsService } from './campaigns.service';
import { ContactsService } from '../contacts/contacts.service';
import { PrismaService } from '../prisma/prisma.service';

type MockPrisma = {
  campaign: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  segment: { findUnique: jest.Mock };
  account: { findFirst: jest.Mock };
  analytic: { findMany: jest.Mock };
  aBTestResult: { upsert: jest.Mock };
  job: { create: jest.Mock; update: jest.Mock };
};

function makeHarness() {
  const prisma: MockPrisma = {
    campaign: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'camp-1' }),
      delete: jest.fn().mockResolvedValue({ id: 'camp-1' }),
    },
    segment: { findUnique: jest.fn() },
    account: { findFirst: jest.fn() },
    analytic: { findMany: jest.fn().mockResolvedValue([]) },
    aBTestResult: { upsert: jest.fn().mockResolvedValue({}) },
    job: {
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      update: jest.fn().mockResolvedValue({ id: 'job-1' }),
    },
  };
  const dispatchQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const scheduleQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CampaignsService(
    prisma as unknown as PrismaService,
    {} as unknown as ContactsService,
    dispatchQueue as unknown as Queue,
    scheduleQueue as unknown as Queue,
  );
  return { prisma, dispatchQueue, scheduleQueue, service };
}

const baseCampaign = {
  id: 'camp-1',
  accountId: 'acc-1',
  channelType: 'EMAIL',
  status: CampaignStatus.DRAFT,
  scheduledAt: null as Date | null,
};

describe('CampaignsService.update', () => {
  it('rejette un payload invalide ou une campagne introuvable', async () => {
    const { service, prisma } = makeHarness();
    await expect(service.update('acc-1', 'camp-1', null)).rejects.toThrow(
      'Payload invalide',
    );
    prisma.campaign.findFirst.mockResolvedValue(null);
    await expect(service.update('acc-1', 'camp-1', {})).rejects.toThrow(
      'Campagne introuvable',
    );
  });

  it('met à jour les champs simples et le contenu EMAIL', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1',
      segmentId: null,
    });

    await service.update('acc-1', 'camp-1', {
      name: 'Promo Juin',
      subject: 'Sujet',
      subjectA: 'A',
      subjectB: 'B',
      content: 'corps',
      emailContent: { subject: 'Sujet Email', blocks: [] },
    });

    const data = prisma.campaign.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.name).toBe('Promo Juin');
    expect(data.subjectA).toBe('A');
    expect(data.contentJson).toEqual({ subject: 'Sujet Email', blocks: [] });
    expect(data.content).toBe('Sujet Email');
  });

  it('met à jour le contenu SMS via smsContent', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      channelType: 'SMS',
    });
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1' });

    await service.update('acc-1', 'camp-1', {
      channel: 'SMS',
      smsContent: { message: 'Promo -20% STOP au 1234' },
    });

    const data = prisma.campaign.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.contentJson).toEqual({ message: 'Promo -20% STOP au 1234' });
    expect(data.content).toBe('Promo -20% STOP au 1234');
  });

  it('parse contentJson string et remonte le subject imbriqué', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1' });

    await service.update('acc-1', 'camp-1', {
      contentJson: JSON.stringify({ subject: 'Depuis JSON', blocks: [] }),
    });

    const data = prisma.campaign.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.subject).toBe('Depuis JSON');
    expect(data.contentJson).toEqual({ subject: 'Depuis JSON', blocks: [] });
  });

  it('conserve contentJson brut si le JSON est invalide', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1' });

    await service.update('acc-1', 'camp-1', { contentJson: '{pas du json' });

    const data = prisma.campaign.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.contentJson).toBe('{pas du json');
  });

  it('connecte un segment du compte et force segmentId dans la réponse', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.segment.findUnique.mockResolvedValue({
      id: 'seg-1',
      accountId: 'acc-1',
    });
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1',
      segmentId: null,
    });

    const result = await service.update('acc-1', 'camp-1', {
      segmentId: 'seg-1',
    });
    expect((result as { segmentId?: string }).segmentId).toBe('seg-1');
  });

  it('rejette un segment appartenant à un autre compte (RG-13)', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.segment.findUnique.mockResolvedValue({
      id: 'seg-x',
      accountId: 'acc-autre',
    });

    await expect(
      service.update('acc-1', 'camp-1', { segmentId: 'seg-x' }),
    ).rejects.toThrow('Segment introuvable');
  });

  it('déconnecte le segment quand segmentId est vide', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp-1',
      segmentId: null,
    });

    await service.update('acc-1', 'camp-1', { segmentId: '', promoCode: 'X' });

    const data = prisma.campaign.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.segment).toEqual({ disconnect: true });
    expect(data.promoCode).toBe('X');
  });

  it('rejette scheduledAt invalide ou dans le passé', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);

    await expect(
      service.update('acc-1', 'camp-1', { scheduledAt: 'pas-une-date' }),
    ).rejects.toThrow('scheduledAt invalide');
    await expect(
      service.update('acc-1', 'camp-1', {
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toThrow('scheduledAt cannot be in the past');
  });

  it('planifie la campagne et enfile le job (même si la queue échoue)', async () => {
    const { service, prisma, scheduleQueue } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1' });
    const future = new Date(Date.now() + 3_600_000).toISOString();

    await service.update('acc-1', 'camp-1', { scheduledAt: future });
    expect(scheduleQueue.add).toHaveBeenCalledWith(
      'trigger-campaign',
      expect.objectContaining({ campaignId: 'camp-1', accountId: 'acc-1' }),
      expect.objectContaining({ jobId: 'sched-camp-1' }),
    );
    const data = prisma.campaign.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.status).toBe(CampaignStatus.SCHEDULED);

    // Échec d'enqueue: l'update doit quand même réussir (warn)
    scheduleQueue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.update('acc-1', 'camp-1', { scheduledAt: future }),
    ).resolves.toBeDefined();
  });

  it('traduit l’erreur Prisma P2025 en BadRequest', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
    prisma.campaign.update.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'P2025' }),
    );

    await expect(
      service.update('acc-1', 'camp-1', { name: 'X' }),
    ).rejects.toThrow('Resource related to update not found');
  });
});

describe('CampaignsService — delete / duplicate / get / lookups', () => {
  it('deleteCampaign refuse une campagne envoyée ou introuvable', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(null);
    await expect(service.deleteCampaign('acc-1', 'camp-1')).rejects.toThrow(
      'Campagne introuvable',
    );

    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp-1',
      status: CampaignStatus.SENT,
    });
    await expect(service.deleteCampaign('acc-1', 'camp-1')).rejects.toThrow(
      BadRequestException,
    );

    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp-1',
      status: CampaignStatus.DRAFT,
    });
    await expect(service.deleteCampaign('acc-1', 'camp-1')).resolves.toEqual({
      success: true,
      id: 'camp-1',
    });
    expect(prisma.campaign.delete).toHaveBeenCalled();
  });

  it('duplicateCampaign copie la campagne en brouillon', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(null);
    await expect(service.duplicateCampaign('acc-1', 'camp-x')).rejects.toThrow(
      NotFoundException,
    );

    prisma.campaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      name: 'Originale',
      contentJson: null,
      bestSendTime: null,
      subject: 'S',
      subjectA: null,
      subjectB: null,
      content: 'c',
      abSplitPct: 50,
      abTestDuration: 4,
      segmentId: 'seg-1',
      timezone: 'Africa/Abidjan',
      estimatedCost: null,
      estimatedRecipients: null,
      promoCode: null,
    });
    prisma.campaign.create.mockResolvedValue({ id: 'camp-2' });

    await service.duplicateCampaign('acc-1', 'camp-1');
    const data = prisma.campaign.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.name).toBe('Originale (copie)');
    expect(data.status).toBe(CampaignStatus.DRAFT);
    expect(data.scheduledAt).toBeNull();
  });

  it('get applique l’isolation par compte', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findUnique.mockResolvedValue(null);
    await expect(service.get('acc-1', 'camp-1')).rejects.toThrow(
      NotFoundException,
    );

    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      accountId: 'acc-autre',
    });
    await expect(service.get('acc-1', 'camp-1')).rejects.toThrow(
      ForbiddenException,
    );

    prisma.campaign.findUnique.mockResolvedValue(baseCampaign);
    await expect(service.get('acc-1', 'camp-1')).resolves.toEqual(baseCampaign);
  });

  it('findById / findFirstAccountId / findAccountIdBySegmentId', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1' });
    await expect(service.findById('camp-1')).resolves.toEqual({
      id: 'camp-1',
    });

    prisma.account.findFirst.mockResolvedValue(null);
    await expect(service.findFirstAccountId()).resolves.toBeNull();
    prisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
    await expect(service.findFirstAccountId()).resolves.toBe('acc-1');

    prisma.segment.findUnique.mockResolvedValue(null);
    await expect(service.findAccountIdBySegmentId('seg-1')).resolves.toBeNull();
    prisma.segment.findUnique.mockResolvedValue({ accountId: 'acc-1' });
    await expect(service.findAccountIdBySegmentId('seg-1')).resolves.toBe(
      'acc-1',
    );
  });

  it('listAutomationCampaigns filtre par canal en majuscules', async () => {
    const { service, prisma } = makeHarness();
    await service.listAutomationCampaigns('acc-1');
    expect(prisma.campaign.findMany.mock.calls[0][0].where).toEqual({
      accountId: 'acc-1',
      status: CampaignStatus.AUTOMATION,
    });
    await service.listAutomationCampaigns('acc-1', 'sms');
    expect(prisma.campaign.findMany.mock.calls[1][0].where).toMatchObject({
      channelType: 'SMS',
    });
  });
});

describe('CampaignsService.cancelScheduled', () => {
  it('valide existence, planification et délai de 5 minutes', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue(null);
    await expect(service.cancelScheduled('acc-1', 'camp-1')).rejects.toThrow(
      'Campagne introuvable',
    );

    prisma.campaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      scheduledAt: null,
    });
    await expect(service.cancelScheduled('acc-1', 'camp-1')).rejects.toThrow(
      'Campagne non planifiee',
    );

    prisma.campaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      scheduledAt: new Date(Date.now() + 60_000),
    });
    await expect(service.cancelScheduled('acc-1', 'camp-1')).rejects.toThrow(
      "Annulation impossible a moins de 5 minutes de l'envoi",
    );
  });

  it('annule la campagne et retire le job (tolère un échec queue)', async () => {
    const { service, prisma, scheduleQueue } = makeHarness();
    prisma.campaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      scheduledAt: new Date(Date.now() + 3_600_000),
    });

    await expect(service.cancelScheduled('acc-1', 'camp-1')).resolves.toEqual({
      success: true,
      id: 'camp-1',
      status: 'CANCELLED',
    });
    expect(scheduleQueue.remove).toHaveBeenCalledWith('sched-camp-1');

    scheduleQueue.remove.mockRejectedValueOnce(new Error('job parti'));
    await expect(
      service.cancelScheduled('acc-1', 'camp-1'),
    ).resolves.toMatchObject({ success: true });
  });
});

describe('CampaignsService — A/B testing', () => {
  it('updateABConfig délègue à prisma', async () => {
    const { service, prisma } = makeHarness();
    await service.updateABConfig('acc-1', 'camp-1', {
      subjectA: 'A',
      subjectB: 'B',
      abSplitPct: 30,
    });
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1', accountId: 'acc-1' },
      data: { subjectA: 'A', subjectB: 'B', abSplitPct: 30 },
    });
  });

  it('evaluateABWinner rejette une campagne non éligible', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      subjectB: null,
      sends: [],
    });
    await expect(service.evaluateABWinner('camp-1')).rejects.toThrow(
      'Campagne non éligible A/B',
    );
  });

  it('evaluateABWinner retourne le gagnant déjà évalué', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      subjectB: 'B',
      abWinner: 'A',
      sends: [],
    });
    await expect(service.evaluateABWinner('camp-1')).resolves.toEqual({
      winner: 'A',
      campaignId: 'camp-1',
      alreadyEvaluated: true,
    });
  });

  it('evaluateABWinner choisit B au meilleur taux d’ouverture et enfile le reste', async () => {
    const { service, prisma, dispatchQueue } = makeHarness();
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      subjectB: 'B',
      abWinner: null,
      sends: [
        { variant: 'A', openedAt: null, clickedAt: null },
        { variant: 'A', openedAt: null, clickedAt: null },
        { variant: 'B', openedAt: new Date(), clickedAt: new Date() },
        { variant: 'B', openedAt: null, clickedAt: null },
      ],
    });

    const result = await service.evaluateABWinner('camp-1');
    expect(result.winner).toBe('B');
    expect(prisma.aBTestResult.upsert).toHaveBeenCalledTimes(2);
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'dispatch-winner',
      expect.objectContaining({ variant: 'B', remainingContacts: true }),
      { removeOnComplete: true },
    );
  });

  it('evaluateABWinner choisit A en cas d’égalité (et sans envois)', async () => {
    const { service, prisma } = makeHarness();
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      subjectB: 'B',
      abWinner: null,
      sends: [],
    });
    const result = await service.evaluateABWinner('camp-1');
    expect(result.winner).toBe('A');
    expect(result.openRateA).toBe(0);
    expect(result.openRateB).toBe(0);
  });
});

describe('CampaignsService — bestSendTime et coût SMS', () => {
  it('getBestSendTime retourne la recommandation par défaut sans historique', async () => {
    const { service, prisma } = makeHarness();
    prisma.analytic.findMany.mockResolvedValue([]);
    await expect(service.getBestSendTime('acc-1')).resolves.toMatchObject({
      recommendedDay: 2,
      recommendedHour: 10,
      confidence: 60,
    });
  });

  it('getBestSendTime calcule le créneau le plus engagé', async () => {
    const { service, prisma } = makeHarness();
    // Mardi 10 juin 2026, 14h — 12 engagements dont des clics (poids 2)
    const slot = new Date('2026-06-09T14:30:00');
    prisma.analytic.findMany.mockResolvedValue(
      Array.from({ length: 12 }).map((_, i) => ({
        createdAt: slot,
        action: i % 2 === 0 ? 'Click' : 'Open',
      })),
    );

    const result = await service.getBestSendTime('acc-1');
    expect(result.recommendedDay).toBe(slot.getDay());
    expect(result.recommendedHour).toBe(slot.getHours());
    expect(result.basedOn).toBe(12);
  });

  it('calculateSmsCost segmente GSM-7 à 160 et unicode à 70 caractères', () => {
    const { service } = makeHarness();
    const gsm = service.calculateSmsCost('a'.repeat(161), 10);
    expect(gsm.parts).toBe(2);
    expect(gsm.cost).toBeCloseTo(2 * 10 * 0.015);

    const unicode = service.calculateSmsCost('é€'.repeat(40) + '😀', 1);
    expect(unicode.parts).toBeGreaterThanOrEqual(2);

    expect(service.calculateSmsCost('', 1).parts).toBe(1);
  });
});
