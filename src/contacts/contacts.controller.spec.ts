import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ImportService } from './import.service';

describe('ContactsController — endpoints contacts (US-004/US-006)', () => {
  const contactsService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    optOut: jest.fn(),
    addNote: jest.fn(),
    exportContact: jest.fn(),
    previewSegment: jest.fn(),
    listSegments: jest.fn(),
    createSegment: jest.fn(),
  };

  const importService = {
    startImport: jest.fn(),
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

  describe('list', () => {
    it('rejette sans accountId (isolation RG-13)', async () => {
      await expect(controller.list({}, reqAnonyme)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('transmet filtres et pagination au service', async () => {
      contactsService.findAll.mockResolvedValue({
        data: [],
        nextCursor: null,
        total: 0,
      });

      await controller.list(
        { limit: '50', search: 'awa', location: 'Abidjan' },
        req,
      );

      expect(contactsService.findAll).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({
          limit: 50,
          search: 'awa',
          location: 'Abidjan',
        }),
      );
    });
  });

  describe('import — mapping et filtrage des lignes (US-004)', () => {
    it('rejette un payload sans fichier ni lignes', async () => {
      await expect(
        controller.import({ fileName: '' } as never, req),
      ).rejects.toThrow('Fichier ou lignes invalides');
    });

    it('mappe les colonnes, découpe les tags et filtre les lignes sans email/téléphone', async () => {
      importService.startImport.mockResolvedValue({
        success: true,
        jobId: 'job-1',
      });

      await controller.import(
        {
          fileName: 'contacts.csv',
          mapping: { email: 'E-mail', firstName: 'Prénom', tags: 'Étiquettes' },
          rows: [
            {
              'E-mail': ' awa@x.ci ',
              Prénom: 'Awa',
              Étiquettes: 'vip, fidele; nouveau',
            },
            { Prénom: 'SansContact' },
          ],
        },
        req,
      );

      const [accountId, fileName, mappedRows] =
        importService.startImport.mock.calls[0];
      expect(accountId).toBe('acc-1');
      expect(fileName).toBe('contacts.csv');
      // la ligne sans email/téléphone est exclue
      expect(mappedRows).toHaveLength(1);
      expect(mappedRows[0]).toMatchObject({
        email: 'awa@x.ci',
        firstName: 'Awa',
        tags: ['vip', 'fidele', 'nouveau'],
      });
    });
  });

  describe('export / getOne', () => {
    it('exportContact retourne données + nom de fichier', async () => {
      contactsService.exportContact.mockResolvedValue('ID,Email\nct-1,a@x.ci');

      const result = await controller.exportContact('ct-1', 'csv', req);

      expect(result).toMatchObject({
        success: true,
        format: 'csv',
        fileName: 'contact-ct-1.csv',
      });
    });

    it('exportContact lève NotFound pour un contact inconnu', async () => {
      contactsService.exportContact.mockResolvedValue(null);

      await expect(
        controller.exportContact('ct-x', 'json', req),
      ).rejects.toThrow(NotFoundException);
    });

    it('getOne lève NotFound pour un contact d’un autre compte', async () => {
      contactsService.findById.mockResolvedValue(null);

      await expect(controller.getOne('ct-x', req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create / update / remove / opt-out / notes', () => {
    it('create délègue avec le compte du token', async () => {
      contactsService.create.mockResolvedValue({ id: 'ct-1' });

      const result = await controller.create({ email: 'a@x.ci' }, req);

      expect(result).toEqual({ id: 'ct-1' });
      expect(contactsService.create).toHaveBeenCalledWith('acc-1', {
        email: 'a@x.ci',
      });
    });

    it('update lève NotFound quand le service retourne null', async () => {
      contactsService.update.mockResolvedValue(null);

      await expect(
        controller.update('ct-x', { firstName: 'X' }, req),
      ).rejects.toThrow(NotFoundException);
    });

    it('optOut retourne success', async () => {
      contactsService.optOut.mockResolvedValue({ id: 'ct-1' });

      const result = await controller.optOut('ct-1', req);

      expect(result).toEqual({ success: true });
    });

    it('addNote refuse un contenu vide', async () => {
      await expect(
        controller.addNote('ct-1', { content: '   ' }, req),
      ).rejects.toThrow('Note content is required');
    });

    it('addNote enregistre la note nettoyée', async () => {
      contactsService.addNote.mockResolvedValue([
        { id: 'n-1', content: 'Client fidèle' },
      ]);

      const result = await controller.addNote(
        'ct-1',
        { content: '  Client fidèle  ' },
        req,
      );

      expect(result.success).toBe(true);
      expect(contactsService.addNote).toHaveBeenCalledWith(
        'acc-1',
        'ct-1',
        'Client fidèle',
      );
    });

    it('remove délègue la suppression', async () => {
      contactsService.remove.mockResolvedValue({ success: true });

      const result = await controller.remove('ct-1', req);

      expect(result).toEqual({ success: true });
    });
  });
});
