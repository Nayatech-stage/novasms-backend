import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsController — GET /audit-logs (US-017)', () => {
  const service = {
    findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  };

  let controller: AuditLogsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuditLogsController(
      service as unknown as AuditLogsService,
    );
  });

  it('rejette sans accountId', async () => {
    await expect(controller.findAll({} as never)).rejects.toThrow(
      'accountId manquant',
    );
  });

  it('parse pagination et filtre action depuis la query', async () => {
    await controller.findAll(
      { accountId: 'acc-1' } as never,
      '2',
      '50',
      'login',
    );

    expect(service.findAll).toHaveBeenCalledWith('acc-1', 2, 50, 'login');
  });

  it('applique les valeurs par défaut', async () => {
    await controller.findAll({ accountId: 'acc-1' } as never);

    expect(service.findAll).toHaveBeenCalledWith('acc-1', 1, 20, undefined);
  });
});
