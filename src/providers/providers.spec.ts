import { MockEmailProvider } from './email/mock.provider';
import { MockWhatsappProvider } from './whatsapp/mock.whatsapp.provider';
import { WhatsappProviderFactory } from './whatsapp/whatsapp.provider.factory';
import { TwilioWhatsappProvider } from './whatsapp/twilio.whatsapp.provider';

describe('Providers — simulations et factories (INTEG-04)', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('MockEmailProvider', () => {
    it('simule un envoi unitaire avec messageId', async () => {
      const provider = new MockEmailProvider();

      const result = await provider.send('a@x.ci', 'Sujet', '<p>Hi</p>');

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^mock-/);
    });

    it('sendBatch compte les envois réussis', async () => {
      const provider = new MockEmailProvider();

      const result = await provider.sendBatch(
        [{ email: 'a@x.ci' }, { email: 'b@x.ci' }],
        'Sujet',
        '<p>Hi</p>',
      );

      expect(result).toEqual({ sent: 2, failed: 0 });
    });
  });

  describe('MockWhatsappProvider', () => {
    it('simule un envoi WhatsApp déterministe', async () => {
      const provider = new MockWhatsappProvider();

      const result = await provider.send('+2250700000000', 'Bonjour');

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^mock-wa-/);
    });
  });

  describe('WhatsappProviderFactory', () => {
    it('retourne le mock par défaut', () => {
      process.env = { ...originalEnv };
      delete process.env.WHATSAPP_PROVIDER;

      const provider = new WhatsappProviderFactory().getProvider();

      expect(provider).toBeInstanceOf(MockWhatsappProvider);
    });

    it('retombe sur le mock si la config Twilio est incomplète', () => {
      process.env = { ...originalEnv, WHATSAPP_PROVIDER: 'twilio' };
      delete process.env.TWILIO_ACCOUNT_SID;

      const provider = new WhatsappProviderFactory().getProvider();

      expect(provider).toBeInstanceOf(MockWhatsappProvider);
    });

    it('instancie Twilio quand toutes les variables sont présentes', () => {
      process.env = {
        ...originalEnv,
        WHATSAPP_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC-test',
        TWILIO_AUTH_TOKEN: 'token-test',
        TWILIO_WHATSAPP_NUMBER: '+14155238886',
      };

      const provider = new WhatsappProviderFactory().getProvider();

      expect(provider).toBeInstanceOf(TwilioWhatsappProvider);
    });

    it('expose un statut de santé', () => {
      process.env = { ...originalEnv, WHATSAPP_PROVIDER: 'mock' };

      expect(new WhatsappProviderFactory().getHealthStatus()).toEqual({
        providerType: 'whatsapp',
        provider: 'mock',
      });
    });
  });
});
