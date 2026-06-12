import { Logger } from '@nestjs/common';
import {
  MobileMoneyProvider,
  MobileMoneyPaymentParams,
  MobileMoneyPaymentResult,
} from '../../interfaces/mobile-money.provider.interface';

export class SimulationMobileMoneyProvider implements MobileMoneyProvider {
  /** Délai simulé de traitement opérateur avant auto-complétion (ms). */
  private static readonly PROCESSING_DELAY_MS = 3000;

  private readonly logger = new Logger(SimulationMobileMoneyProvider.name);
  private readonly pending = new Map<string, MobileMoneyPaymentResult>();
  private readonly initiatedAt = new Map<string, number>();

  async initiatePayment(
    params: MobileMoneyPaymentParams,
  ): Promise<MobileMoneyPaymentResult> {
    const transactionId = `sim-mm-${crypto.randomUUID()}`;
    const result: MobileMoneyPaymentResult = {
      success: true,
      transactionId,
      status: 'pending',
    };

    this.pending.set(transactionId, result);
    this.initiatedAt.set(transactionId, Date.now());
    this.logger.log(
      `[MOBILE MONEY SIMULATION] initiate → ${params.operator} ${params.phoneNumber} ${params.amount} ${params.currency}`,
    );
    return result;
  }

  async confirmPayment(
    transactionId: string,
    otp: string,
  ): Promise<MobileMoneyPaymentResult> {
    this.logger.log(
      `[MOBILE MONEY SIMULATION] confirm → ${transactionId} OTP=${otp}`,
    );

    const isValidOtp = otp.length >= 4;
    if (!isValidOtp) {
      return {
        success: false,
        transactionId,
        status: 'failed',
        error: 'OTP invalide',
      };
    }

    const result: MobileMoneyPaymentResult = {
      success: true,
      transactionId,
      status: 'completed',
    };
    this.pending.set(transactionId, result);
    return result;
  }

  async getStatus(transactionId: string): Promise<MobileMoneyPaymentResult> {
    const existing = this.pending.get(transactionId);
    if (!existing) {
      return {
        success: false,
        transactionId,
        status: 'failed',
        error: 'Transaction introuvable',
      };
    }
    // Simulate async processing: auto-complete once the operator delay elapsed
    const startedAt = this.initiatedAt.get(transactionId) ?? 0;
    const processingElapsed =
      Date.now() - startedAt >=
      SimulationMobileMoneyProvider.PROCESSING_DELAY_MS;
    if (existing.status === 'pending' && processingElapsed) {
      const completed: MobileMoneyPaymentResult = {
        success: true,
        transactionId,
        status: 'completed',
      };
      this.pending.set(transactionId, completed);
      this.logger.log(
        `[MOBILE MONEY SIMULATION] getStatus → auto-complete ${transactionId}`,
      );
      return completed;
    }
    return existing;
  }
}
