import { NotFoundException } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TemplatesService — templates de campagne (EN-1654)', () => {
  const prisma = {
    template: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    account: {
      findFirst: jest.fn(),
    },
  };

  let service: TemplatesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TemplatesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('résout le compte par défaut quand accountId absent', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'acc-default' });
      prisma.template.create.mockResolvedValue({ id: 'tpl-1' });

      await service.create({ key: 'welcome', name: 'Bienvenue' });

      expect(prisma.template.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-default',
          key: 'welcome',
          name: 'Bienvenue',
        }),
      });
    });

    it('accepte les alias channel/contentHtml', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      prisma.template.create.mockResolvedValue({ id: 'tpl-1' });

      await service.create({
        key: 'promo',
        name: 'Promo',
        channel: 'EMAIL',
        contentHtml: '<p>Hello</p>',
      });

      const data = prisma.template.create.mock.calls[0][0].data;
      expect(data.channelType).toBe('EMAIL');
      expect(data.htmlContent).toBe('<p>Hello</p>');
    });
  });

  describe('findOne', () => {
    it('lève NotFound pour un template inconnu', async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      await expect(service.findOne('tpl-x')).rejects.toThrow(NotFoundException);
    });

    it('retourne le template trouvé', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 'tpl-1' });

      const result = await service.findOne('tpl-1');

      expect(result).toEqual({ id: 'tpl-1' });
    });
  });

  describe('update', () => {
    it('vérifie l’existence avant mise à jour', async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      await expect(
        service.update('tpl-x', { name: 'Nouveau' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.template.update).not.toHaveBeenCalled();
    });

    it('met à jour les champs', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 'tpl-1' });
      prisma.template.update.mockResolvedValue({ id: 'tpl-1' });

      await service.update('tpl-1', { name: 'Renommé' });

      expect(prisma.template.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tpl-1' },
          data: expect.objectContaining({ name: 'Renommé' }),
        }),
      );
    });
  });

  describe('findAll / findByKey', () => {
    it('liste les templates triés par date décroissante', async () => {
      prisma.template.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.template.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('recherche par clé unique', async () => {
      prisma.template.findUnique.mockResolvedValue({ key: 'welcome' });

      const result = await service.findByKey('welcome');

      expect(result).toEqual({ key: 'welcome' });
    });
  });
});
