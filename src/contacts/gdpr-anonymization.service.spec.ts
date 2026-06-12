import { GdprAnonymizationService } from './gdpr-anonymization.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GdprAnonymizationService — anonymisation RGPD < 30j', () => {
  const prisma = {
    contact: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  let service: GdprAnonymizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GdprAnonymizationService(prisma as unknown as PrismaService);
  });

  it('ne fait rien quand aucun contact expiré', async () => {
    prisma.contact.findMany.mockResolvedValue([]);

    const result = await service.anonymizeExpiredOptOuts();

    expect(result).toEqual({ anonymized: 0 });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('cible uniquement les optOut > 30 jours non encore anonymisés', async () => {
    prisma.contact.findMany.mockResolvedValue([]);

    await service.anonymizeExpiredOptOuts();

    const where = prisma.contact.findMany.mock.calls[0][0].where;
    expect(where.optOut).toBe(true);
    expect(where.anonymizedAt).toBeNull();
    expect(where.optOutAt.lt).toBeInstanceOf(Date);
    const expectedCutoff =
      Date.now() -
      GdprAnonymizationService.RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(where.optOutAt.lt.getTime() - expectedCutoff)).toBeLessThan(
      5000,
    );
  });

  it('efface toutes les données identifiantes et trace un audit log', async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c-1', accountId: 'acc-1' },
      { id: 'c-2', accountId: 'acc-1' },
    ]);

    const result = await service.anonymizeExpiredOptOuts();

    expect(result).toEqual({ anonymized: 2 });
    expect(prisma.contact.update).toHaveBeenCalledTimes(2);

    const updateData = prisma.contact.update.mock.calls[0][0].data;
    expect(updateData).toMatchObject({
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      location: null,
      tags: [],
      notes: [],
    });
    expect(updateData.anonymizedAt).toBeInstanceOf(Date);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'acc-1',
        action: 'contact.gdpr_anonymized',
        details: expect.objectContaining({ contactId: 'c-1' }),
      }),
    });
  });
});
