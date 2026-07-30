import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

export type TenantRequest = {
  user?: {
    accountId?: string;
    sub?: string;
    email?: string;
    role?: string;
  };
  accountId?: string;
  tenantAccountId?: string;
};

/**
 * Interceptor global pour l'isolation multi-tenant (RG-13)
 * Extrait accountId du JWT et l'injecte dans req.accountId pour tous les services
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<TenantRequest>();

    // Si accountId déjà posé (ex: par ApiKeyGuard), ne pas l'écraser
    if (request.accountId) {
      return next.handle();
    }

    // Extraire accountId depuis le JWT (injecté par JwtStrategy)
    const accountId = request?.user?.accountId || request?.user?.sub;

    if (!accountId) {
      return next.handle();
    }

    // Injecter accountId standardisé pour tous les services
    request.accountId = accountId;
    request.tenantAccountId = accountId;

    return next.handle();
  }
}
