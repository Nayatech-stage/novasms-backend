import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import {
  EmailProvider,
  EmailSendResult,
  EmailBatchResult,
  EmailContact,
} from './email.provider.interface';

/**
 * Provider Resend (principal).
 * Utilise le SDK officiel pour les envois unitaires et batch.
 */
export class ResendProvider implements EmailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly testRecipient?: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required for Resend provider');
    }

    this.resend = new Resend(apiKey);
    this.from = process.env.RESEND_FROM || 'NovaSMS <onboarding@resend.dev>';
    this.testRecipient = process.env.RESEND_TEST_RECIPIENT;
  }

  async send(
    to: string,
    subject: string,
    html: string,
  ): Promise<EmailSendResult> {
    try {
      const toRecipient = this.testRecipient || to;
      const result = await this.resend.emails.send({
        from: this.from,
        to: [toRecipient],
        subject,
        html,
      });

      if (result.error) {
        return {
          success: false,
          error: result.error.message || 'Resend send failed',
        };
      }

      return {
        success: true,
        messageId:
          typeof result.data?.id === 'string' ? result.data.id : undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Resend send failed';
      this.logger.error(`Resend send error: ${message}`);
      return { success: false, error: message };
    }
  }

  async sendBatch(
    contacts: EmailContact[],
    subject: string,
    html: string,
  ): Promise<EmailBatchResult> {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const result = await this.send(contact.email, subject, html);
      if (result.success) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}
