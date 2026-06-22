import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from './api-keys.service';
import type { Request } from 'express';

export const REQUIRE_API_PERMISSION = 'requireApiPermission';

export const RequireApiPermission = (permission: string) =>
  SetMetadata(REQUIRE_API_PERMISSION, permission);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private apiKeysService: ApiKeysService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { accountId?: string; apiKeyId?: string }>();

    const authHeader = req.headers['authorization'];
    const xApiKey = req.headers['x-api-key'] as string | undefined;

    let rawKey: string | undefined;

    if (authHeader?.startsWith('Bearer nvsms_')) {
      rawKey = authHeader.slice(7);
    } else if (xApiKey?.startsWith('nvsms_')) {
      rawKey = xApiKey;
    }

    if (!rawKey) {
      throw new UnauthorizedException(
        'Clé API manquante. Fournissez Authorization: Bearer <nvsms_...> ou X-Api-Key: <nvsms_...>',
      );
    }

    const apiKey = await this.apiKeysService.validateKey(rawKey);
    if (!apiKey) {
      throw new UnauthorizedException('Clé API invalide ou révoquée');
    }

    const requiredPermission = this.reflector.get<string>(
      REQUIRE_API_PERMISSION,
      context.getHandler(),
    );

    if (
      requiredPermission &&
      !apiKey.permissions.includes(requiredPermission)
    ) {
      throw new ForbiddenException(
        `Permission insuffisante. Requis: "${requiredPermission}"`,
      );
    }

    req.accountId = apiKey.accountId;
    req.apiKeyId = apiKey.id;

    return true;
  }
}
