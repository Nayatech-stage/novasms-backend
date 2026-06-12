import { Logger } from '@nestjs/common';
import {
  VisaProvider,
  VisaPaymentParams,
  VisaPaymentResult,
} from '../../interfaces/visa.provider.interface';

export class SimulationVisaProvider implements VisaProvider {
  private readonly logger = new Logger(SimulationVisaProvider.name);

  async charge(params: VisaPaymentParams): Promise<VisaPaymentResult> {
    const transactionId = `sim-visa-${crypto.randomUUID()}`;
    this.logger.log(
      `[VISA SIMULATION] charge → ${params.amount} ${params.currency ?? 'eur'} (${params.description ?? 'Recharge NovaSMS'})`,
    );
    return { success: true, transactionId, status: 'succeeded' };
  }

  async getPaymentIntent(
    id: string,
  ): Promise<{ id: string; status: string } | null> {
    return { id, status: 'succeeded' };
  }

  isConfigured(): boolean {
    return true;
  }
}
