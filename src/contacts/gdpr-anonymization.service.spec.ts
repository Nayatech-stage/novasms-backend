import { GdprAnonymizationService } from './gdpr-anonymization.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GdprAnonymizationService — anonymisation RGPD < 30j', () => {
  const prisma = {
    contact: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    expect(prisma.contact.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.createMany).not.toHaveBeenCalled();
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
    expect(prisma.contact.updateMany).toHaveBeenCalledTimes(1);

    const updateCall = prisma.contact.updateMany.mock.calls[0][0];
    expect(updateCall.where.id.in).toEqual(['c-1', 'c-2']);
    expect(updateCall.data).toMatchObject({
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      location: null,
      tags: [],
      notes: [],
    });
    expect(updateCall.data.anonymizedAt).toBeInstanceOf(Date);

    expect(prisma.auditLog.createMany).toHaveBeenCalledTimes(1);
    const auditRows = prisma.auditLog.createMany.mock.calls[0][0].data;
    expect(auditRows).toHaveLength(2);
    expect(auditRows[0]).toMatchObject({
      accountId: 'acc-1',
      action: 'contact.gdpr_anonymized',
      details: expect.objectContaining({ contactId: 'c-1' }),
    });
  });
});
