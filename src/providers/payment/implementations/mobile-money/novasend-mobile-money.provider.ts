import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MobileMoneyProvider,
  MobileMoneyPaymentParams,
  MobileMoneyPaymentResult,
} from '../../interfaces/mobile-money.provider.interface';

// Réponse de l'API NovaSend POST /v1/direct/payin et GET /v1/payin/{reference}
type NovaSendPayinResponse = {
  id: string;
  type: string;
  reference: string;
  status: 'processing' | 'processed' | 'expired' | 'failed' | string;
  confirmationRequired: boolean;
  confirmationStatus: 'none' | 'pending' | 'accepted' | 'declined' | string;
  paymentUrl?: string;
  customer?: { name: string; phoneNumber: string };
  mobileMoney?: { provider: { name: string } };
  isDirect: boolean;
  payFee: boolean;
  createdAt: string;
  amount: number;
  fee: number;
  chargedAmount: number;
  currency: string;
  failure?: unknown;
};

type NovaSendErrorResponse = {
  message?: string;
  error?: string;
  statusCode?: number;
};

/**
 * Provider NovaSend Mobile Money — conforme à l'API directe NovaSend.
 * Endpoint: POST https://business.novasend.app/v1/direct/payin
 * Auth: Basic base64(api_key:api_client)
 * Opérateurs: WAVE, ORANGE, MOMO, MOOV
 */
export class NovaSendMobileMoneyProvider implements MobileMoneyProvider {
  private readonly logger = new Logger(NovaSendMobileMoneyProvider.name);
  private readonly apiKey: string;
  private readonly apiClient: string;
  private readonly baseUrl: string;
  private readonly frontendUrl: string;

  constructor() {
    const apiKey = process.env.NOVASEND_MM_API_KEY?.trim();
    const apiClient = process.env.NOVASEND_MM_API_CLIENT?.trim();
    if (!apiKey || !apiClient) {
      throw new Error(
        'NOVASEND_MM_API_KEY et NOVASEND_MM_API_CLIENT sont obligatoires pour le provider NovaSend Mobile Money',
      );
    }
    this.apiKey = apiKey;
    this.apiClient = apiClient;
    this.baseUrl =
      process.env.NOVASEND_MM_BASE_URL?.trim().replace(/\/$/, '') ||
      'https://business.novasend.app/v1';
    this.frontendUrl =
      process.env.FRONTEND_URL?.trim().replace(/\/$/, '') ||
      'http://localhost:5173';
  }

  /** Authorization: Basic base64(api_key:api_client) */
  private buildAuthHeader(): string {
    const credentials = Buffer.from(
      `${this.apiKey}:${this.apiClient}`,
    ).toString('base64');
    return `Basic ${credentials}`;
  }

  private mapStatus(
    novasendStatus: string,
    failure?: unknown,
  ): MobileMoneyPaymentResult['status'] {
    if (novasendStatus === 'processed') return 'completed';
    if (novasendStatus === 'expired' || novasendStatus === 'failed' || failure)
      return 'failed';
    return 'pending';
  }

  /**
   * Initie un paiement Mobile Money via l'API directe NovaSend.
   * Pour Orange Money : l'OTP (obtenu via #144*82#) est inclus dans cet appel.
   * Pour Wave : retourne un paymentUrl vers lequel rediriger le client.
   */
  async initiatePayment(
    params: MobileMoneyPaymentParams,
  ): Promise<MobileMoneyPaymentResult> {
    const reference = randomUUID();
    const idempotencyKey = randomUUID();

    const body: Record<string, unknown> = {
      reference,
      customerName: params.customerName ?? 'Client NovaSMS',
      payin: {
        amount: params.amount,
        msisdn: params.phoneNumber,
        provider: params.operator,
        country: params.country ?? 'CI',
        ...(params.otp ? { otp: params.otp } : {}),
      },
      action: {
        successUrl: `${this.frontendUrl}/rechargement?payment=success`,
        failureUrl: `${this.frontendUrl}/rechargement?payment=failed`,
      },
    };

    try {
      const response = await fetch(`${this.baseUrl}/direct/payin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.buildAuthHeader(),
          'X-Idempotency-Key': idempotencyKey,
          'Accept-Language': 'fr',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        let userMessage = `Erreur NovaSend (${response.status})`;
        try {
          const err = JSON.parse(text) as NovaSendErrorResponse;
          if (err.message) userMessage = err.message;
        } catch {
          /* ignore */
        }
        this.logger.error(`NovaSend payin HTTP ${response.status}: ${text}`);
        return { success: false, status: 'failed', error: userMessage };
      }

      const data = (await response.json()) as NovaSendPayinResponse;
      const status = this.mapStatus(data.status, data.failure);

      this.logger.log(
        `NovaSend payin initiated — ref=${data.reference} status=${data.status} operator=${params.operator}`,
      );

      return {
        success: true,
        transactionId: data.id,
        reference: data.reference,
        status,
        paymentUrl: data.paymentUrl,
      };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'NovaSend MM initiate failed';
      this.logger.error(`NovaSend MM initiatePayment error: ${msg}`);
      return { success: false, status: 'failed', error: msg };
    }
  }

  /**
   * Pour NovaSend, l'OTP est inclus dans l'appel initiatePayment.
   * Cette méthode est un no-op : elle retourne success pour déclencher
   * la mise à jour du solde côté service sans second appel API.
   */
  async confirmPayment(
    transactionId: string,
    _otp: string,
  ): Promise<MobileMoneyPaymentResult> {
    this.logger.log(
      `NovaSend confirmPayment (no-op) — transactionId=${transactionId}`,
    );
    return { success: true, transactionId, status: 'completed' };
  }

  /**
   * Vérifie le statut d'un paiement via GET /v1/payin/{reference}.
   */
  async getStatus(reference: string): Promise<MobileMoneyPaymentResult> {
    try {
      const response = await fetch(`${this.baseUrl}/payin/${reference}`, {
        method: 'GET',
        headers: {
          Authorization: this.buildAuthHeader(),
          'Accept-Language': 'fr',
        },
      });

      if (!response.ok) {
        this.logger.error(
          `NovaSend status HTTP ${response.status} for ref=${reference}`,
        );
        return {
          success: false,
          reference,
          status: 'failed',
          error: `Erreur statut (${response.status})`,
        };
      }

      const data = (await response.json()) as NovaSendPayinResponse;
      const status = this.mapStatus(data.status, data.failure);

      return {
        success: status === 'completed',
        transactionId: data.id,
        reference: data.reference,
        status,
        paymentUrl: data.paymentUrl,
      };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'NovaSend MM getStatus failed';
      this.logger.error(`NovaSend MM getStatus error: ${msg}`);
      return { success: false, reference, status: 'failed', error: msg };
    }
  }
}
