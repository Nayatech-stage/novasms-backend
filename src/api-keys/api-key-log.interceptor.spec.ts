import { ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ApiKeyLogInterceptor } from './api-key-log.interceptor';

const makeContext = (req: object, res: object): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => ({}),
  }) as unknown as ExecutionContext;

describe('ApiKeyLogInterceptor', () => {
  let interceptor: ApiKeyLogInterceptor;
  let prisma: { apiKeyLog: { create: jest.Mock } };

  beforeEach(() => {
    prisma = { apiKeyLog: { create: jest.fn().mockResolvedValue({}) } };
    interceptor = new ApiKeyLogInterceptor(prisma as any);
  });

  it("passe sans logguer si la requête n'a pas de apiKeyId", (done) => {
    const req = {
      method: 'GET',
      path: '/api/test',
      route: { path: '/api/test' },
    };
    const res = { statusCode: 200 };
    const ctx = makeContext(req, res);
    const next = { handle: () => of({ ok: true }) };

    interceptor.intercept(ctx, next as any).subscribe({
      next: () => {
        expect(prisma.apiKeyLog.create).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('logue un succès avec le bon statusCode', (done) => {
    const req = {
      apiKeyId: 'key-1',
      accountId: 'acc-1',
      method: 'POST',
      path: '/api/v1/sms',
      route: { path: '/api/v1/sms' },
      apiCreditsUsed: 3,
    };
    const res = { statusCode: 201 };
    const ctx = makeContext(req, res);
    const next = { handle: () => of({ sent: true }) };

    interceptor.intercept(ctx, next as any).subscribe({
      next: () => {
        // log est asynchrone — on donne un tick
        setImmediate(() => {
          expect(prisma.apiKeyLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              apiKeyId: 'key-1',
              accountId: 'acc-1',
              endpoint: '/api/v1/sms',
              method: 'POST',
              statusCode: 201,
              creditsUsed: 3,
            }),
          });
          done();
        });
      },
    });
  });

  it("logue une erreur avec le status de l'exception", (done) => {
    const req = {
      apiKeyId: 'key-1',
      accountId: 'acc-1',
      method: 'GET',
      path: '/api/v1/contacts',
      route: { path: '/api/v1/contacts' },
    };
    const res = { statusCode: 200 };
    const ctx = makeContext(req, res);
    const error = Object.assign(new Error('Forbidden'), { status: 403 });
    const next = { handle: () => throwError(() => error) };

    interceptor.intercept(ctx, next as any).subscribe({
      error: () => {
        setImmediate(() => {
          expect(prisma.apiKeyLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              apiKeyId: 'key-1',
              statusCode: 403,
              creditsUsed: 0,
            }),
          });
          done();
        });
      },
    });
  });

  it('utilise 500 comme statusCode si erreur sans status', (done) => {
    const req = {
      apiKeyId: 'key-1',
      accountId: 'acc-1',
      method: 'DELETE',
      path: '/api/v1/x',
      route: { path: '/api/v1/x' },
    };
    const res = { statusCode: 200 };
    const ctx = makeContext(req, res);
    const next = { handle: () => throwError(() => new Error('boom')) };

    interceptor.intercept(ctx, next as any).subscribe({
      error: () => {
        setImmediate(() => {
          expect(prisma.apiKeyLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ statusCode: 500 }),
          });
          done();
        });
      },
    });
  });

  it('utilise 0 credits si apiCreditsUsed absent', (done) => {
    const req = {
      apiKeyId: 'key-1',
      accountId: 'acc-1',
      method: 'GET',
      path: '/api/v1/contacts',
      route: { path: '/api/v1/contacts' },
    };
    const res = { statusCode: 200 };
    const ctx = makeContext(req, res);
    const next = { handle: () => of([]) };

    interceptor.intercept(ctx, next as any).subscribe({
      next: () => {
        setImmediate(() => {
          expect(prisma.apiKeyLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ creditsUsed: 0 }),
          });
          done();
        });
      },
    });
  });
});
