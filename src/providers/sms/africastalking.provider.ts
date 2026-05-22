import { Logger } from '@nestjs/common';
import {
  SmsProvider,
  SmsSendResult,
  SmsBatchResult,
  SmsContact,
} from './sms.provider.interface';

type AfricasTalkingResponse = {
  SMSMessageData?: {
    Recipients?: Array<{
      statusCode?: number;
      messageId?: string;
      status?: string;
    }>;
  };
};

/**
 * Provider Africa's Talking (fallback/secondaire).
 * Oriente Afrique de l'Ouest avec l'API Messaging.
 */
export class AfricasTalkingProvider implements SmsProvider {
  private readonly logger = new Logger(AfricasTalkingProvider.name);
  private readonly apiKey: string;
  private readonly username: string;
  private readonly senderId: string;

  constructor() {
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;
    const senderId = process.env.AFRICASTALKING_SENDER_ID;

    if (!apiKey || !username || !senderId) {
      throw new Error(
        'AFRICASTALKING_API_KEY, AFRICASTALKING_USERNAME and AFRICASTALKING_SENDER_ID are required for AfricasTalking provider',
      );
    }

    this.apiKey = apiKey;
    this.username = username;
    this.senderId = senderId;
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    try {
      const body = new URLSearchParams({
        username: this.username,
        to,
        message,
        from: this.senderId,
      });

      const response = await fetch(
        'https://api.africastalking.com/version1/messaging',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            apiKey: this.apiKey,
          },
          body: body.toString(),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `AfricasTalking HTTP ${response.status}: ${text}`,
        };
      }

      const data = (await response.json()) as AfricasTalkingResponse;
      const recipient = data.SMSMessageData?.Recipients?.[0];

      if (!recipient || recipient.statusCode !== 101) {
        return {
          success: false,
          error: recipient?.status || 'AfricasTalking send failed',
        };
      }

      return { success: true, messageId: recipient.messageId };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'AfricasTalking send failed';
      this.logger.error(`AfricasTalking send error: ${messageText}`);
      return { success: false, error: messageText };
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
