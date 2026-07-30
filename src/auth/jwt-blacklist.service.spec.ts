const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  on: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));

import { JwtBlacklistService } from './jwt-blacklist.service';

describe('JwtBlacklistService — révocation JWT via Redis (US-015/EN-1664)', () => {
  let service: JwtBlacklistService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JwtBlacklistService();
  });

  describe('revoke', () => {
    it('stocke le token avec un TTL égal à sa validité restante', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockRedis.set.mockResolvedValue('OK');

      await service.revoke('acc-1', now - 100, now + 500);

      const [key, value, mode, ttl] = mockRedis.set.mock.calls[0];
      expect(key).toBe(`jwt:bl:acc-1:${now - 100}`);
      expect(value).toBe('1');
      expect(mode).toBe('EX');
      expect(ttl).toBeGreaterThan(490);
      expect(ttl).toBeLessThanOrEqual(500);
    });

    it('ignore un token déjà expiré (rien à stocker)', async () => {
      const now = Math.floor(Date.now() / 1000);

      await service.revoke('acc-1', now - 1000, now - 10);

      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('ne lève pas si Redis est indisponible (fail-safe)', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.revoke('acc-1', now, now + 100),
      ).resolves.toBeUndefined();
    });
  });

  describe('isRevoked', () => {
    it('retourne true pour un token blacklisté', async () => {
      mockRedis.get.mockResolvedValue('1');

      expect(await service.isRevoked('acc-1', 123)).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith('jwt:bl:acc-1:123');
    });

    it('retourne false pour un token absent', async () => {
      mockRedis.get.mockResolvedValue(null);

      expect(await service.isRevoked('acc-1', 123)).toBe(false);
    });

    it('fail-open sur panne Redis (pas de lock-out global)', async () => {
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

      expect(await service.isRevoked('acc-1', 123)).toBe(false);
    });
  });

  it('ferme la connexion Redis à la destruction du module', async () => {
    await service.onModuleDestroy();

    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
