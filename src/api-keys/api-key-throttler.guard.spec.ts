import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';

describe('ApiKeyThrottlerGuard', () => {
  let guard: ApiKeyThrottlerGuard;

  beforeEach(() => {
    guard = new ApiKeyThrottlerGuard({} as any, {} as any, {} as any);
  });

  it('utilise apiKeyId comme tracker quand disponible', async () => {
    const req: any = { apiKeyId: 'key-abc', ip: '1.2.3.4' };
    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('key-abc');
  });

  it("utilise l'IP comme tracker en l'absence de apiKeyId", async () => {
    const req: any = { apiKeyId: undefined, ip: '10.0.0.1' };
    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('10.0.0.1');
  });

  it('retourne "unknown" si ni apiKeyId ni IP', async () => {
    const req: any = { apiKeyId: undefined, ip: undefined };
    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('unknown');
  });

  it("surcharge le message d'erreur de rate-limit", () => {
    expect((guard as any).errorMessage).toContain('60 requêtes par minute');
  });
});
