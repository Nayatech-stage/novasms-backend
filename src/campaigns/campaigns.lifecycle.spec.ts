import { CampaignStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { CampaignsService } from './campaigns.service';
import { ContactsService } from '../contacts/contacts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignsService — cycle de vie (US-009 / NEW-T05)', () => {
  const prisma = {
    campaign: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    segment: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const dispatchQueue = { add: jest.fn() };
  const scheduleQueue = { add: jest.fn(), remove: jest.fn() };

  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(
      prisma as unknown as PrismaService,
      {} as unknown as ContactsService,
      dispatchQueue as unknown as Queue,
      scheduleQueue as unknown as Queue,
    );
  });

  describe('list — pagination et filtres', () => {
    it('borne la pagination (limit max 100, page min 1)', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.list('acc-1', { page: -3, limit: 500 });

      // $transaction reçoit [findMany, count] — on vérifie les arguments construits
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('filtre par statut, canal et recherche par nom', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.list('acc-1', {
        status: 'sent',
        channel: 'email',
        search: 'promo',
      });

      const where = prisma.campaign.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        accountId: 'acc-1',
        status: 'SENT',
        channelType: 'EMAIL',
        name: { contains: 'promo', mode: 'insensitive' },
      });
    });

    it('ignore un statut invalide', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.list('acc-1', { status: 'BIDON' });

      const where = prisma.campaign.findMany.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
    });
  });

  describe('saveDraft', () => {
    it('rejette une campagne introuvable', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(
        service.saveDraft('acc-1', 'camp-x', { name: 'Brouillon' }),
      ).rejects.toThrow('Erreur lors de la sauvegarde');
    });

    it('sauvegarde le brouillon en DRAFT avec les champs fournis', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp-1' });
      prisma.campaign.update.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.DRAFT,
      });

      const result = await service.saveDraft('acc-1', 'camp-1', {
        name: 'Mon brouillon',
        subject: 'Sujet',
      });

      expect(result.status).toBe(CampaignStatus.DRAFT);
      const data = prisma.campaign.update.mock.calls[0][0].data;
      expect(data.status).toBe(CampaignStatus.DRAFT);
      expect(data.name).toBe('Mon brouillon');
    });

    it('préserve le statut AUTOMATION quand demandé', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp-1' });
      prisma.campaign.update.mockResolvedValue({ id: 'camp-1' });

      await service.saveDraft('acc-1', 'camp-1', { status: 'AUTOMATION' });

      const data = prisma.campaign.update.mock.calls[0][0].data;
      expect(data.status).toBe(CampaignStatus.AUTOMATION);
    });

    it('passe en SCHEDULED quand scheduledAt est fourni', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp-1' });
      prisma.campaign.update.mockResolvedValue({ id: 'camp-1' });
      const future = new Date(Date.now() + 3600_000).toISOString();

      await service.saveDraft('acc-1', 'camp-1', { scheduledAt: future });

      const data = prisma.campaign.update.mock.calls[0][0].data;
      expect(data.status).toBe(CampaignStatus.SCHEDULED);
      expect(data.scheduledAt).toBeInstanceOf(Date);
    });

    it('connecte ou déconnecte le segment selon segmentId', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp-1' });
      prisma.campaign.update.mockResolvedValue({ id: 'camp-1' });

      await service.saveDraft('acc-1', 'camp-1', { segmentId: 'seg-1' });
      await service.saveDraft('acc-1', 'camp-1', { segmentId: null });

      expect(prisma.campaign.update.mock.calls[0][0].data.segment).toEqual({
        connect: { id: 'seg-1' },
      });
      expect(prisma.campaign.update.mock.calls[1][0].data.segment).toEqual({
        disconnect: true,
      });
    });
  });

  describe('cancelCampaign — annulation (US-009)', () => {
    it('rejette une campagne introuvable', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.cancelCampaign('acc-1', 'camp-x')).rejects.toThrow(
        'Campagne non trouvée',
      );
    });

    it("refuse d'annuler une campagne déjà envoyée", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.SENT,
      });

      await expect(service.cancelCampaign('acc-1', 'camp-1')).rejects.toThrow(
        "Impossible d'annuler une campagne sent",
      );
    });

    it('annule un brouillon sans toucher à la queue', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.DRAFT,
      });
      prisma.campaign.update.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.CANCELLED,
      });

      const result = await service.cancelCampaign('acc-1', 'camp-1');

      expect(result.status).toBe(CampaignStatus.CANCELLED);
      expect(scheduleQueue.remove).not.toHaveBeenCalled();
    });

    it('annule une campagne planifiée et retire le job de la queue', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.SCHEDULED,
      });
      prisma.campaign.update.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.CANCELLED,
      });
      scheduleQueue.remove.mockResolvedValue(undefined);

      await service.cancelCampaign('acc-1', 'camp-1');

      expect(scheduleQueue.remove).toHaveBeenCalledWith('sched-camp-1');
    });

    it("n'échoue pas si le retrait de la queue échoue (fail-safe)", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.SCHEDULED,
      });
      prisma.campaign.update.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.CANCELLED,
      });
      scheduleQueue.remove.mockRejectedValue(new Error('job introuvable'));

      const result = await service.cancelCampaign('acc-1', 'camp-1');

      expect(result.status).toBe(CampaignStatus.CANCELLED);
    });
  });

  describe('validateSchedule (US-009)', () => {
    it('rejette une campagne introuvable', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(
        service.validateSchedule('acc-1', 'camp-x', {}),
      ).rejects.toThrow('Campagne non trouvée');
    });

    it('valide un envoi planifié avec timezone et avertissements SMS', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        name: 'Flash SMS',
        channelType: 'SMS',
        segmentId: 'seg-1',
      });
      const future = new Date(Date.now() + 3600_000).toISOString();

      const result = await service.validateSchedule('acc-1', 'camp-1', {
        immediateOrScheduled: 'scheduled',
        scheduledAt: future,
        timezone: 'Africa/Abidjan',
      });

      expect(result.isValid).toBe(true);
      expect(result.immediateOrScheduled).toBe('scheduled');
      expect(result.scheduledAt).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('cancelScheduled — fenêtre des 5 minutes (US-009)', () => {
    it('refuse une campagne non planifiée', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        scheduledAt: null,
      });

      await expect(service.cancelScheduled('acc-1', 'camp-1')).rejects.toThrow(
        'Campagne non planifiee',
      );
    });

    it("refuse l'annulation à moins de 5 minutes de l'envoi", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        scheduledAt: new Date(Date.now() + 2 * 60 * 1000),
      });

      await expect(service.cancelScheduled('acc-1', 'camp-1')).rejects.toThrow(
        'moins de 5 minutes',
      );
    });

    it('annule et retire le job de la queue au-delà de 5 minutes', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      prisma.campaign.update.mockResolvedValue({});
      scheduleQueue.remove.mockResolvedValue(undefined);

      const result = await service.cancelScheduled('acc-1', 'camp-1');

      expect(result).toEqual({
        success: true,
        id: 'camp-1',
        status: 'CANCELLED',
      });
      expect(scheduleQueue.remove).toHaveBeenCalledWith('sched-camp-1');
    });
  });

  describe('updateABConfig (US-010)', () => {
    it('met à jour sujets A/B et split', async () => {
      prisma.campaign.update.mockResolvedValue({ id: 'camp-1' });

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
  });

  describe('sendCampaign — validations préalables (EN-1685)', () => {
    const makeContactsService = (contacts: Array<Record<string, unknown>>) => ({
      getSegmentContactsForCampaign: jest.fn().mockResolvedValue(contacts),
    });

    it('retourne une erreur pour une campagne introuvable', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      const result = await service.sendCampaign('acc-1', 'camp-x', {});

      expect(result).toEqual({ success: false, error: 'Campagne non trouvée' });
    });

    it('exige un segment sélectionné', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        segmentId: null,
      });

      const result = await service.sendCampaign('acc-1', 'camp-1', {});

      expect(result).toEqual({
        success: false,
        error: 'Segment non sélectionné',
      });
    });

    it('échoue proprement quand le segment est vide', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        segmentId: 'seg-1',
        channelType: 'EMAIL',
      });
      const contactsService = makeContactsService([]);
      const svc = new CampaignsService(
        prisma as unknown as PrismaService,
        contactsService as unknown as ContactsService,
        dispatchQueue as unknown as Queue,
        scheduleQueue as unknown as Queue,
      );

      const result = await svc.sendCampaign('acc-1', 'camp-1', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Aucun contact');
    });

    it('rejette un envoi SMS quand aucun numéro n’est valide', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        segmentId: 'seg-1',
        channelType: 'SMS',
        subjectB: null,
      });
      const contactsService = makeContactsService([
        { id: 'ct-1', email: null, phone: 'pas-un-numero' },
      ]);
      const svc = new CampaignsService(
        prisma as unknown as PrismaService,
        contactsService as unknown as ContactsService,
        dispatchQueue as unknown as Queue,
        scheduleQueue as unknown as Queue,
      );

      const result = await svc.sendCampaign('acc-1', 'camp-1', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('numéro de téléphone valide');
    });
  });
});
