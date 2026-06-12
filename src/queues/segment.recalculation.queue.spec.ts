import { SegmentRecalculationProcessor } from './segment.recalculation.queue';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';

describe('SegmentRecalculationProcessor — recalcul auto des segments (EN-1652)', () => {
  const prisma = {
    segment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    contact: {
      count: jest.fn(),
    },
  };

  const contactsService = {
    normalizeSegmentCriteria: jest.fn().mockReturnValue({
      logic: 'AND',
      rules: [{ field: 'location', operator: 'equals', value: 'Abidjan' }],
    }),
    buildWhereForSegment: jest
      .fn()
      .mockReturnValue({ accountId: 'acc-1', location: 'Abidjan' }),
  };

  const makeJob = (data: Record<string, unknown>) => ({ data }) as never;

  let processor: SegmentRecalculationProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.segment.update.mockResolvedValue({});
    processor = new SegmentRecalculationProcessor(
      prisma as unknown as PrismaService,
      contactsService as unknown as ContactsService,
    );
  });

  describe('recalcul ciblé (segmentId fourni)', () => {
    it('lève une erreur pour un segment introuvable (retry BullMQ)', async () => {
      prisma.segment.findUnique.mockResolvedValue(null);

      await expect(
        processor.process(makeJob({ segmentId: 'seg-x', accountId: 'acc-1' })),
      ).rejects.toThrow('not found');
    });

    it('ignore les segments statiques', async () => {
      prisma.segment.findUnique.mockResolvedValue({
        id: 'seg-1',
        type: 'static',
      });

      const result = await processor.process(
        makeJob({ segmentId: 'seg-1', accountId: 'acc-1' }),
      );

      expect(result).toMatchObject({ success: true, skipped: true });
      expect(prisma.segment.update).not.toHaveBeenCalled();
    });

    it('recalcule le compteur avec isolation par compte', async () => {
      prisma.segment.findUnique.mockResolvedValue({
        id: 'seg-1',
        type: 'dynamic',
        criteria: { logic: 'AND', rules: [] },
      });
      prisma.contact.count.mockResolvedValue(42);

      const result = await processor.process(
        makeJob({ segmentId: 'seg-1', accountId: 'acc-1' }),
      );

      expect(result).toEqual({ success: true, count: 42, segmentId: 'seg-1' });
      expect(contactsService.buildWhereForSegment).toHaveBeenCalledWith(
        'acc-1',
        'AND',
        expect.any(Array),
      );
      const update = prisma.segment.update.mock.calls[0][0];
      expect(update.data.contactCount).toBe(42);
      expect(update.data.lastCalculated).toBeInstanceOf(Date);
    });
  });

  describe('recalcul global du compte (sans segmentId)', () => {
    it('recalcule tous les segments dynamiques du compte', async () => {
      prisma.segment.findMany.mockResolvedValue([
        { id: 'seg-1', criteria: {} },
        { id: 'seg-2', criteria: {} },
      ]);
      prisma.contact.count.mockResolvedValueOnce(10).mockResolvedValueOnce(20);

      const result = (await processor.process(
        makeJob({ accountId: 'acc-1' }),
      )) as { success: boolean; results: Array<{ count?: number }> };

      expect(result.success).toBe(true);
      expect(result.results).toEqual([
        { segmentId: 'seg-1', count: 10 },
        { segmentId: 'seg-2', count: 20 },
      ]);
      expect(prisma.segment.findMany).toHaveBeenCalledWith({
        where: { accountId: 'acc-1', type: 'dynamic' },
      });
    });

    it('continue le lot même si un segment échoue', async () => {
      prisma.segment.findMany.mockResolvedValue([
        { id: 'seg-ko', criteria: {} },
        { id: 'seg-ok', criteria: {} },
      ]);
      prisma.contact.count
        .mockRejectedValueOnce(new Error('criteria corrompus'))
        .mockResolvedValueOnce(7);

      const result = (await processor.process(
        makeJob({ accountId: 'acc-1' }),
      )) as {
        results: Array<{ segmentId: string; error?: string; count?: number }>;
      };

      expect(result.results[0]).toEqual({
        segmentId: 'seg-ko',
        error: 'criteria corrompus',
      });
      expect(result.results[1]).toEqual({ segmentId: 'seg-ok', count: 7 });
    });
  });
});
