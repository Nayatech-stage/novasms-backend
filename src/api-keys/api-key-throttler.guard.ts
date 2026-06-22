import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

type ApiRequest = Request & { apiKeyId?: string };

@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected errorMessage =
    'Limite dépassée : 60 requêtes par minute par clé API. Réessayez dans un instant.';

  protected async getTracker(req: ApiRequest): Promise<string> {
    return req.apiKeyId ?? (req.ip as string) ?? 'unknown';
  }
}
