import { Logger } from '@nestjs/common';
import Stripe from 'stripe';

export interface PaymentIntent {
  id: string;
  status: string;
  clientSecret?: string;
}

export interface CardPaymentParams {
  amount: number; // en FCFA (converti en centimes EUR côté provider)
  currency?: string; // défaut 'eur'
  description?: string;
  /** Token généré par Stripe.js / Elements côté front */
  paymentMethodId?: string;
  /** Pour la simulation/test : utiliser un PM test directement */
  testPaymentMethodId?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  status?: string;
  error?: string;
  requiresAction?: boolean;
  clientSecret?: string;
}

/**
 * Provider Stripe pour paiements carte Visa/Mastercard.
 * Utilise l'API Stripe PaymentIntents.
 *
 * En production : fournir STRIPE_SECRET_KEY dans .env
 * En dev/sandbox : STRIPE_SECRET_KEY=sk_test_xxx → flux de test automatique
 */
export class StripeProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private readonly stripe: Stripe;
  private readonly isSandbox: boolean;

  constructor() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY is required for Stripe provider');
    }
    this.isSandbox = apiKey.startsWith('sk_test_');
    this.stripe = new Stripe(apiKey);
  }

  /**
   * Crée et confirme un PaymentIntent Stripe.
   * Si paymentMethodId est fourni, confirme immédiatement.
   * Sinon, retourne le clientSecret pour confirmation côté front.
   */
  async charge(params: CardPaymentParams): Promise<PaymentResult> {
    const {
      amount,
      currency = 'eur',
      description = 'Recharge NovaSMS',
      paymentMethodId,
      testPaymentMethodId,
    } = params;

    // Stripe travaille en centimes
    const amountInCents = Math.round(amount);

    try {
      const pmId =
        testPaymentMethodId ??
        paymentMethodId ??
        (this.isSandbox ? 'pm_card_visa' : undefined);

      const intentData: Stripe.PaymentIntentCreateParams = {
        amount: amountInCents,
        currency,
        description,
        automatic_payment_methods: pmId ? undefined : { enabled: true },
        payment_method: pmId,
        confirm: Boolean(pmId),
        return_url: `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/rechargement?status=success`,
      };

      const intent = await this.stripe.paymentIntents.create(intentData);

      if (intent.status === 'succeeded') {
        this.logger.log(`Stripe PaymentIntent succeeded: ${intent.id}`);
        return {
          success: true,
          transactionId: intent.id,
          status: 'succeeded',
        };
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

  /** Récupère le statut d'un PaymentIntent existant */
  async getPaymentIntent(id: string): Promise<PaymentIntent | null> {
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
