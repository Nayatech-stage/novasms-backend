import { NovaSendMobileMoneyProvider } from './novasend-mobile-money.provider';

const mockFetch = jest.fn();

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('NovaSendMobileMoneyProvider — API directe NovaSend (EN-1702)', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  const setEnv = () => {
    process.env = {
      ...originalEnv,
      NOVASEND_MM_API_KEY: 'mm-key',
      NOVASEND_MM_API_CLIENT: 'mm-client',
      FRONTEND_URL: 'https://app.novasms.ci',
    };
    delete process.env.NOVASEND_MM_BASE_URL;
  };

  const baseParams = {
    operator: 'WAVE' as const,
    phoneNumber: '+2250700000000',
    amount: 5000,
    currency: 'XOF',
    accountId: 'acc-1',
    userId: 'user-1',
  };

  const payinResponse = (overrides: Record<string, unknown> = {}) => ({
    id: 'pi-1',
    type: 'payin',
    reference: 'ref-1',
    status: 'processing',
    confirmationRequired: false,
    confirmationStatus: 'none',
    isDirect: true,
    payFee: false,
    createdAt: new Date().toISOString(),
    amount: 5000,
    fee: 50,
    chargedAmount: 5050,
    currency: 'XOF',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    setEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('exige les clés API NovaSend MM', () => {
    process.env = { ...originalEnv };
    delete process.env.NOVASEND_MM_API_KEY;

    expect(() => new NovaSendMobileMoneyProvider()).toThrow(
      'NOVASEND_MM_API_KEY',
    );
  });

  describe('initiatePayment', () => {
    it('appelle POST /direct/payin avec auth Basic et clé d’idempotence', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(payinResponse({ paymentUrl: 'https://pay.wave.com/x' })),
      );

      const result = await new NovaSendMobileMoneyProvider().initiatePayment(
        baseParams,
      );

      expect(result).toMatchObject({
        success: true,
        transactionId: 'pi-1',
        reference: 'ref-1',
        status: 'pending',
        paymentUrl: 'https://pay.wave.com/x',
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://business.novasend.app/v1/direct/payin');
      const expectedAuth = `Basic ${Buffer.from('mm-key:mm-client').toString('base64')}`;
      expect(init.headers.Authorization).toBe(expectedAuth);
      expect(init.headers['X-Idempotency-Key']).toBeDefined();

      const body = JSON.parse(init.body);
      expect(body.payin).toMatchObject({
        amount: 5000,
        msisdn: '+2250700000000',
        provider: 'WAVE',
        country: 'CI',
      });
      expect(body.action.successUrl).toBe(
        'https://app.novasms.ci/rechargement?payment=success',
      );
    });

    it('inclut l’OTP Orange Money dans le payin initial', async () => {
      mockFetch.mockResolvedValue(jsonResponse(payinResponse()));

      await new NovaSendMobileMoneyProvider().initiatePayment({
        ...baseParams,
        operator: 'ORANGE',
        otp: '1234',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payin.otp).toBe('1234');
    });

    it('remonte le message d’erreur métier NovaSend sur HTTP non-OK', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          { message: 'Numéro invalide pour cet opérateur' },
          false,
          422,
        ),
      );

      const result = await new NovaSendMobileMoneyProvider().initiatePayment(
        baseParams,
      );

      expect(result).toEqual({
        success: false,
        status: 'failed',
        error: 'Numéro invalide pour cet opérateur',
      });
    });

    it('capture les erreurs réseau sans lever', async () => {
      mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await new NovaSendMobileMoneyProvider().initiatePayment(
        baseParams,
      );

      expect(result).toEqual({
        success: false,
        status: 'failed',
        error: 'ETIMEDOUT',
      });
    });
  });

  describe('confirmPayment (no-op NovaSend)', () => {
    it('retourne completed sans appel API (OTP déjà transmis au payin)', async () => {
      const result = await new NovaSendMobileMoneyProvider().confirmPayment(
        'pi-1',
        '1234',
      );

      expect(result).toEqual({
        success: true,
        transactionId: 'pi-1',
        status: 'completed',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getStatus — mapping des statuts NovaSend', () => {
    it.each([
      ['processed', 'completed', true],
      ['processing', 'pending', false],
      ['expired', 'failed', false],
      ['failed', 'failed', false],
    ])(
      'mappe le statut NovaSend %s vers %s',
      async (novasendStatus, expected, success) => {
        mockFetch.mockResolvedValue(
          jsonResponse(payinResponse({ status: novasendStatus })),
        );

        const result = await new NovaSendMobileMoneyProvider().getStatus(
          'ref-1',
        );

        expect(result.status).toBe(expected);
        expect(result.success).toBe(success);
        expect(mockFetch.mock.calls[0][0]).toBe(
          'https://business.novasend.app/v1/payin/ref-1',
        );
      },
    );

    it('mappe un échec même si le statut est processing quand failure est présent', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          payinResponse({ status: 'processing', failure: { code: 'X' } }),
        ),
      );

      const result = await new NovaSendMobileMoneyProvider().getStatus('ref-1');

      expect(result.status).toBe('failed');
    });

    it('gère un HTTP non-OK', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, false, 404));

      const result = await new NovaSendMobileMoneyProvider().getStatus('ref-x');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });
  });
});
