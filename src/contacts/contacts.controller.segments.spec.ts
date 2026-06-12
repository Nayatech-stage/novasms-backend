import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ImportService } from './import.service';
import { importQueue } from '../queues/import.queue';

jest.mock('../queues/import.queue', () => ({
  importQueue: { getJob: jest.fn() },
}));

const getJobMock = importQueue.getJob as jest.Mock;

describe('ContactsController — segments et import par chunks', () => {
  const contactsService = {
    previewSegment: jest.fn(),
    listSegments: jest.fn(),
    listSegmentsWithContacts: jest.fn(),
    createSegment: jest.fn(),
    countSegmentContacts: jest.fn(),
    getSegmentWithContacts: jest.fn(),
    updateSegment: jest.fn(),
    deleteSegment: jest.fn(),
    createAuditLog: jest.fn(),
  };

  const importService = {
    startImport: jest.fn(),
    processFullImportFromFile: jest.fn(),
  };

  const req = { accountId: 'acc-1' } as never;
  const reqAnonyme = {} as never;

  let controller: ContactsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ContactsController(
      importService as unknown as ImportService,
      contactsService as unknown as ContactsService,
    );
  });

  // ─── Import par chunks ────────────────────────────────────────────────────

  describe('import par chunks (start / chunk / complete)', () => {
    it('startImport rejette sans accountId', async () => {
      await expect(
        controller.startImport({ fileName: 'f.csv' }, reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });

    it('startImport crée un fileId et le fichier temporaire', async () => {
      const result = await controller.startImport({ fileName: 'f.csv' }, req);
      expect(result.success).toBe(true);
      expect(result.fileId).toBeTruthy();
    });

    it('uploadImportChunk rejette fileId/rows manquants', async () => {
      await expect(
        controller.uploadImportChunk(
          { fileId: '', rows: [] as Record<string, unknown>[] },
          req,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.uploadImportChunk(
          { fileId: 'x', rows: 'pas-un-tableau' as never },
          req,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.uploadImportChunk({ fileId: 'x', rows: [] }, reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });

    it('uploadImportChunk rejette un fileId inconnu', async () => {
      await expect(
        controller.uploadImportChunk(
          { fileId: 'inexistant', rows: [{ a: 1 }] },
          req,
        ),
      ).rejects.toThrow('fileId introuvable');
    });

    it('uploadImportChunk ajoute les lignes au fichier existant', async () => {
      const { fileId } = await controller.startImport(
        { fileName: 'f.csv' },
        req,
      );
      const result = await controller.uploadImportChunk(
        { fileId, rows: [{ telephone: '+2250700000001' }] },
        req,
      );
      expect(result).toEqual({ success: true });
    });

    it('completeImport rejette sans accountId ou sans fileId', async () => {
      await expect(
        controller.completeImport(
          { fileId: 'x', fileName: 'f.csv' },
          reqAnonyme,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.completeImport({ fileId: '', fileName: 'f.csv' }, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('completeImport rejette un fileId inconnu', async () => {
      await expect(
        controller.completeImport(
          { fileId: 'inexistant', fileName: 'f.csv' },
          req,
        ),
      ).rejects.toThrow('fileId introuvable');
    });

    it('completeImport lance le traitement streaming (fileName par défaut)', async () => {
      importService.processFullImportFromFile.mockResolvedValue({
        imported: 3,
      });
      const { fileId } = await controller.startImport(
        { fileName: 'f.csv' },
        req,
      );
      const result = await controller.completeImport(
        { fileId, fileName: '' },
        req,
      );
      expect(result).toEqual({ success: true, result: { imported: 3 } });
      expect(importService.processFullImportFromFile).toHaveBeenCalledWith(
        'acc-1',
        `import-${fileId}.ndjson`,
        expect.stringContaining(`${fileId}.ndjson`),
      );
    });
  });

  describe('getImportStatus', () => {
    it('rejette sans accountId', async () => {
      await expect(
        controller.getImportStatus('j-1', reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });

    it('retourne introuvable si le job n’existe pas', async () => {
      getJobMock.mockResolvedValue(null);
      await expect(controller.getImportStatus('j-1', req)).resolves.toEqual({
        success: false,
        message: 'Job introuvable',
      });
    });

    it('retourne le rapport quand le job est terminé', async () => {
      getJobMock.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue: { imported: 5 },
      });
      await expect(controller.getImportStatus('j-1', req)).resolves.toEqual({
        success: true,
        status: 'completed',
        report: { imported: 5 },
      });
    });

    it('retourne l’état courant pour un job en cours', async () => {
      getJobMock.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
      });
      await expect(controller.getImportStatus('j-1', req)).resolves.toEqual({
        success: true,
        status: 'active',
      });
    });
  });

  // ─── Segments ─────────────────────────────────────────────────────────────

  describe('preview', () => {
    it('rejette sans accountId', async () => {
      await expect(controller.preview({}, reqAnonyme)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('délègue un payload valide au service', async () => {
      contactsService.previewSegment.mockResolvedValue({ count: 4 });
      const result = await controller.preview(
        { logic: 'AND', criteria: [] },
        req,
      );
      expect(result).toEqual({ count: 4 });
      expect(contactsService.previewSegment).toHaveBeenCalledWith('acc-1', {
        logic: 'AND',
        criteria: [],
      });
    });

    it('rejette un payload invalide (trop de critères)', async () => {
      await expect(
        controller.preview({ criteria: new Array(25).fill({}) }, req),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listSegments / listSegmentsWithContacts', () => {
    it('listSegments enveloppe la réponse dans data', async () => {
      contactsService.listSegments.mockResolvedValue([{ id: 's-1' }]);
      await expect(controller.listSegments(req)).resolves.toEqual({
        data: [{ id: 's-1' }],
      });
      await expect(controller.listSegments(reqAnonyme)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('listSegmentsWithContacts parse la limite et ignore une limite invalide', async () => {
      contactsService.listSegmentsWithContacts.mockResolvedValue([]);
      await controller.listSegmentsWithContacts('5', req);
      expect(contactsService.listSegmentsWithContacts).toHaveBeenCalledWith(
        'acc-1',
        5,
      );
      await controller.listSegmentsWithContacts('abc', req);
      expect(contactsService.listSegmentsWithContacts).toHaveBeenLastCalledWith(
        'acc-1',
        undefined,
      );
      await expect(
        controller.listSegmentsWithContacts('5', reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createSegment', () => {
    it('crée le segment et journalise un audit log', async () => {
      contactsService.createSegment.mockResolvedValue({
        id: 's-1',
        name: 'VIP Abidjan',
        contactCount: 12,
      });
      const result = await controller.createSegment(
        { name: 'VIP Abidjan', logic: 'AND', criteria: [] },
        req,
      );
      expect(result.success).toBe(true);
      expect(result.id).toBe('s-1');
      expect(result.message).toContain('12 contacts');
      expect(contactsService.createAuditLog).toHaveBeenCalledWith(
        'acc-1',
        'segment_created',
        { segmentId: 's-1', name: 'VIP Abidjan' },
      );
    });

    it('rejette un nom invalide', async () => {
      await expect(
        controller.createSegment({ name: '<script>' }, req),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.createSegment({ name: 'OK' }, reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('countSegmentContacts', () => {
    it('retourne le compte du service', async () => {
      contactsService.countSegmentContacts.mockResolvedValue(7);
      await expect(
        controller.countSegmentContacts('s-1', req),
      ).resolves.toEqual({
        segmentId: 's-1',
        count: 7,
        message: '7 contact(s) actif(s) dans ce segment',
      });
    });

    it('convertit une erreur service en BadRequest', async () => {
      contactsService.countSegmentContacts.mockRejectedValue(
        new Error('segment inconnu'),
      );
      await expect(
        controller.countSegmentContacts('s-404', req),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.countSegmentContacts('s-1', reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSegment / updateSegment / deleteSegment', () => {
    it('getSegment lève NotFound si absent', async () => {
      contactsService.getSegmentWithContacts.mockResolvedValue(null);
      await expect(controller.getSegment('s-404', req)).rejects.toThrow(
        NotFoundException,
      );
      contactsService.getSegmentWithContacts.mockResolvedValue({ id: 's-1' });
      await expect(controller.getSegment('s-1', req)).resolves.toEqual({
        segment: { id: 's-1' },
      });
      await expect(controller.getSegment('s-1', reqAnonyme)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updateSegment met à jour et journalise', async () => {
      contactsService.updateSegment.mockResolvedValue({
        id: 's-1',
        name: 'VIP maj',
      });
      const result = await controller.updateSegment(
        's-1',
        { name: 'VIP maj' },
        req,
      );
      expect(result).toEqual({
        success: true,
        segment: { id: 's-1', name: 'VIP maj' },
      });
      expect(contactsService.createAuditLog).toHaveBeenCalledWith(
        'acc-1',
        'segment_updated',
        { segmentId: 's-1', name: 'VIP maj' },
      );
      await expect(
        controller.updateSegment('s-1', {}, reqAnonyme),
      ).rejects.toThrow(BadRequestException);
    });

    it('deleteSegment lève NotFound si rien n’est supprimé', async () => {
      contactsService.deleteSegment.mockResolvedValue(false);
      await expect(controller.deleteSegment('s-404', req)).rejects.toThrow(
        NotFoundException,
      );
      contactsService.deleteSegment.mockResolvedValue(true);
      await expect(controller.deleteSegment('s-1', req)).resolves.toEqual({
        success: true,
      });
      expect(contactsService.createAuditLog).toHaveBeenCalledWith(
        'acc-1',
        'segment_deleted',
        { segmentId: 's-1' },
      );
      await expect(controller.deleteSegment('s-1', reqAnonyme)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
