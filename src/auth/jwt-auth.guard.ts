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

    const isPublicCampaignImageRoute =
      request.method === 'GET' &&
      /\/api\/campaigns\/images\/[^/]+$/.test(requestPath);

    if (isPublicRoute || isPublicCampaignImageRoute) {
      return true;
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
