import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import type { Request, Response } from 'express';

type ApiRequest = Request & {
  accountId?: string;
  apiKeyId?: string;
  apiCreditsUsed?: number;
};

@Injectable()
export class ApiKeyLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    if (!req.apiKeyId) return next.handle();

    const method = req.method;
    const endpoint = req.route?.path ?? req.path ?? 'unknown';
    const apiKeyId = req.apiKeyId;
    const accountId = req.accountId!;

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = res.statusCode;
          const creditsUsed = req.apiCreditsUsed ?? 0;
          this.prisma.apiKeyLog
            .create({
              data: {
                apiKeyId,
                accountId,
                endpoint,
                method,
                statusCode,
                creditsUsed,
              },
            })
            .catch(() => {});
        },
        error: (err: { status?: number }) => {
          const statusCode = err?.status ?? 500;
          this.prisma.apiKeyLog
            .create({
              data: {
                apiKeyId,
                accountId,
                endpoint,
                method,
                statusCode,
                creditsUsed: 0,
              },
            })
            .catch(() => {});
        },
      }),
    );
  }
}
