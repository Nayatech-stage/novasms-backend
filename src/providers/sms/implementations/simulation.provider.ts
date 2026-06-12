import { Logger } from '@nestjs/common';
import {
  SmsProvider,
  SmsSendResult,
  SmsBatchResult,
  SmsContact,
} from '../sms.provider.interface';

export class SimulationSmsProvider implements SmsProvider {
  private readonly logger = new Logger(SimulationSmsProvider.name);

  async send(to: string, message: string): Promise<SmsSendResult> {
    const messageId = `sim-${crypto.randomUUID()}`;
    this.logger.log(`[SMS SIMULATION] → ${to}: ${message}`);
    return { success: true, messageId };
  }

  async sendBatch(
    contacts: SmsContact[],
    message: string,
  ): Promise<SmsBatchResult> {
    for (const contact of contacts) {
      await this.send(contact.phone, message);
    }
    return { sent: contacts.length, failed: 0 };
  }
}
