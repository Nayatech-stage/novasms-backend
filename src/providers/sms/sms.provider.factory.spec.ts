const { SmsProviderFactory } = require('./sms.provider.factory');

describe('SmsProviderFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── Défaut : simulation ────────────────────────────────────────────────────

  it('uses simulation as default primary provider when SMS_PROVIDER is not set', () => {
    delete process.env.SMS_PROVIDER;
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('simulation');
    expect(health.secondary).toBeNull();
    expect(health.config.simulationActive).toBe(true);
    expect(health.config.fallbackEnabled).toBe(false);
  });

  it('selects simulation when SMS_PROVIDER=simulation — no failover', () => {
    process.env.SMS_PROVIDER = 'simulation';
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('simulation');
    expect(health.secondary).toBeNull();
  });

  it('routes directly to simulation provider (no http calls)', async () => {
    process.env.SMS_PROVIDER = 'simulation';
    const factory = new SmsProviderFactory();

    const provider = factory.getProvider();
    const result = await provider.send('+22507000000', 'Test simulation');

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^sim-/);
  });

  it('sendBatch simulation returns all sent', async () => {
    process.env.SMS_PROVIDER = 'simulation';
    const factory = new SmsProviderFactory();

    const provider = factory.getProvider();
    const contacts = [
      { phone: '+22507111111' },
      { phone: '+22507222222' },
      { phone: '+22507333333' },
    ];
    const result = await provider.sendBatch(contacts, 'Batch test');

    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);
  });

  // ── Sélection africastalking / twilio ──────────────────────────────────────

  it('selects africastalking as primary when SMS_PROVIDER=africastalking', () => {
    process.env.SMS_PROVIDER = 'africastalking';
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('africastalking');
    expect(health.secondary).toBe('twilio');
  });

  it('selects twilio as primary when SMS_PROVIDER=twilio', () => {
    process.env.SMS_PROVIDER = 'twilio';
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('twilio');
    expect(health.secondary).toBe('africastalking');
  });

  // ── Failover twilio / africastalking ───────────────────────────────────────

  it('fallbacks to secondary provider when primary returns success false', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    const factory = new SmsProviderFactory();

    const primary = {
      send: jest
        .fn()
        .mockResolvedValue({ success: false, error: 'primary failed' }),
      sendBatch: jest.fn(),
    };
    const secondary = {
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'at-1' }),
      sendBatch: jest.fn(),
    };

    const provider = factory.getProvider({
      twilio: primary,
      africastalking: secondary,
    });
    const result = await provider.send('+22501020304', 'Bonjour');

    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, messageId: 'at-1' });
  });

  it('fallbacks to secondary provider when primary throws', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    const factory = new SmsProviderFactory();

    const primary = {
      send: jest.fn().mockRejectedValue(new Error('runtime error')),
      sendBatch: jest.fn(),
    };
    const secondary = {
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'at-2' }),
      sendBatch: jest.fn(),
    };

    const provider = factory.getProvider({
      twilio: primary,
      africastalking: secondary,
    });
    const result = await provider.send('+22501020304', 'Bonjour');

    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, messageId: 'at-2' });
  });

  // ── novasend standalone ────────────────────────────────────────────────────

  it('selects novasend as standalone primary when SMS_PROVIDER=novasend', () => {
    process.env.SMS_PROVIDER = 'novasend';
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('novasend');
    expect(health.secondary).toBeNull();
  });
});
