import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  VisaProvider,
  VisaPaymentParams,
  VisaPaymentResult,
} from '../../interfaces/visa.provider.interface';

/**
 * Provider Stripe pour paiements Visa/Mastercard.
 * Wraps Stripe PaymentIntents API.
 * En test : STRIPE_SECRET_KEY=sk_test_xxx → flux automatique pm_card_visa.
 */
export class StripeVisaProvider implements VisaProvider {
  private readonly logger = new Logger(StripeVisaProvider.name);
  private readonly stripe: Stripe;
  private readonly isSandbox: boolean;

  constructor() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY is required for Stripe Visa provider');
    }
    this.isSandbox = apiKey.startsWith('sk_test_');
    this.stripe = new Stripe(apiKey);
  }

  async charge(params: VisaPaymentParams): Promise<VisaPaymentResult> {
    const {
      amount,
      currency = 'eur',
      description = 'Recharge NovaSMS',
      paymentMethodId,
    } = params;

    try {
      const pmId =
        paymentMethodId ?? (this.isSandbox ? 'pm_card_visa' : undefined);

      const intentData: Stripe.PaymentIntentCreateParams = {
        amount: Math.round(amount),
        currency,
        description,
        automatic_payment_methods: pmId ? undefined : { enabled: true },
        payment_method: pmId,
        confirm: Boolean(pmId),
        return_url: `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/rechargement?status=success`,
      };

      const intent = await this.stripe.paymentIntents.create(intentData);

      if (intent.status === 'succeeded') {
        return { success: true, transactionId: intent.id, status: 'succeeded' };
      }

      if (
        intent.status === 'requires_action' ||
        intent.status === 'requires_confirmation'
      ) {
        return {
          success: false,
          requiresAction: true,
          clientSecret: intent.client_secret ?? undefined,
          transactionId: intent.id,
          status: intent.status,
        };
      }

      return {
        success: false,
        transactionId: intent.id,
        status: intent.status,
        error: `Paiement en statut inattendu: ${intent.status}`,
      };
    } catch (err) {
      const message =
        err instanceof Stripe.errors.StripeError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Stripe charge failed';
      this.logger.error(`Stripe error: ${message}`);
      return { success: false, error: message };
    }
  }

  async getPaymentIntent(
    id: string,
  ): Promise<{ id: string; status: string } | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(id);
      return { id: intent.id, status: intent.status };
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }
}
