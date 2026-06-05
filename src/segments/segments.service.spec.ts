import { Test, TestingModule } from '@nestjs/testing';
import { SegmentsService, type SegmentCriteria } from './segments.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  contact: {
    count: jest.fn(),
  },
  segment: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('SegmentsService -- US-005', () => {
  let service: SegmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SegmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SegmentsService>(SegmentsService);
    jest.clearAllMocks();
  });

  const andCriteria: SegmentCriteria = {
    operator: 'AND',
    filters: [{ field: 'country', op: 'eq', value: 'CI' }],
  };

  // =========================================================
  // US-005 -- Creer un segment
  // =========================================================
  describe('US-005 - create()', () => {
    it('cree un segment avec criteres AND', async () => {
      mockPrisma.contact.count.mockResolvedValue(42);
      mockPrisma.segment.create.mockResolvedValue({
        id: 'seg-1',
        name: 'Clients CI',
        criteria: andCriteria,
        contactCount: 42,
        accountId: 'acc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create('acc-1', {
        name: 'Clients CI',
        criteria: andCriteria,
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Clients CI');
      expect(result.contactCount).toBe(42);
    });

    it('cree un segment avec criteres OR', async () => {
      const orCriteria: SegmentCriteria = {
        operator: 'OR',
        filters: [
          { field: 'tags', op: 'contains', value: 'vip' },
          { field: 'country', op: 'eq', value: 'SN' },
        ],
      };
      mockPrisma.contact.count.mockResolvedValue(100);
      mockPrisma.segment.create.mockResolvedValue({
        id: 'seg-2',
        name: 'VIP ou Senegal',
        criteria: orCriteria,
        contactCount: 100,
        accountId: 'acc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create('acc-1', {
        name: 'VIP ou Senegal',
        criteria: orCriteria,
      });
      expect(result.contactCount).toBe(100);
    });

    it('rejette si le nom est vide', async () => {
      await expect(
        service.create('acc-1', { name: '', criteria: andCriteria }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================
  // US-005 -- Apercu du nombre de contacts (previewCount)
  // =========================================================
  describe('US-005 - previewCount()', () => {
    it('retourne le nombre de contacts correspondants', async () => {
      mockPrisma.contact.count.mockResolvedValue(37);

      const count = await service.previewCount('acc-1', andCriteria);

      expect(count).toBe(37);
      expect(mockPrisma.contact.count).toHaveBeenCalled();
    });

    it('filtre par date createdAt (gte)', async () => {
      const dateCriteria: SegmentCriteria = {
        operator: 'AND',
        filters: [{ field: 'createdAt', op: 'gte', value: '2024-01-01' }],
      };
      mockPrisma.contact.count.mockResolvedValue(5);

      const count = await service.previewCount('acc-1', dateCriteria);

      expect(count).toBe(5);
    });
  });

  // =========================================================
  // US-005 -- Lister les segments
  // =========================================================
  describe('US-005 - findAll()', () => {
    it('retourne la liste des segments du compte', async () => {
      const segs = [
        {
          id: 'seg-1',
          name: 'Abidjan',
          accountId: 'acc-1',
          criteria: andCriteria,
          contactCount: 10,
        },
        {
          id: 'seg-2',
          name: 'VIP',
          accountId: 'acc-1',
          criteria: andCriteria,
          contactCount: 5,
        },
      ];
      mockPrisma.segment.findMany.mockResolvedValue(segs);

      const result = await service.findAll('acc-1');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Abidjan');
    });
  });

  // =========================================================
  // US-005 -- Mettre a jour un segment
  // =========================================================
  describe('US-005 - update()', () => {
    it('met a jour le nom du segment', async () => {
      mockPrisma.segment.findUnique.mockResolvedValue({
        id: 'seg-1',
        name: 'Ancien nom',
        accountId: 'acc-1',
        criteria: andCriteria,
        contactCount: 10,
      });
      mockPrisma.contact.count.mockResolvedValue(12);
      mockPrisma.segment.update.mockResolvedValue({
        id: 'seg-1',
        name: 'Nouveau nom',
        accountId: 'acc-1',
        criteria: andCriteria,
        contactCount: 12,
      });

      const result = await service.update('acc-1', 'seg-1', {
        name: 'Nouveau nom',
      });

      expect(result.name).toBe('Nouveau nom');
    });

    it('leve NotFoundException si segment inconnu', async () => {
      mockPrisma.segment.findUnique.mockResolvedValue(null);

      await expect(
        service.update('acc-1', 'unknown', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================
  // US-005 -- Supprimer un segment
  // =========================================================
  describe('US-005 - remove()', () => {
    it('supprime le segment', async () => {
      mockPrisma.segment.findUnique.mockResolvedValue({
        id: 'seg-1',
        accountId: 'acc-1',
        criteria: andCriteria,
      });
      mockPrisma.segment.delete.mockResolvedValue({ id: 'seg-1' });

      await service.remove('acc-1', 'seg-1');

      expect(mockPrisma.segment.delete).toHaveBeenCalled();
    });

    it('leve NotFoundException si segment inexistant', async () => {
      mockPrisma.segment.findUnique.mockResolvedValue(null);

      await expect(service.remove('acc-1', 'unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
