import { Test, TestingModule } from '@nestjs/testing';
import { ContactsService } from './contacts.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SegmentRecalculationService } from '../queues/segment.recalculation.service';

const mockPrisma = {
  contact: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  segment: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

const mockEventEmitter = { emit: jest.fn() };

const mockSegmentRecalculation = {
  addRecalculateAccountSegmentsJob: jest.fn().mockResolvedValue(undefined),
  invalidateContactCountCache: jest.fn().mockResolvedValue(undefined),
};

// Inline cache for invalidateContactCountCache (private method) -- mock via redis stub
jest.mock('../queues/import.queue', () => ({ redisConnection: {} }));

describe('ContactsService -- US-004, US-006', () => {
  let service: ContactsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: SegmentRecalculationService,
          useValue: mockSegmentRecalculation,
        },
      ],
    }).compile();

    service = module.get<ContactsService>(ContactsService);
    jest.clearAllMocks();
    mockPrisma.segment.findMany.mockResolvedValue([]);
    mockSegmentRecalculation.addRecalculateAccountSegmentsJob.mockResolvedValue(
      undefined,
    );
  });

  // =========================================================
  // US-004 -- Liste contacts (findAll)
  // =========================================================
  describe('US-004 - findAll()', () => {
    it('retourne une liste paginee avec total', async () => {
      const mockContacts = [
        {
          id: 'c-1',
          firstName: 'Awa',
          lastName: 'Diallo',
          email: 'awa@test.ci',
          phone: '+22501000001',
          accountId: 'acc-1',
          tags: [],
          optOut: false,
        },
        {
          id: 'c-2',
          firstName: 'Kone',
          lastName: 'Marc',
          email: 'kone@test.ci',
          phone: '+22501000002',
          accountId: 'acc-1',
          tags: [],
          optOut: false,
        },
      ];
      mockPrisma.contact.findMany.mockResolvedValue(mockContacts);
      mockPrisma.contact.count.mockResolvedValue(2);

      const result = await service.findAll('acc-1', { limit: 20 });

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.nextCursor).toBeNull();
    });

    it('filtre par recherche textuelle', async () => {
      const mockContacts = [
        {
          id: 'c-1',
          firstName: 'Awa',
          email: 'awa@test.ci',
          accountId: 'acc-1',
          tags: [],
          optOut: false,
        },
      ];
      mockPrisma.contact.findMany.mockResolvedValue(mockContacts);
      mockPrisma.contact.count.mockResolvedValue(1);

      const result = await service.findAll('acc-1', {
        search: 'Awa',
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
    });

    it('gere la pagination par curseur', async () => {
      const contacts = Array.from({ length: 21 }, (_, i) => ({
        id: `c-${i}`,
        firstName: `Contact${i}`,
        accountId: 'acc-1',
        tags: [],
        optOut: false,
      }));
      mockPrisma.contact.findMany.mockResolvedValue(contacts);
      mockPrisma.contact.count.mockResolvedValue(50);

      const result = await service.findAll('acc-1', { limit: 20 });

      // 21 fetched -> last is nextCursor
      expect(result.nextCursor).toBeDefined();
      expect(result.data).toHaveLength(20);
    });
  });

  // =========================================================
  // US-006 -- Fiche contact (findById)
  // =========================================================
  describe('US-006 - findById()', () => {
    it('retourne un contact par id', async () => {
      const mockContact = { id: 'c-1', firstName: 'Awa', accountId: 'acc-1' };
      mockPrisma.contact.findFirst.mockResolvedValue(mockContact);

      const result = await service.findById('acc-1', 'c-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('c-1');
    });

    it('retourne null si contact inconnu', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      const result = await service.findById('acc-1', 'unknown');

      expect(result).toBeNull();
    });
  });

  // =========================================================
  // US-004 -- Creation de contact
  // =========================================================
  describe('US-004 - create()', () => {
    const contactData = {
      firstName: 'Awa',
      lastName: 'Diallo',
      email: 'awa@test.ci',
      phone: '+22501000001',
    };

    it('cree un contact correctement', async () => {
      const created = {
        id: 'c-1',
        accountId: 'acc-1',
        ...contactData,
        tags: [],
        optOut: false,
      };
      mockPrisma.contact.create.mockResolvedValue(created);

      const result = await service.create('acc-1', contactData);

      expect(result).toBeDefined();
      expect(result.id).toBe('c-1');
      expect(mockPrisma.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountId: 'acc-1' }),
        }),
      );
    });
  });

  // =========================================================
  // US-006 -- Desabonnement (optOut)
  // =========================================================
  describe('US-006 - optOut()', () => {
    it('marque le contact comme desabonne', async () => {
      const contact = { id: 'c-1', accountId: 'acc-1', optOut: false };
      const updated = { ...contact, optOut: true };
      mockPrisma.contact.findFirst.mockResolvedValue(contact);
      mockPrisma.contact.update.mockResolvedValue(updated);

      const result = await service.optOut('acc-1', 'c-1');

      expect(result).toBeDefined();
      expect(result?.optOut).toBe(true);
      expect(mockPrisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { optOut: true } }),
      );
    });

    it('retourne null si contact non trouve', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      const result = await service.optOut('acc-1', 'unknown');

      expect(result).toBeNull();
    });
  });
});
