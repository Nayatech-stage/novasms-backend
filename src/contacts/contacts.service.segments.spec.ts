import { ContactsService } from './contacts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SegmentRecalculationService } from '../queues/segment.recalculation.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('ContactsService — segmentation et contacts (US-005/US-006)', () => {
  const prisma = {
    contact: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    segment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    automation: { findFirst: jest.fn() },
    campaign: { findFirst: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    ),
  };

  const segmentRecalculationService = {
    addRecalculateAccountSegmentsJob: jest.fn().mockResolvedValue(undefined),
  };

  const eventEmitter = { emit: jest.fn() };

  let service: ContactsService;

  beforeEach(() => {
    jest.clearAllMocks();
    segmentRecalculationService.addRecalculateAccountSegmentsJob.mockResolvedValue(
      undefined,
    );
    prisma.segment.findMany.mockResolvedValue([]);
    service = new ContactsService(
      prisma as unknown as PrismaService,
      segmentRecalculationService as unknown as SegmentRecalculationService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  describe('buildWhereForSegment — critères ET/OU (US-005)', () => {
    it('combine les critères en AND', () => {
      const where = service.buildWhereForSegment('acc-1', 'AND', [
        { field: 'location', operator: 'equals', value: 'Abidjan' },
        { field: 'email', operator: 'contains', value: '@gmail' },
      ]);

      expect(where.accountId).toBe('acc-1');
      expect(where.AND).toHaveLength(2);
    });

    it('combine les critères en OR', () => {
      const where = service.buildWhereForSegment('acc-1', 'OR', [
        { field: 'location', operator: 'equals', value: 'Abidjan' },
        { field: 'location', operator: 'equals', value: 'Bouaké' },
      ]);

      expect(where.OR).toHaveLength(2);
    });

    it('ignore les critères incomplets', () => {
      const where = service.buildWhereForSegment('acc-1', 'AND', [
        { field: '', operator: 'equals', value: 'x' },
        { field: 'location', operator: '', value: 'x' },
      ] as never);

      // Aucun critère valide → where réduit à l'isolation par compte
      expect(where).toEqual({ accountId: 'acc-1' });
    });

    it('gère le statut inactive comme optOut=true', () => {
      const where = service.buildWhereForSegment('acc-1', 'AND', [
        { field: 'status', operator: 'equals', value: 'inactive' },
      ]);

      // Critère unique → fusionné directement dans le where
      expect(where).toEqual({ accountId: 'acc-1', optOut: true });
    });
  });

  describe('normalizeSegmentCriteria', () => {
    it('retourne le fallback pour une entrée invalide', () => {
      expect(service.normalizeSegmentCriteria(null)).toEqual({
        logic: 'AND',
        rules: [],
      });
      expect(service.normalizeSegmentCriteria('garbage')).toEqual({
        logic: 'AND',
        rules: [],
      });
    });

    it('filtre les champs et opérateurs invalides', () => {
      const result = service.normalizeSegmentCriteria({
        logic: 'OR',
        rules: [
          { field: 'location', operator: 'equals', value: 'Abidjan' },
          { field: 'champInconnu', operator: 'equals', value: 'x' },
          { field: 'email', operator: 'operateurInconnu', value: 'y' },
        ],
      });

      expect(result.logic).toBe('OR');
      expect(result.rules).toHaveLength(2);
      expect(result.rules[0]).toEqual({
        field: 'location',
        operator: 'equals',
        value: 'Abidjan',
      });
      // opérateur inconnu remplacé par equals
      expect(result.rules[1].operator).toBe('equals');
    });
  });

  describe('create — déduplication P2002', () => {
    it('retourne le contact existant avec alreadyExists sur contrainte unique email', async () => {
      const dupError = Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
      });
      prisma.contact.create.mockRejectedValue(dupError);
      prisma.contact.findFirst.mockResolvedValue({
        id: 'existant-1',
        email: 'doublon@x.ci',
      });

      const result = await service.create('acc-1', { email: 'doublon@x.ci' });

      expect(result).toMatchObject({
        id: 'existant-1',
        alreadyExists: true,
      });
    });

    it('propage les autres erreurs', async () => {
      prisma.contact.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.create('acc-1', { email: 'x@y.ci' }),
      ).rejects.toThrow('DB down');
    });

    it('émet contact.added après création', async () => {
      prisma.contact.create.mockResolvedValue({ id: 'new-1' });

      await service.create('acc-1', { email: 'new@x.ci' });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'contact.added',
        expect.objectContaining({ accountId: 'acc-1', contactId: 'new-1' }),
      );
    });
  });

  describe('update', () => {
    it("retourne null si le contact n'appartient pas au compte", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      const result = await service.update('acc-1', 'ct-x', {
        firstName: 'X',
      });

      expect(result).toBeNull();
      expect(prisma.contact.update).not.toHaveBeenCalled();
    });

    it('ne met à jour que les champs fournis', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1' });
      prisma.contact.update.mockResolvedValue({ id: 'ct-1' });

      await service.update('acc-1', 'ct-1', {
        firstName: 'Awa',
        optOut: true,
      });

      const data = prisma.contact.update.mock.calls[0][0].data;
      expect(data.firstName).toBe('Awa');
      expect(data.optOut).toBe(true);
      expect(data).not.toHaveProperty('email');
    });
  });

  describe('optOut — désabonnement (US-006)', () => {
    it('marque optOut avec horodatage RGPD', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1' });
      prisma.contact.update.mockResolvedValue({ id: 'ct-1', optOut: true });

      const result = await service.optOut('acc-1', 'ct-1');

      expect(result).toMatchObject({ optOut: true });
      const data = prisma.contact.update.mock.calls[0][0].data;
      expect(data.optOut).toBe(true);
      expect(data.optOutAt).toBeInstanceOf(Date);
    });

    it("retourne null pour un contact d'un autre compte", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      const result = await service.optOut('acc-1', 'ct-x');

      expect(result).toBeNull();
    });
  });

  describe('exportContact — export RGPD (US-006/EN-1682)', () => {
    const contact = {
      id: 'ct-1',
      email: 'awa@x.ci',
      phone: '+2250700000000',
      firstName: 'Awa',
      lastName: 'Koné, dite "AK"',
      location: 'Abidjan',
      tags: ['vip', 'fidele'],
      optOut: false,
      createdAt: new Date('2026-01-15T10:00:00Z'),
    };

    it("retourne null pour un contact d'un autre compte", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      const result = await service.exportContact('acc-1', 'ct-x');

      expect(result).toBeNull();
    });

    it('exporte en JSON complet', async () => {
      prisma.contact.findFirst.mockResolvedValue(contact);

      const json = await service.exportContact('acc-1', 'ct-1', 'json');

      expect(JSON.parse(json as string)).toMatchObject({
        id: 'ct-1',
        email: 'awa@x.ci',
      });
    });

    it('exporte en CSV avec échappement des virgules et guillemets', async () => {
      prisma.contact.findFirst.mockResolvedValue(contact);

      const csv = (await service.exportContact(
        'acc-1',
        'ct-1',
        'csv',
      )) as string;
      const [headers, row] = csv.split('\n');

      expect(headers).toContain('Email');
      expect(row).toContain('awa@x.ci');
      expect(row).toContain('vip;fidele');
      // Nom contenant virgule + guillemets → échappé CSV
      expect(row).toContain('"Koné, dite ""AK"""');
    });
  });

  describe('createSegment — statique vs dynamique (US-005)', () => {
    it('crée un segment statique depuis des contactIds dédupliqués', async () => {
      prisma.contact.count.mockResolvedValue(2);
      prisma.segment.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'seg-1', ...data }),
      );

      await service.createSegment('acc-1', {
        name: 'Sélection manuelle',
        logic: 'AND',
        criteria: [],
        contactIds: ['ct-1', 'ct-2', 'ct-1', '  '],
      });

      const data = prisma.segment.create.mock.calls[0][0].data;
      expect(data.type).toBe('static');
      expect(data.criteria.contactIds).toEqual(['ct-1', 'ct-2']);
      expect(data.contactCount).toBe(2);
      // les contacts désabonnés sont exclus du comptage
      expect(prisma.contact.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ optOut: false }),
      });
    });

    it('crée un segment dynamique avec critères et compteur initial', async () => {
      prisma.contact.count.mockResolvedValue(42);
      prisma.segment.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'seg-2', ...data }),
      );

      await service.createSegment('acc-1', {
        name: 'Abidjan',
        logic: 'AND',
        criteria: [{ field: 'location', operator: 'equals', value: 'Abidjan' }],
      });

      const data = prisma.segment.create.mock.calls[0][0].data;
      expect(data.type).toBe('dynamic');
      expect(data.criteria.rules).toHaveLength(1);
      expect(data.contactCount).toBe(42);
    });
  });

  describe('deleteSegment — suppressions protégées (NEW-S402)', () => {
    beforeEach(() => {
      prisma.segment.findFirst.mockResolvedValue({ id: 'seg-1' });
      prisma.automation.findFirst.mockResolvedValue(null);
      prisma.campaign.findFirst.mockResolvedValue(null);
    });

    it('retourne null pour un segment introuvable', async () => {
      prisma.segment.findFirst.mockResolvedValue(null);

      const result = await service.deleteSegment('acc-1', 'seg-x');

      expect(result).toBeNull();
    });

    it('bloque la suppression si une automatisation active utilise le segment', async () => {
      prisma.automation.findFirst.mockResolvedValue({ id: 'auto-1' });

      await expect(service.deleteSegment('acc-1', 'seg-1')).rejects.toThrow(
        'automatisation active',
      );
      expect(prisma.segment.delete).not.toHaveBeenCalled();
    });

    it('bloque la suppression si une campagne planifiée cible le segment', async () => {
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp-1' });

      await expect(service.deleteSegment('acc-1', 'seg-1')).rejects.toThrow(
        'campagne planifiée',
      );
    });

    it('détache les brouillons puis supprime le segment', async () => {
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
      prisma.segment.delete.mockResolvedValue({});

      const result = await service.deleteSegment('acc-1', 'seg-1');

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('updateSegment (US-005)', () => {
    it('lève NotFound pour un segment inconnu', async () => {
      prisma.segment.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSegment('acc-1', 'seg-x', { name: 'X' }),
      ).rejects.toThrow('Segment non trouve');
    });

    it('refuse un segment dynamique sans aucun critère', async () => {
      prisma.segment.findFirst.mockResolvedValue({
        id: 'seg-1',
        name: 'Ancien',
        type: 'dynamic',
        criteria: { logic: 'AND', rules: [] },
      });

      await expect(
        service.updateSegment('acc-1', 'seg-1', { criteria: [] }),
      ).rejects.toThrow('au moins un critère');
    });

    it('recalcule le compteur lors de la mise à jour dynamique', async () => {
      prisma.segment.findFirst.mockResolvedValue({
        id: 'seg-1',
        name: 'Ancien',
        type: 'dynamic',
        criteria: { logic: 'AND', rules: [] },
      });
      prisma.contact.count.mockResolvedValue(7);
      prisma.segment.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'seg-1', ...data }),
      );

      const result = await service.updateSegment('acc-1', 'seg-1', {
        name: 'Abidjan',
        logic: 'OR',
        criteria: [{ field: 'location', operator: 'equals', value: 'Abidjan' }],
      });

      expect(result.contactCount).toBe(7);
      const data = prisma.segment.update.mock.calls[0][0].data;
      expect(data.criteria.logic).toBe('OR');
    });

    it('convertit en statique avec les contactIds fournis', async () => {
      prisma.segment.findFirst.mockResolvedValue({
        id: 'seg-1',
        name: 'Ancien',
        type: 'dynamic',
        criteria: {},
      });
      prisma.contact.count.mockResolvedValue(2);
      prisma.segment.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'seg-1', ...data }),
      );

      const result = await service.updateSegment('acc-1', 'seg-1', {
        type: 'static',
        contactIds: ['ct-1', 'ct-2'],
      });

      expect(result.type).toBe('static');
      expect(result.criteria.contactIds).toEqual(['ct-1', 'ct-2']);
    });
  });

  describe('countSegmentContacts / getSegmentContactsForCampaign', () => {
    it('compte tous les contacts actifs sans segmentId', async () => {
      prisma.contact.count.mockResolvedValue(120);

      const count = await service.countSegmentContacts('acc-1');

      expect(count).toBe(120);
      expect(prisma.contact.count).toHaveBeenCalledWith({
        where: { accountId: 'acc-1', optOut: false },
      });
    });

    it("retourne 0 (fail-safe) pour un segment d'un autre compte", async () => {
      prisma.segment.findUnique = jest.fn().mockResolvedValue({
        id: 'seg-1',
        accountId: 'acc-AUTRE',
      });

      const count = await service.countSegmentContacts('acc-1', 'seg-1');

      expect(count).toBe(0);
    });

    it('utilise le contactCount précalculé pour un segment dynamique', async () => {
      prisma.segment.findUnique = jest.fn().mockResolvedValue({
        id: 'seg-1',
        accountId: 'acc-1',
        type: 'dynamic',
        contactCount: 55,
      });

      const count = await service.countSegmentContacts('acc-1', 'seg-1');

      expect(count).toBe(55);
    });

    it('getSegmentContactsForCampaign exclut les désabonnés du segment statique', async () => {
      prisma.segment.findUnique = jest.fn().mockResolvedValue({
        id: 'seg-1',
        accountId: 'acc-1',
        type: 'static',
        criteria: { contactIds: ['ct-1', 'ct-2'] },
      });
      prisma.contact.findMany.mockResolvedValue([{ id: 'ct-1' }]);

      const contacts = await service.getSegmentContactsForCampaign(
        'acc-1',
        'seg-1',
      );

      expect(contacts).toHaveLength(1);
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['ct-1', 'ct-2'] },
            optOut: false,
          }),
        }),
      );
    });

    it('getSegmentContactsForCampaign retourne [] en cas d’erreur (fail-safe)', async () => {
      prisma.segment.findUnique = jest
        .fn()
        .mockRejectedValue(new Error('DB down'));

      const contacts = await service.getSegmentContactsForCampaign(
        'acc-1',
        'seg-1',
      );

      expect(contacts).toEqual([]);
    });
  });

  describe('addNote (US-006)', () => {
    it('lève NotFound pour un contact inconnu', async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(service.addNote('acc-1', 'ct-x', 'Note')).rejects.toThrow(
        'Contact introuvable',
      );
    });

    it('ajoute la note en jsonb et retourne la liste à jour', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1' });
      const storedNotes = [
        { id: 'n-1', content: 'Ancienne', createdAt: '2026-01-01' },
        { id: 'n-2', content: 'Nouvelle', createdAt: '2026-06-12' },
      ];
      (prisma as Record<string, unknown>).$executeRaw = jest
        .fn()
        .mockResolvedValue(1);
      (prisma as Record<string, unknown>).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ notes: storedNotes }]);

      const notes = await service.addNote('acc-1', 'ct-1', 'Nouvelle');

      expect(notes).toEqual(storedNotes);
    });
  });
});
