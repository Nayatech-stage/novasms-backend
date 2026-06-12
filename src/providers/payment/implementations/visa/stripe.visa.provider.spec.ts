const mockCreate = jest.fn();
const mockRetrieve = jest.fn();

class MockStripeError extends Error {}

jest.mock('stripe', () => {
  const MockStripe = jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockCreate, retrieve: mockRetrieve },
  }));
  (MockStripe as unknown as { errors: unknown }).errors = {
    StripeError: MockStripeError,
  };
  return { __esModule: true, default: MockStripe };
});

import { StripeVisaProvider } from './stripe.visa.provider';

describe('StripeVisaProvider — paiement Visa via Stripe (EN-1703)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: 'sk_test_visa' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('exige STRIPE_SECRET_KEY', () => {
    delete process.env.STRIPE_SECRET_KEY;

    expect(() => new StripeVisaProvider()).toThrow('STRIPE_SECRET_KEY');
  });

  it('charge en sandbox avec pm_card_visa confirmé', async () => {
    mockCreate.mockResolvedValue({ id: 'pi_v1', status: 'succeeded' });

    const result = await new StripeVisaProvider().charge({ amount: 5000 });

    expect(result).toEqual({
      success: true,
      transactionId: 'pi_v1',
      status: 'succeeded',
    });
    expect(mockCreate.mock.calls[0][0].payment_method).toBe('pm_card_visa');
  });

  it('relaye requires_action avec clientSecret (3DS)', async () => {
    mockCreate.mockResolvedValue({
      id: 'pi_v2',
      status: 'requires_action',
      client_secret: 'secret_v2',
    });

    const result = await new StripeVisaProvider().charge({
      amount: 8000,
      paymentMethodId: 'pm_3ds',
    });

    expect(result).toMatchObject({
      success: false,
      requiresAction: true,
      clientSecret: 'secret_v2',
    });
  });

  it('capture les erreurs Stripe sans lever', async () => {
    mockCreate.mockRejectedValue(new MockStripeError('Card declined'));

    const result = await new StripeVisaProvider().charge({ amount: 5000 });

    expect(result).toEqual({ success: false, error: 'Card declined' });
  });

  it('getPaymentIntent retourne null sur erreur', async () => {
    mockRetrieve.mockRejectedValue(new Error('not found'));

    expect(await new StripeVisaProvider().getPaymentIntent('pi_x')).toBeNull();
  });

  it('isConfigured reflète la clé', () => {
    expect(new StripeVisaProvider().isConfigured()).toBe(true);
  });
});
