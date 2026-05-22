const { EmailProviderFactory } = require('./email.provider.factory');

describe('EmailProviderFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses resend as default primary provider when EMAIL_PROVIDER is not set', () => {
    delete process.env.EMAIL_PROVIDER;
    const factory = new EmailProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('resend');
    expect(health.secondary).toBe('brevo');
  });

  it('selects brevo as primary provider when EMAIL_PROVIDER=brevo', () => {
    process.env.EMAIL_PROVIDER = 'brevo';
    const factory = new EmailProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.primary).toBe('brevo');
    expect(health.secondary).toBe('resend');
  });

  it('fallbacks to secondary provider when primary returns success false', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    const factory = new EmailProviderFactory();

    const primary = {
      send: jest.fn().mockResolvedValue({ success: false, error: 'primary failed' }),
      sendBatch: jest.fn(),
    };

    const secondary = {
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'brevo-1' }),
      sendBatch: jest.fn(),
    };

    const provider = factory.getProvider({ resend: primary, brevo: secondary });
    const result = await provider.send('test@example.com', 'Sujet', '<b>Hi</b>');

    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, messageId: 'brevo-1' });
  });

  it('fallbacks to secondary provider when primary throws', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    const factory = new EmailProviderFactory();

    const primary = {
      send: jest.fn().mockRejectedValue(new Error('runtime error')),
      sendBatch: jest.fn(),
    };

    const secondary = {
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'brevo-2' }),
      sendBatch: jest.fn(),
    };

    const provider = factory.getProvider({ resend: primary, brevo: secondary });
    const result = await provider.send('test@example.com', 'Sujet', '<b>Hi</b>');

    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(secondary.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, messageId: 'brevo-2' });
  });
});
