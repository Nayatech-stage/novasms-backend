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

import { StripeProvider } from './stripe.provider';

describe('StripeProvider — paiement carte (RG-48/EN-1703)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: 'sk_test_123' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('exige STRIPE_SECRET_KEY', () => {
    delete process.env.STRIPE_SECRET_KEY;

    expect(() => new StripeProvider()).toThrow('STRIPE_SECRET_KEY');
  });

  describe('charge', () => {
    it('confirme immédiatement avec pm_card_visa en sandbox', async () => {
      mockCreate.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });

      const result = await new StripeProvider().charge({ amount: 5000 });

      expect(result).toEqual({
        success: true,
        transactionId: 'pi_1',
        status: 'succeeded',
      });
      const intentData = mockCreate.mock.calls[0][0];
      expect(intentData.payment_method).toBe('pm_card_visa');
      expect(intentData.confirm).toBe(true);
      expect(intentData.amount).toBe(5000);
    });

    it('retourne requiresAction + clientSecret pour 3D Secure', async () => {
      mockCreate.mockResolvedValue({
        id: 'pi_2',
        status: 'requires_action',
        client_secret: 'pi_2_secret',
      });

      const result = await new StripeProvider().charge({
        amount: 10000,
        paymentMethodId: 'pm_real',
      });

      expect(result).toMatchObject({
        success: false,
        requiresAction: true,
        clientSecret: 'pi_2_secret',
        transactionId: 'pi_2',
      });
    });

    it('signale un statut inattendu sans lever', async () => {
      mockCreate.mockResolvedValue({ id: 'pi_3', status: 'canceled' });

      const result = await new StripeProvider().charge({ amount: 5000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('canceled');
    });

    it('capture les erreurs Stripe (carte refusée)', async () => {
      mockCreate.mockRejectedValue(
        new MockStripeError('Your card was declined'),
      );

      const result = await new StripeProvider().charge({ amount: 5000 });

      expect(result).toEqual({
        success: false,
        error: 'Your card was declined',
      });
    });
  });

  describe('getPaymentIntent / isConfigured', () => {
    it('retourne le statut du PaymentIntent', async () => {
      mockRetrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });

      const intent = await new StripeProvider().getPaymentIntent('pi_1');

      expect(intent).toEqual({ id: 'pi_1', status: 'succeeded' });
    });

    it('retourne null si le PaymentIntent est introuvable', async () => {
      mockRetrieve.mockRejectedValue(new Error('No such payment_intent'));

      const intent = await new StripeProvider().getPaymentIntent('pi_x');

      expect(intent).toBeNull();
    });

    it('isConfigured reflète la présence de la clé', () => {
      expect(new StripeProvider().isConfigured()).toBe(true);
    });
  });
});
