import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

const makeService = (): jest.Mocked<
  Pick<
    ApiKeysService,
    | 'listKeys'
    | 'createKey'
    | 'revokeKey'
    | 'getKeyStats'
    | 'sendKeyToDeveloper'
  >
> => ({
  listKeys: jest.fn(),
  createKey: jest.fn(),
  revokeKey: jest.fn(),
  getKeyStats: jest.fn(),
  sendKeyToDeveloper: jest.fn(),
});

const adminReq = (overrides?: object) => ({
  accountId: 'acc-1',
  user: {
    sub: 'u-1',
    email: 'admin@test.com',
    accountId: 'acc-1',
    role: 'Admin',
  },
  ...overrides,
});

const memberReq = () => ({
  accountId: 'acc-1',
  user: {
    sub: 'u-2',
    email: 'member@test.com',
    accountId: 'acc-1',
    role: 'Member',
  },
});

describe('ApiKeysController', () => {
  let controller: ApiKeysController;
  let service: ReturnType<typeof makeService>;

  beforeEach(() => {
    service = makeService();
    controller = new ApiKeysController(service as any);
  });

  // ───────────────────────── GET / (list) ─────────────────────────

  describe('list()', () => {
    it('retourne les clés via le service', async () => {
      const keys = [{ id: 'k1', name: 'prod' }];
      service.listKeys.mockResolvedValue(keys as any);

      const result = await controller.list(adminReq() as any);

      expect(service.listKeys).toHaveBeenCalledWith('acc-1');
      expect(result).toBe(keys);
    });

    it('lève ForbiddenException si rôle non-Admin', async () => {
      await expect(controller.list(memberReq() as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lève BadRequestException si accountId absent', async () => {
      await expect(
        controller.list(adminReq({ accountId: undefined }) as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ───────────────────────── GET /permissions ─────────────────────────

  describe('listPermissions()', () => {
    it('retourne la liste des permissions disponibles', () => {
      const result = controller.listPermissions();
      expect(result.permissions).toBeInstanceOf(Array);
      expect(result.permissions.length).toBeGreaterThan(0);
      expect(result.permissions[0]).toHaveProperty('value');
      expect(result.permissions[0]).toHaveProperty('label');
    });
  });

  // ───────────────────────── POST / (create) ─────────────────────────

  describe('create()', () => {
    it('crée une clé et retourne le résultat du service', async () => {
      const created = { key: 'nvsms_abc', permissions: ['sms:send'] };
      service.createKey.mockResolvedValue(created as any);

      const result = await controller.create(
        { name: 'Prod key', permissions: ['sms:send'] as any },
        adminReq() as any,
      );

      expect(service.createKey).toHaveBeenCalledWith(
        'acc-1',
        'Prod key',
        ['sms:send'],
        undefined,
      );
      expect(result).toBe(created);
    });

    it('lève ForbiddenException si rôle non-Admin', async () => {
      await expect(
        controller.create(
          { name: 'x', permissions: ['sms:send'] as any },
          memberReq() as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lève BadRequestException si le nom est vide', async () => {
      await expect(
        controller.create(
          { name: '  ', permissions: ['sms:send'] as any },
          adminReq() as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si permissions vides', async () => {
      await expect(
        controller.create(
          { name: 'Key', permissions: [] as any },
          adminReq() as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si toutes les permissions sont invalides', async () => {
      await expect(
        controller.create(
          { name: 'Key', permissions: ['invalid:perm'] as any },
          adminReq() as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('transmet expiresAt converti en Date', async () => {
      service.createKey.mockResolvedValue({ key: 'nvsms_x' } as any);
      const expiresAt = '2030-01-01T00:00:00.000Z';

      await controller.create(
        { name: 'Timed key', permissions: ['sms:send'] as any, expiresAt },
        adminReq() as any,
      );

      const callArgs = service.createKey.mock.calls[0];
      expect(callArgs[3]).toBeInstanceOf(Date);
      expect(callArgs[3]!.getFullYear()).toBe(2030);
    });
  });

  // ───────────────────────── GET /:id/stats ─────────────────────────

  describe('stats()', () => {
    it('retourne les stats via le service', async () => {
      const stats = {
        totalCalls: 42,
        callsToday: 5,
        callsThisMonth: 20,
        creditsThisMonth: 10,
        recentLogs: [],
      };
      service.getKeyStats.mockResolvedValue(stats as any);

      const result = await controller.stats('key-1', adminReq() as any);

      expect(service.getKeyStats).toHaveBeenCalledWith('acc-1', 'key-1');
      expect(result).toBe(stats);
    });

    it('lève NotFoundException si le service retourne null', async () => {
      service.getKeyStats.mockResolvedValue(null);

      await expect(
        controller.stats('unknown', adminReq() as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('lève ForbiddenException si rôle non-Admin', async () => {
      await expect(controller.stats('k1', memberReq() as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ───────────────────────── DELETE /:id ─────────────────────────

  describe('revoke()', () => {
    it('révoque une clé via le service', async () => {
      service.revokeKey.mockResolvedValue({ success: true } as any);

      const result = await controller.revoke('key-1', adminReq() as any);

      expect(service.revokeKey).toHaveBeenCalledWith('acc-1', 'key-1');
      expect(result).toEqual({ success: true });
    });

    it('lève ForbiddenException si rôle non-Admin', async () => {
      await expect(controller.revoke('k1', memberReq() as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lève BadRequestException si accountId absent', async () => {
      await expect(
        controller.revoke('k1', adminReq({ accountId: undefined }) as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ───────────────────────── POST /send ─────────────────────────

  describe('sendToDeveloper()', () => {
    it('envoie la clé à un développeur via le service', async () => {
      service.sendKeyToDeveloper.mockResolvedValue({
        sent: true,
        to: 'dev@test.com',
      } as any);

      const result = await controller.sendToDeveloper(
        {
          developerEmail: 'dev@test.com',
          fullKey: 'nvsms_abc',
          keyName: 'Ma clé',
        },
        adminReq() as any,
      );

      expect(service.sendKeyToDeveloper).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({ developerEmail: 'dev@test.com' }),
      );
      expect(result).toEqual({ sent: true, to: 'dev@test.com' });
    });

    it("lève BadRequestException si l'email est invalide", async () => {
      await expect(
        controller.sendToDeveloper(
          { developerEmail: 'notanemail', fullKey: 'nvsms_abc', keyName: 'k' },
          adminReq() as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si la clé ne commence pas par nvsms_', async () => {
      await expect(
        controller.sendToDeveloper(
          {
            developerEmail: 'dev@test.com',
            fullKey: 'other_key',
            keyName: 'k',
          },
          adminReq() as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève ForbiddenException si rôle non-Admin', async () => {
      await expect(
        controller.sendToDeveloper(
          {
            developerEmail: 'dev@test.com',
            fullKey: 'nvsms_abc',
            keyName: 'k',
          },
          memberReq() as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
