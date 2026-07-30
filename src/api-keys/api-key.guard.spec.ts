import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard, REQUIRE_API_PERMISSION } from './api-key.guard';
import { ApiKeysService } from './api-keys.service';

const makeContext = (
  headers: Record<string, string> = {},
  handlerMeta?: string,
): ExecutionContext => {
  const req = {
    headers,
    accountId: undefined as string | undefined,
    apiKeyId: undefined as string | undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
};

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let service: jest.Mocked<Pick<ApiKeysService, 'validateKey'>>;
  let reflector: jest.Mocked<Reflector>;

  const validKey = {
    id: 'key-1',
    accountId: 'acc-1',
    permissions: ['contacts:read', 'sms:send'],
  };

  beforeEach(() => {
    service = { validateKey: jest.fn() } as any;
    reflector = { get: jest.fn().mockReturnValue(undefined) } as any;
    guard = new ApiKeyGuard(service as any, reflector as any);
  });

  it('rejette si aucun header fourni', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un Bearer non préfixé nvsms_', async () => {
    const ctx = makeContext({ authorization: 'Bearer some_other_token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('valide via Authorization: Bearer nvsms_...', async () => {
    service.validateKey.mockResolvedValue(validKey as any);
    const req: any = {
      headers: { authorization: 'Bearer nvsms_abc123' },
      accountId: undefined,
      apiKeyId: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(service.validateKey).toHaveBeenCalledWith('nvsms_abc123');
    expect(req.accountId).toBe('acc-1');
    expect(req.apiKeyId).toBe('key-1');
  });

  it('valide via X-Api-Key header', async () => {
    service.validateKey.mockResolvedValue(validKey as any);
    const req: any = {
      headers: { 'x-api-key': 'nvsms_xyz' },
      accountId: undefined,
      apiKeyId: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.validateKey).toHaveBeenCalledWith('nvsms_xyz');
  });

  it('rejette une clé invalide ou révoquée', async () => {
    service.validateKey.mockResolvedValue(null as any);
    const req: any = {
      headers: { authorization: 'Bearer nvsms_bad' },
      accountId: undefined,
      apiKeyId: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejette si permission requise absente de la clé', async () => {
    service.validateKey.mockResolvedValue(validKey as any);
    reflector.get.mockReturnValue('email:send');
    const req: any = {
      headers: { authorization: 'Bearer nvsms_ok' },
      accountId: undefined,
      apiKeyId: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('accepte si permission requise présente dans la clé', async () => {
    service.validateKey.mockResolvedValue(validKey as any);
    reflector.get.mockReturnValue('contacts:read');
    const req: any = {
      headers: { authorization: 'Bearer nvsms_ok' },
      accountId: undefined,
      apiKeyId: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("accepte sans vérifier permission si aucune n'est requise sur le handler", async () => {
    service.validateKey.mockResolvedValue(validKey as any);
    reflector.get.mockReturnValue(undefined);
    const req: any = {
      headers: { authorization: 'Bearer nvsms_ok' },
      accountId: undefined,
      apiKeyId: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('expose REQUIRE_API_PERMISSION comme constante de metadata', () => {
    expect(REQUIRE_API_PERMISSION).toBe('requireApiPermission');
  });
});
