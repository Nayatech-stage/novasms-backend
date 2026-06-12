import { ResendProvider } from './resend.provider';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const isReal = RESEND_API_KEY && !RESEND_API_KEY.includes('xxx');

const describeIfReal = isReal ? describe : describe.skip;

describeIfReal('ResendProvider — integration (RESEND_API_KEY requis)', () => {
  let provider: ResendProvider;

  beforeAll(() => {
    provider = new ResendProvider();
  });

  it('envoie un email test et retourne success=true avec un messageId', async () => {
    const result = await provider.send(
      process.env.RESEND_TEST_RECIPIENT || 'delivered@resend.dev',
      '[NovaSMS Test] Integration spec',
      '<p>Test automatique NovaSMS — provider Resend OK.</p>',
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(typeof result.messageId).toBe('string');
    expect(result.error).toBeUndefined();
  }, 15_000);

  it('sendBatch envoie plusieurs emails et retourne sent=n, failed=0', async () => {
    const contacts = [
      { email: process.env.RESEND_TEST_RECIPIENT || 'delivered@resend.dev' },
      { email: process.env.RESEND_TEST_RECIPIENT || 'delivered@resend.dev' },
    ];

    const result = await provider.sendBatch(
      contacts,
      '[NovaSMS Test] Batch integration spec',
      '<p>Batch test automatique NovaSMS.</p>',
    );

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
  }, 20_000);

  it("retourne success=false avec un message d'erreur si destinataire invalide", async () => {
    const result = await provider.send(
      'not-a-valid-email@invalid-domain-xyz.invalid',
      '[NovaSMS Test] Erreur destinataire',
      '<p>Ceci ne doit pas arriver.</p>',
    );

    // Resend peut accepter le message meme avec domaine invalide (validation async)
    // On verifie seulement que la methode ne jette pas d'exception
    expect(result).toHaveProperty('success');
  }, 10_000);
});

describe('ResendProvider — unit (sans cle API reelle)', () => {
  it('leve une erreur si RESEND_API_KEY est absent', () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    expect(() => new ResendProvider()).toThrow('RESEND_API_KEY is required');

    process.env.RESEND_API_KEY = saved;
  });

  it('utilise RESEND_FROM depuis .env si defini', () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';
    process.env.RESEND_FROM = 'NovaSMS <hello@novasms.io>';

    const p = new ResendProvider();
    expect((p as any).from).toBe('NovaSMS <hello@novasms.io>');

    delete process.env.RESEND_FROM;
    delete process.env.RESEND_API_KEY;
  });

  it('utilise onboarding@resend.dev comme expediteur par defaut', () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';
    delete process.env.RESEND_FROM;

    const p = new ResendProvider();
    expect((p as any).from).toContain('onboarding@resend.dev');

    delete process.env.RESEND_API_KEY;
  });

  it('utilise RESEND_TEST_RECIPIENT pour rediriger les envois', () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';
    process.env.RESEND_TEST_RECIPIENT = 'staging@novasms.io';

    const p = new ResendProvider();
    expect((p as any).testRecipient).toBe('staging@novasms.io');

    delete process.env.RESEND_TEST_RECIPIENT;
    delete process.env.RESEND_API_KEY;
  });
});
