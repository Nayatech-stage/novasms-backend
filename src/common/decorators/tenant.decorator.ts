import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Tenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{
      accountId?: string;
      tenantAccountId?: string;
    }>();

    return request.accountId ?? request.tenantAccountId ?? null;
  },
);
