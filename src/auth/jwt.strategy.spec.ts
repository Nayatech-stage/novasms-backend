import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { JwtBlacklistService } from './jwt-blacklist.service';

describe('JwtStrategy — validation du payload JWT (US-002/US-015)', () => {
  const originalEnv = process.env;

  const blacklist = {
    isRevoked: jest.fn().mockResolvedValue(false),
  };

  const makeStrategy = () =>
    new JwtStrategy(blacklist as unknown as JwtBlacklistService);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, JWT_ACCESS_SECRET: 'secret-test' };
    blacklist.isRevoked.mockResolvedValue(false);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('exige JWT_ACCESS_SECRET au démarrage', () => {
    delete process.env.JWT_ACCESS_SECRET;

    expect(() => makeStrategy()).toThrow('JWT_ACCESS_SECRET is not defined');
  });

  it('rejette un payload sans sub ou sans email', async () => {
    const strategy = makeStrategy();

    await expect(strategy.validate({ email: 'a@x.ci' })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate({ sub: 'acc-1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejette un token révoqué (blacklist Redis, US-015)', async () => {
    blacklist.isRevoked.mockResolvedValue(true);
    const strategy = makeStrategy();

    await expect(
      strategy.validate({ sub: 'acc-1', email: 'a@x.ci', iat: 123 }),
    ).rejects.toThrow('Token révoqué');
    expect(blacklist.isRevoked).toHaveBeenCalledWith('acc-1', 123);
  });

  it('mappe le payload vers le user de la requête', async () => {
    const strategy = makeStrategy();

    const user = await strategy.validate({
      sub: 'acc-1',
      email: 'a@x.ci',
      role: 'Admin',
      iat: 123,
      exp: 456,
    });

    expect(user).toEqual({
      accountId: 'acc-1',
      email: 'a@x.ci',
      role: 'Admin',
      iat: 123,
      exp: 456,
    });
  });

  it('applique le rôle merchant par défaut', async () => {
    const strategy = makeStrategy();

    const user = await strategy.validate({ sub: 'acc-1', email: 'a@x.ci' });

    expect(user.role).toBe('merchant');
    // sans iat, pas de consultation blacklist
    expect(blacklist.isRevoked).not.toHaveBeenCalled();
  });
});
