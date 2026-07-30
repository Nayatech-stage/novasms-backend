const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn() })),
}));

import { MailService } from './mail.service';

describe('MailService — emails transactionnels via Resend (EN-1633)', () => {
  const originalEnv = process.env;

  const makeService = (env: Record<string, string | undefined>) => {
    process.env = { ...originalEnv, ...env };
    delete process.env.RESEND_TEST_RECIPIENT;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
    }
    return new MailService();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('envoie l’email de vérification avec le lien d’activation (Resend)', async () => {
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
      FRONTEND_PUBLIC_URL: 'https://app.novasms.com',
    });

    await service.sendVerificationEmail('client@example.ci', 'token-abc');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toEqual(['client@example.ci']);
    expect(payload.subject).toContain('Confirmez votre compte');
    expect(payload.html).toContain(
      'https://app.novasms.com/verify-email/token-abc',
    );
  });

  it('redirige vers RESEND_TEST_RECIPIENT en mode test', async () => {
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
    });
    process.env.RESEND_TEST_RECIPIENT = 'dev@novasms.com';

    await service.sendVerificationEmail('client@example.ci', 'token-abc');

    expect(mockSend.mock.calls[0][0].to).toEqual(['dev@novasms.com']);
  });

  it('envoie le code 2FA par email', async () => {
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
    });

    await service.sendTwoFactorCodeEmail('client@example.ci', '123456');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].html).toContain('123456');
  });

  it('envoie le lien de réinitialisation de mot de passe', async () => {
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
      FRONTEND_PUBLIC_URL: 'https://app.novasms.com',
    });

    await service.sendPasswordResetEmail('client@example.ci', 'reset-tok');

    expect(mockSend.mock.calls[0][0].html).toContain(
      'https://app.novasms.com/reset-password/reset-tok',
    );
  });

  it('ne lève pas d’erreur quand Resend échoue (fail-safe)', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'rate limited' },
    });
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
    });

    await expect(
      service.sendVerificationEmail('client@example.ci', 't'),
    ).resolves.toBeUndefined();
  });

  it('bascule en SMTP dev sans clé Resend hors production', async () => {
    const service = makeService({
      RESEND_API_KEY: undefined,
      NODE_ENV: 'development',
    });

    await service.sendVerificationEmail('client@example.ci', 't');

    // Aucun appel Resend en mode SMTP dev
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('envoie la notification de campagne envoyée (US-009)', async () => {
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
    });

    await service.sendCampaignSentNotification('admin@novasms.ci', {
      campaignName: 'Promo Tabaski',
      channelType: 'EMAIL',
      sentAt: new Date('2026-06-12T10:00:00Z'),
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect([payload.to].flat()).toEqual(['admin@novasms.ci']);
    expect(payload.html).toContain('Promo Tabaski');
  });

  it('envoie la confirmation de campagne par destinataire', async () => {
    const service = makeService({
      RESEND_API_KEY: 're_test_123',
      NODE_ENV: 'production',
    });

    await service.sendCampaignConfirmation('admin@novasms.ci', {
      campaignName: 'Promo',
      contactEmail: 'client@x.ci',
      sentAt: new Date(),
      campaignId: 'camp-1',
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].html).toContain('client@x.ci');
  });
});
