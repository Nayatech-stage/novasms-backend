import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './guards/roles.guard';
import {
  TenantInterceptor,
  TenantRequest,
} from './interceptors/tenant.interceptor';

const makeContext = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
  }) as unknown as ExecutionContext;

describe('RolesGuard — contrôle d’accès par rôle (RG-40 / US-015)', () => {
  const makeGuard = (requiredRoles: UserRole[] | undefined) => {
    const reflector = {
      get: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('laisse passer quand aucun rôle n’est requis', () => {
    const guard = makeGuard(undefined);

    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('rejette une requête sans utilisateur authentifié', () => {
    const guard = makeGuard([UserRole.Admin]);

    expect(() => guard.canActivate(makeContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('rejette un rôle insuffisant (Analyst sur route Admin)', () => {
    const guard = makeGuard([UserRole.Admin]);

    expect(() =>
      guard.canActivate(makeContext({ user: { role: UserRole.Analyst } })),
    ).toThrow('Insufficient permissions');
  });

  it('autorise un rôle dans la liste requise', () => {
    const guard = makeGuard([UserRole.Admin, UserRole.Editor]);

    expect(
      guard.canActivate(makeContext({ user: { role: UserRole.Editor } })),
    ).toBe(true);
  });
});

describe('TenantInterceptor — isolation multi-tenant (RG-13)', () => {
  const interceptor = new TenantInterceptor();
  const next = { handle: jest.fn(() => of('ok')) };

  beforeEach(() => jest.clearAllMocks());

  it('injecte accountId depuis le JWT dans la requête', () => {
    const request: TenantRequest = { user: { accountId: 'acc-1' } };

    interceptor.intercept(makeContext(request as never), next);

    expect(request.accountId).toBe('acc-1');
    expect(request.tenantAccountId).toBe('acc-1');
    expect(next.handle).toHaveBeenCalled();
  });

  it('retombe sur user.sub quand accountId absent du token', () => {
    const request: TenantRequest = { user: { sub: 'acc-sub' } };

    interceptor.intercept(makeContext(request as never), next);

    expect(request.accountId).toBe('acc-sub');
  });

  it('laisse passer sans accountId (routes publiques)', () => {
    const request: TenantRequest = {};

    interceptor.intercept(makeContext(request as never), next);

    expect(request.accountId).toBeUndefined();
    expect(next.handle).toHaveBeenCalled();
  });
});
