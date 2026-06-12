import { CampaignStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { CampaignScheduleProcessor } from './campaign.schedule.queue';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignScheduleProcessor — déclenchement planifié (US-009/EN-1657)', () => {
  const prisma = {
    campaign: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    account: {
      findUnique: jest.fn(),
    },
    send: {
      count: jest.fn(),
    },
  };

  const dispatchQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    clean: jest.fn().mockResolvedValue(undefined),
  };

  const baseCampaign = {
    id: 'camp-1',
    accountId: 'acc-1',
    status: CampaignStatus.SCHEDULED,
    subjectB: null,
    estimatedCost: 100,
    abTestDuration: 4,
  };

  const job = {
    data: { campaignId: 'camp-1', accountId: 'acc-1', channelType: 'EMAIL' },
  } as never;

  let processor: CampaignScheduleProcessor;
  let hoursSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // Forcer une heure d'envoi autorisée (12h UTC)
    hoursSpy = jest.spyOn(Date.prototype, 'getUTCHours').mockReturnValue(12);
    processor = new CampaignScheduleProcessor(
      prisma as unknown as PrismaService,
      dispatchQueue as unknown as Queue,
    );
    prisma.account.findUnique.mockResolvedValue({ creditBalance: 10_000 });
  });

  afterEach(() => {
    hoursSpy.mockRestore();
  });

  it('échoue proprement si la campagne est introuvable', async () => {
    prisma.campaign.findUnique.mockResolvedValue(null);

    const result = await processor.process(job);

    expect(result).toEqual({ success: false, error: 'Campaign not found' });
  });

  it("refuse un job dont l'accountId ne correspond pas (isolation)", async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      accountId: 'acc-AUTRE',
    });

    const result = await processor.process(job);

    expect(result).toEqual({
      success: false,
      error: 'Campaign/account mismatch',
    });
  });

  it('ignore une campagne annulée et nettoie les jobs en attente', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      status: CampaignStatus.CANCELLED,
    });

    const result = await processor.process(job);

    expect(result).toEqual({ success: false, reason: 'cancelled' });
    expect(dispatchQueue.clean).toHaveBeenCalled();
  });

  it('reporte de 30 min pendant les heures de silence (22h-8h UTC)', async () => {
    hoursSpy.mockReturnValue(23);
    prisma.campaign.findUnique.mockResolvedValue(baseCampaign);

    const result = await processor.process(job);

    expect(result).toEqual({
      success: false,
      reason: 'quiet-hours-deferred',
    });
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'reschedule-quiet-hours',
      job['data'],
      expect.objectContaining({ delay: 30 * 60 * 1000 }),
    );
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('passe la campagne en FAILED si le solde est insuffisant (NEW-CR1)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      estimatedCost: 50_000,
    });
    prisma.account.findUnique.mockResolvedValue({ creditBalance: 100 });

    const result = await processor.process(job);

    expect(result).toEqual({ success: false, error: 'Insufficient credits' });
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: CampaignStatus.FAILED },
    });
  });

  it('déclenche un dispatch simple pour une campagne sans test A/B', async () => {
    prisma.campaign.findUnique.mockResolvedValue(baseCampaign);

    const result = await processor.process(job);

    expect(result).toEqual({ success: true, campaignId: 'camp-1' });
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: CampaignStatus.SENDING },
    });
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      'dispatch-campaign',
      { campaignId: 'camp-1', chunkSize: 500, cursor: null },
      expect.objectContaining({ jobId: 'dispatch-camp-1' }),
    );
  });

  it('déclenche les variantes A/B et planifie l’évaluation du gagnant (US-010)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      subjectB: 'Variante B',
    });
    prisma.send.count.mockResolvedValueOnce(5).mockResolvedValueOnce(5);

    const result = await processor.process(job);

    expect(result.success).toBe(true);
    const jobNames = dispatchQueue.add.mock.calls.map((c) => c[0]);
    expect(jobNames).toContain('dispatch-campaign');
    expect(jobNames).toContain('evaluate-ab-winner');
    // évaluation différée de abTestDuration heures
    const evalCall = dispatchQueue.add.mock.calls.find(
      (c) => c[0] === 'evaluate-ab-winner',
    );
    expect(evalCall?.[2].delay).toBe(4 * 60 * 60 * 1000);
  });
});
