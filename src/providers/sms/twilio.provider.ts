import { Logger } from '@nestjs/common';
import {
  SmsProvider,
  SmsSendResult,
  SmsBatchResult,
  SmsContact,
} from './sms.provider.interface';

type TwilioMessageResponse = {
  sid?: string;
};

/**
 * Provider Twilio (principal).
 * Appels HTTP directs vers Twilio Messages API.
 */
export class TwilioProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioProvider.name);
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error(
        'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER are required for Twilio provider',
      );
    }

    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    try {
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString(
        'base64',
      );
      const body = new URLSearchParams({
        To: to,
        From: this.fromNumber,
        Body: message,
      });

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Twilio HTTP ${response.status}: ${text}` };
      }

      const data = (await response.json()) as TwilioMessageResponse;
      return { success: true, messageId: data.sid };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Twilio send failed';
      this.logger.error(`Twilio send error: ${messageText}`);
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
