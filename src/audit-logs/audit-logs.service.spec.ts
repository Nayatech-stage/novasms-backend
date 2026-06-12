import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditLogsService — consultation des logs d’activité', () => {
  const prisma = {
    auditLog: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let service: AuditLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogsService(prisma as unknown as PrismaService);
  });

  it('pagine les résultats et calcule totalPages', async () => {
    prisma.auditLog.count.mockResolvedValue(45);
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);

    const result = await service.findAll('acc-1', 2, 20);

    expect(result).toMatchObject({
      total: 45,
      page: 2,
      limit: 20,
      totalPages: 3,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });

  it('filtre par action (insensible à la casse) et isole par compte', async () => {
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.findAll('acc-1', 1, 20, 'login');

    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      accountId: 'acc-1',
      action: { contains: 'login', mode: 'insensitive' },
    });
  });

  it('ne filtre pas par action quand non fournie', async () => {
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.findAll('acc-1');

    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ accountId: 'acc-1' });
  });
});
