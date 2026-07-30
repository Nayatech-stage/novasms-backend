import { Injectable, type ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      method?: string;
    }>();
    const publicRoutes = [
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/register'],
      ['GET', '/api/auth/verify-email'],
      ['POST', '/api/auth/resend-confirmation'],
      ['POST', '/api/auth/verify-2fa'],
      ['POST', '/api/auth/refresh'],
      ['GET', '/api/auth/invitation'],
      ['POST', '/api/auth/invitation/accept'],
    ] as const;

    const requestPath = request.path ?? request.url ?? '';
    const isPublicRoute = publicRoutes.some(
      ([method, route]) =>
        request.method === method && requestPath.startsWith(route),
    );

    const isDevImageUploadRoute =
      process.env.NODE_ENV !== 'production' &&
      request.method === 'POST' &&
      /\/api\/campaigns\/[^/]+\/images\/upload$/.test(requestPath);

    const isPublicCampaignImageRoute =
      request.method === 'GET' &&
      /\/api\/campaigns\/images\/[^/]+$/.test(requestPath);

    const isDevCampaignCreateRoute =
      process.env.NODE_ENV !== 'production' &&
      request.method === 'POST' &&
      /\/api\/campaigns$/.test(requestPath);

    if (isPublicRoute || isPublicCampaignImageRoute || isDevImageUploadRoute) {
      return true;
    }

    // For development-only campaign create route: if the client provided an
    // Authorization header, run the normal auth flow so `req.user` and
    // subsequently `req.accountId` can be populated by the TenantInterceptor.
    if (isDevCampaignCreateRoute) {
      const req2 = context.switchToHttp().getRequest();
      const authHeader =
        req2.headers?.authorization || req2.headers?.Authorization;
      if (!authHeader) {
        return true;
      }
      // if auth header present, fallthrough to super.canActivate
    }

    const result = (await super.canActivate(context)) as boolean;
    try {
      const req = context.switchToHttp().getRequest();
      // Log basic user/account info for debugging tenant issues in dev
      this.logger.debug(
        `JwtAuthGuard canActivate result=${result} user=${JSON.stringify(req.user || {})} accountId=${req.accountId}`,
      );
    } catch (err) {
      this.logger.debug('JwtAuthGuard: failed to log user info');
    }

    return result;
  }
}
