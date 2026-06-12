import { AfricasTalkingProvider } from './sms/africastalking.provider';
import { NovaSendSmsProvider } from './sms/implementations/novasend.provider';
import { BrevoProvider } from './email/brevo.provider';
import { TwilioProvider } from './sms/twilio.provider';
import { TwilioWhatsappProvider } from './whatsapp/twilio.whatsapp.provider';

const mockFetch = jest.fn();

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('Providers HTTP — Africa’s Talking / NovaSend SMS / Brevo', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe('AfricasTalkingProvider', () => {
    const setEnv = () => {
      process.env = {
        ...originalEnv,
        AFRICASTALKING_API_KEY: 'at-key',
        AFRICASTALKING_USERNAME: 'sandbox',
        AFRICASTALKING_SENDER_ID: 'NOVASMS',
      };
    };

    it('exige les variables d’environnement', () => {
      process.env = { ...originalEnv };
      delete process.env.AFRICASTALKING_API_KEY;

      expect(() => new AfricasTalkingProvider()).toThrow(
        'AFRICASTALKING_API_KEY',
      );
    });

    it('utilise l’URL sandbox pour le compte sandbox', async () => {
      setEnv();
      mockFetch.mockResolvedValue(
        jsonResponse({
          SMSMessageData: {
            Recipients: [{ statusCode: 101, messageId: 'at-1' }],
          },
        }),
      );

      const result = await new AfricasTalkingProvider().send(
        '+2250700000000',
        'Hello STOP',
      );

      expect(result).toEqual({ success: true, messageId: 'at-1' });
      expect(mockFetch.mock.calls[0][0]).toContain(
        'api.sandbox.africastalking.com',
      );
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers.apiKey).toBe('at-key');
    });

    it('retourne une erreur sur statusCode différent de 101', async () => {
      setEnv();
      mockFetch.mockResolvedValue(
        jsonResponse({
          SMSMessageData: {
            Recipients: [{ statusCode: 406, status: 'UserInBlacklist' }],
          },
        }),
      );

      const result = await new AfricasTalkingProvider().send('+225x', 'Hi');

      expect(result).toEqual({ success: false, error: 'UserInBlacklist' });
    });

    it('gère les erreurs HTTP sans lever', async () => {
      setEnv();
      mockFetch.mockResolvedValue(
        jsonResponse({ error: 'denied' }, false, 403),
      );

      const result = await new AfricasTalkingProvider().send('+225x', 'Hi');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });

    it('sendBatch agrège les succès et échecs', async () => {
      setEnv();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            SMSMessageData: {
              Recipients: [{ statusCode: 101, messageId: 'a' }],
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({}, false, 500));

      const result = await new AfricasTalkingProvider().sendBatch(
        [{ phone: '+2250700000001' }, { phone: '+2250700000002' }],
        'Hello',
      );

      expect(result).toEqual({ sent: 1, failed: 1 });
    });
  });

  describe('NovaSendSmsProvider (EN-1702)', () => {
    const setEnv = () => {
      process.env = {
        ...originalEnv,
        NOVASEND_SMS_API_KEY: 'ns-key',
        NOVASEND_SMS_SENDER_ID: 'NOVASMS',
      };
    };

    it('exige la clé API NovaSend', () => {
      process.env = { ...originalEnv };
      delete process.env.NOVASEND_SMS_API_KEY;

      expect(() => new NovaSendSmsProvider()).toThrow('NOVASEND_SMS_API_KEY');
    });

    it('envoie avec authentification Bearer', async () => {
      setEnv();
      mockFetch.mockResolvedValue(
        jsonResponse({ success: true, messageId: 'ns-1' }),
      );

      const result = await new NovaSendSmsProvider().send(
        '+2250700000000',
        'Hello',
      );

      expect(result).toEqual({ success: true, messageId: 'ns-1' });
      const { headers, body } = mockFetch.mock.calls[0][1];
      expect(headers.Authorization).toBe('Bearer ns-key');
      expect(JSON.parse(body)).toMatchObject({
        to: '+2250700000000',
        from: 'NOVASMS',
      });
    });

    it('relaye l’erreur métier NovaSend', async () => {
      setEnv();
      mockFetch.mockResolvedValue(
        jsonResponse({ success: false, error: 'Solde insuffisant' }),
      );

      const result = await new NovaSendSmsProvider().send('+225x', 'Hi');

      expect(result).toEqual({ success: false, error: 'Solde insuffisant' });
    });

    it('capture les erreurs réseau sans lever', async () => {
      setEnv();
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));

      const result = await new NovaSendSmsProvider().send('+225x', 'Hi');

      expect(result).toEqual({ success: false, error: 'ECONNRESET' });
    });
  });

  describe('BrevoProvider (fallback email)', () => {
    const setEnv = () => {
      process.env = {
        ...originalEnv,
        BREVO_API_KEY: 'brevo-key',
        BREVO_FROM_EMAIL: 'noreply@novasms.ci',
        BREVO_FROM_NAME: 'NovaSMS',
      };
    };

    it('exige la clé API Brevo', () => {
      process.env = { ...originalEnv };
      delete process.env.BREVO_API_KEY;

      expect(() => new BrevoProvider()).toThrow('BREVO_API_KEY');
    });

    it('envoie un email transactionnel avec expéditeur configuré', async () => {
      setEnv();
      mockFetch.mockResolvedValue(jsonResponse({ messageId: 'brevo-1' }));

      const result = await new BrevoProvider().send(
        'client@x.ci',
        'Sujet',
        '<p>Corps</p>',
      );

      expect(result).toEqual({ success: true, messageId: 'brevo-1' });
      const { headers, body } = mockFetch.mock.calls[0][1];
      expect(headers['api-key']).toBe('brevo-key');
      expect(JSON.parse(body)).toMatchObject({
        sender: { email: 'noreply@novasms.ci', name: 'NovaSMS' },
        to: [{ email: 'client@x.ci' }],
        subject: 'Sujet',
      });
    });

    it('gère les erreurs HTTP Brevo', async () => {
      setEnv();
      mockFetch.mockResolvedValue(
        jsonResponse({ message: 'unauthorized' }, false, 401),
      );

      const result = await new BrevoProvider().send('c@x.ci', 'S', '<p/>');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 401');
    });
  });

  describe('TwilioProvider (SMS principal)', () => {
    const setEnv = () => {
      process.env = {
        ...originalEnv,
        TWILIO_ACCOUNT_SID: 'AC-test',
        TWILIO_AUTH_TOKEN: 'tok-test',
        TWILIO_PHONE_NUMBER: '+14155550100',
      };
    };

    it('exige les identifiants Twilio', () => {
      process.env = { ...originalEnv };
      delete process.env.TWILIO_ACCOUNT_SID;

      expect(() => new TwilioProvider()).toThrow('TWILIO_ACCOUNT_SID');
    });

    it('envoie via l’API Messages avec authentification Basic', async () => {
      setEnv();
      mockFetch.mockResolvedValue(jsonResponse({ sid: 'SM-1' }));

      const result = await new TwilioProvider().send(
        '+2250700000000',
        'Hello STOP',
      );

      expect(result).toEqual({ success: true, messageId: 'SM-1' });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/Accounts/AC-test/Messages.json');
      expect(init.headers.Authorization).toMatch(/^Basic /);
      expect(init.body).toContain('From=%2B14155550100');
    });

    it('gère les erreurs HTTP Twilio sans lever', async () => {
      setEnv();
      mockFetch.mockResolvedValue(jsonResponse({ code: 21211 }, false, 400));

      const result = await new TwilioProvider().send('+bad', 'Hi');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 400');
    });
  });

  describe('TwilioWhatsappProvider', () => {
    const setEnv = () => {
      process.env = {
        ...originalEnv,
        TWILIO_ACCOUNT_SID: 'AC-wa',
        TWILIO_AUTH_TOKEN: 'tok-wa',
        TWILIO_WHATSAPP_NUMBER: '+14155238886',
      };
    };

    it('échoue proprement sans identifiants', async () => {
      process.env = { ...originalEnv };
      delete process.env.TWILIO_ACCOUNT_SID;

      const result = await new TwilioWhatsappProvider().send('+225x', 'Hi');

      expect(result).toEqual({
        success: false,
        error: 'Twilio credentials missing',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('préfixe les numéros avec whatsapp: et envoie via Twilio', async () => {
      setEnv();
      mockFetch.mockResolvedValue(jsonResponse({ sid: 'WA-1' }));

      const result = await new TwilioWhatsappProvider().send(
        '+2250700000000',
        'Bonjour',
      );

      expect(result).toEqual({ success: true, messageId: 'WA-1' });
      const [, init] = mockFetch.mock.calls[0];
      const body = init.body.toString();
      expect(body).toContain('From=whatsapp%3A%2B14155238886');
      expect(body).toContain('To=whatsapp%3A%2B2250700000000');
    });

    it('gère les erreurs HTTP Twilio WhatsApp', async () => {
      setEnv();
      mockFetch.mockResolvedValue(jsonResponse({ code: 63016 }, false, 400));

      const result = await new TwilioWhatsappProvider().send('+225x', 'Hi');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Twilio error 400');
    });
  });
});
