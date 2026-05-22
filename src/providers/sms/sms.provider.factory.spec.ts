const { SmsProviderFactory } = require('./sms.provider.factory');

describe('SmsProviderFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses twilio as default primary provider when SMS_PROVIDER is not set', () => {
    delete process.env.SMS_PROVIDER;
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('twilio');
    expect(health.secondary).toBe('africastalking');
  });

  it('selects africastalking as primary provider when SMS_PROVIDER=africastalking', () => {
    process.env.SMS_PROVIDER = 'africastalking';
    const factory = new SmsProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('africastalking');
    expect(health.secondary).toBe('twilio');
  });

  it('fallbacks to secondary provider when primary returns success false', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    const factory = new SmsProviderFactory();

    const primary = {
      send: jest.fn().mockResolvedValue({ success: false, error: 'primary failed' }),
      sendBatch: jest.fn(),
    };

    const secondary = {
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'at-1' }),
      sendBatch: jest.fn(),
    };

    const provider = factory.getProvider({ twilio: primary, africastalking: secondary });
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

    const provider = factory.getProvider({ twilio: primary, africastalking: secondary });
    const result = await provider.send('+22501020304', 'Bonjour');

    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, messageId: 'at-2' });
  });
});
