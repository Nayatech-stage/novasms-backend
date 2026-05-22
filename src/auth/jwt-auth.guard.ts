import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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

    if (
      isPublicRoute ||
      isPublicCampaignImageRoute ||
      isDevImageUploadRoute ||
      isDevCampaignCreateRoute
    ) {
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
