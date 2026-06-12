import { ImportService } from './import.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('ImportService — import contacts (RG-08/RG-11/RG-13)', () => {
  const prisma = {
    contact: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    importReport: {
      create: jest.fn(),
    },
  };

  const eventEmitter = {
    emit: jest.fn(),
  };

  let service: ImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ImportService(
      prisma as unknown as PrismaService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  describe('processBatch', () => {
    it('rejette les lignes sans email ni téléphone', async () => {
      prisma.contact.findMany.mockResolvedValue([]);

      const result = await service.processBatch('acc-1', [
        { firstName: 'Sans', lastName: 'Coordonnees' },
      ]);

      expect(result.errors).toBe(1);
      expect(result.success).toBe(0);
      expect(result.details[0].error).toBe('Email ou téléphone requis');
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });

    it('déduplique contre les contacts existants en base (RG-11)', async () => {
      prisma.contact.findMany.mockResolvedValue([
        { id: 'old-1', email: 'deja@present.ci', phone: null },
      ]);

      const result = await service.processBatch('acc-1', [
        { email: 'deja@present.ci', firstName: 'Doublon' },
      ]);

      expect(result.duplicates).toBe(1);
      expect(result.success).toBe(0);
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });

    it('déduplique aussi au sein du même batch', async () => {
      prisma.contact.findMany.mockResolvedValue([]);
      prisma.contact.create.mockResolvedValue({ id: 'new-1' });

      const result = await service.processBatch('acc-1', [
        { email: 'nouveau@client.ci' },
        { email: 'nouveau@client.ci' },
      ]);

      expect(result.success).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(prisma.contact.create).toHaveBeenCalledTimes(1);
    });

    it('crée les contacts avec isolation accountId et émet contact.added (RG-13)', async () => {
      prisma.contact.findMany.mockResolvedValue([]);
      prisma.contact.create.mockResolvedValue({
        id: 'new-1',
        email: 'a@b.ci',
      });

      const result = await service.processBatch('acc-1', [
        { email: 'a@b.ci', phone: 225070000, firstName: 'Awa', tags: ['vip'] },
      ]);

      expect(result.success).toBe(1);
      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: {
          accountId: 'acc-1',
          email: 'a@b.ci',
          phone: '225070000',
          firstName: 'Awa',
          lastName: null,
          tags: ['vip'],
          optOut: false,
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'contact.added',
        expect.objectContaining({ accountId: 'acc-1', contactId: 'new-1' }),
      );
    });

    it('comptabilise les erreurs de création sans interrompre le batch', async () => {
      prisma.contact.findMany.mockResolvedValue([]);
      prisma.contact.create
        .mockRejectedValueOnce(new Error('DB indisponible'))
        .mockResolvedValueOnce({ id: 'new-2' });

      const result = await service.processBatch('acc-1', [
        { email: 'ko@x.ci' },
        { email: 'ok@x.ci' },
      ]);

      expect(result.errors).toBe(1);
      expect(result.success).toBe(1);
      expect(result.details[0].error).toBe('DB indisponible');
    });
  });

  describe('processFullImport', () => {
    it('découpe en batches, agrège les compteurs et génère le rapport (RG-12)', async () => {
      prisma.contact.findMany.mockResolvedValue([]);
      prisma.contact.create.mockResolvedValue({ id: 'new' });
      prisma.importReport.create.mockResolvedValue({
        totalRecords: 3,
        successCount: 3,
        duplicateCount: 0,
        errorCount: 0,
      });

      const rows = [
        { email: 'a@x.ci' },
        { email: 'b@x.ci' },
        { email: 'c@x.ci' },
      ];
      const result = await service.processFullImport(
        'acc-1',
        'contacts.csv',
        rows,
      );

      expect(result.status).toBe('completed');
      expect(result.report).toMatchObject({
        fileName: 'contacts.csv',
        totalRecords: 3,
        successCount: 3,
      });
      expect(prisma.importReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-1',
          fileName: 'contacts.csv',
          totalRecords: 3,
          successCount: 3,
        }),
      });
    });
  });

  describe('generateReport', () => {
    it('calcule totalRecords quand total absent', async () => {
      prisma.importReport.create.mockResolvedValue({ id: 'rep-1' });

      await service.generateReport('acc-1', 'f.csv', {
        success: 5,
        duplicates: 2,
        errors: 1,
      });

      expect(prisma.importReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ totalRecords: 8 }),
      });
    });
  });
});
