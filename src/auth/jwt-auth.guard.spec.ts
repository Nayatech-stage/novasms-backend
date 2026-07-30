import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const makeContext = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard — routes publiques vs protégées (SEC-01)', () => {
  const originalEnv = process.env;
  let guard: JwtAuthGuard;
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    guard = new JwtAuthGuard();
    const superProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
    superCanActivate = jest
      .spyOn(superProto, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    superCanActivate.mockRestore();
  });

  it.each([
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/register'],
    ['GET', '/api/auth/verify-email/token-x'],
    ['POST', '/api/auth/refresh'],
  ])('laisse passer la route publique %s %s sans JWT', async (method, path) => {
    const result = await guard.canActivate(
      makeContext({ method, path, headers: {} }),
    );

    expect(result).toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('exige le JWT sur une route protégée', async () => {
    await guard.canActivate(
      makeContext({
        method: 'GET',
        path: '/api/contacts',
        headers: {},
        user: { accountId: 'acc-1' },
      }),
    );

    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('exige le JWT sur POST /api/campaigns en production (pas de backdoor dev)', async () => {
    await guard.canActivate(
      makeContext({
        method: 'POST',
        path: '/api/campaigns',
        headers: {},
        user: { accountId: 'acc-1' },
      }),
    );

    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('laisse passer GET /api/campaigns/images/:file (assets publics emails)', async () => {
    const result = await guard.canActivate(
      makeContext({
        method: 'GET',
        path: '/api/campaigns/images/banner.png',
        headers: {},
      }),
    );

    expect(result).toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();
  });
});
