import { Logger } from '@nestjs/common';
import {
  SmsProvider,
  SmsSendResult,
  SmsBatchResult,
  SmsContact,
} from '../sms.provider.interface';

type NovaSendSmsResponse = {
  success: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Provider NovaSend SMS — API propriétaire Afrique de l'Ouest.
 * Production uniquement : NOVASEND_SMS_API_KEY requis.
 */
export class NovaSendSmsProvider implements SmsProvider {
  private readonly logger = new Logger(NovaSendSmsProvider.name);
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly baseUrl: string;

  constructor() {
    const apiKey = process.env.NOVASEND_SMS_API_KEY;
    const senderId = process.env.NOVASEND_SMS_SENDER_ID;

    if (!apiKey || !senderId) {
      throw new Error(
        'NOVASEND_SMS_API_KEY and NOVASEND_SMS_SENDER_ID are required for NovaSend SMS provider',
      );
    }

    this.apiKey = apiKey;
    this.senderId = senderId;
    this.baseUrl =
      process.env.NOVASEND_SMS_BASE_URL?.trim() || 'https://api.novasend.io/v1';
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ to, from: this.senderId, message }),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `NovaSend HTTP ${response.status}: ${text}`,
        };
      }

      const data = (await response.json()) as NovaSendSmsResponse;

      if (!data.success) {
        return { success: false, error: data.error || 'NovaSend send failed' };
      }

      return { success: true, messageId: data.messageId };
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'NovaSend send failed';
      this.logger.error(`NovaSend SMS error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  async sendBatch(
    contacts: SmsContact[],
    message: string,
  ): Promise<SmsBatchResult> {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const result = await this.send(contact.phone, message);
      if (result.success) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}
