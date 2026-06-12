import { CampaignStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { CampaignsService } from './campaigns.service';
import { ContactsService } from '../contacts/contacts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignsService — CRUD et validations (NEW-T05)', () => {
  const prisma = {
    campaign: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    segment: {
      findUnique: jest.fn(),
    },
    job: {
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
    },
  };

  const queues = {
    dispatch: { add: jest.fn() },
    schedule: { add: jest.fn() },
  };

  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(
      prisma as unknown as PrismaService,
      {} as unknown as ContactsService,
      queues.dispatch as unknown as Queue,
      queues.schedule as unknown as Queue,
    );
  });

  describe('create — validations', () => {
    it('rejette un payload non-objet', async () => {
      await expect(service.create('acc-1', 'invalide')).rejects.toThrow(
        'Payload invalide',
      );
    });

    it('rejette une campagne sans channelType', async () => {
      await expect(
        service.create('acc-1', { name: 'Sans canal' }),
      ).rejects.toThrow('channelType est requis');
    });

    it('rejette le statut SCHEDULED sans scheduledAt (US-009)', async () => {
      await expect(
        service.create('acc-1', {
          channelType: 'EMAIL',
          status: 'SCHEDULED',
        }),
      ).rejects.toThrow('scheduledAt est requis');
    });

    it('rejette un nom de plus de 255 caractères', async () => {
      await expect(
        service.create('acc-1', {
          channelType: 'EMAIL',
          name: 'x'.repeat(256),
        }),
      ).rejects.toThrow('trop long');
    });

    it('rejette un SMS sans mention STOP (US-008)', async () => {
      prisma.campaign.create.mockResolvedValue({ id: 'camp-1' });
      prisma.campaign.delete.mockResolvedValue({});

      await expect(
        service.create('acc-1', {
          channelType: 'SMS',
          content: 'Promo -50% aujourd’hui seulement !',
        }),
      ).rejects.toThrow('STOP');
      // rollback de la campagne créée
      expect(prisma.campaign.delete).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
      });
    });

    it('accepte un SMS contenant STOP', async () => {
      prisma.campaign.create.mockResolvedValue({
        id: 'camp-1',
        channelType: 'SMS',
      });

      const campaign = await service.create('acc-1', {
        channelType: 'SMS',
        content: 'Promo -50% ! Envoyez STOP pour vous désabonner',
      });

      expect(campaign).toMatchObject({ id: 'camp-1' });
      expect(prisma.campaign.delete).not.toHaveBeenCalled();
      const payload = prisma.campaign.create.mock.calls[0][0].data;
      expect(payload.accountId).toBe('acc-1');
      expect(payload.status).toBe(CampaignStatus.DRAFT);
    });

    it('planifie la campagne quand scheduledAt est fourni', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.campaign.create.mockResolvedValue({
        id: 'camp-2',
        status: CampaignStatus.SCHEDULED,
      });

      await service.create('acc-1', {
        channelType: 'EMAIL',
        scheduledAt: future,
      });

      const payload = prisma.campaign.create.mock.calls[0][0].data;
      expect(payload.status).toBe(CampaignStatus.SCHEDULED);
      expect(payload.scheduledAt).toBeInstanceOf(Date);
      // Un job de planification BullMQ est créé (US-009)
      expect(prisma.job.create).toHaveBeenCalled();
      expect(queues.schedule.add).toHaveBeenCalled();
    });
  });

  describe('deleteCampaign — suppression bloquée si envoyée (NEW-T05)', () => {
    it('rejette une campagne introuvable', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.deleteCampaign('acc-1', 'camp-x')).rejects.toThrow(
        'Campagne introuvable',
      );
    });

    it('bloque la suppression d’une campagne SENT', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.SENT,
      });

      await expect(service.deleteCampaign('acc-1', 'camp-1')).rejects.toThrow(
        'Impossible de supprimer une campagne envoyée',
      );
      expect(prisma.campaign.delete).not.toHaveBeenCalled();
    });

    it('bloque la suppression d’une campagne SENDING', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.SENDING,
      });

      await expect(service.deleteCampaign('acc-1', 'camp-1')).rejects.toThrow();
      expect(prisma.campaign.delete).not.toHaveBeenCalled();
    });

    it('supprime une campagne DRAFT', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.DRAFT,
      });
      prisma.campaign.delete.mockResolvedValue({});

      const result = await service.deleteCampaign('acc-1', 'camp-1');

      expect(result).toEqual({ success: true, id: 'camp-1' });
    });
  });

  describe('duplicateCampaign', () => {
    it('rejette une campagne introuvable', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(
        service.duplicateCampaign('acc-1', 'camp-x'),
      ).rejects.toThrow('Campagne introuvable');
    });

    it('crée une copie DRAFT avec compteurs remis à zéro', async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: 'camp-1',
        accountId: 'acc-1',
        name: 'Lancement',
        channelType: 'EMAIL',
        status: CampaignStatus.SENT,
        subject: 'Sujet',
        subjectA: null,
        subjectB: null,
        content: 'corps',
        contentJson: null,
        abSplitPct: 50,
        abTestDuration: 4,
        segmentId: 'seg-1',
        timezone: 'Africa/Abidjan',
        bestSendTime: null,
        estimatedCost: null,
        estimatedRecipients: 100,
        promoCode: null,
        sentCount: 100,
      });
      prisma.campaign.create.mockResolvedValue({ id: 'camp-copy' });

      const copy = await service.duplicateCampaign('acc-1', 'camp-1');

      expect(copy).toMatchObject({ id: 'camp-copy' });
      const data = prisma.campaign.create.mock.calls[0][0].data;
      expect(data.name).toBe('Lancement (copie)');
      expect(data.status).toBe(CampaignStatus.DRAFT);
      expect(data.sentCount).toBe(0);
      expect(data.scheduledAt).toBeNull();
    });
  });
});
