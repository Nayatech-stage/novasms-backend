import { Logger } from '@nestjs/common';
import {
  EmailProvider,
  EmailSendResult,
  EmailBatchResult,
  EmailContact,
} from './email.provider.interface';

type BrevoSendResponse = {
  messageId?: string;
};

/**
 * Provider Brevo (fallback/secondaire).
 * Appels HTTP directs vers l'API Brevo Transactional Email.
 */
export class BrevoProvider implements EmailProvider {
  private readonly logger = new Logger(BrevoProvider.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor() {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new Error('BREVO_API_KEY is required for Brevo provider');
    }

    this.apiKey = apiKey;
    this.fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@novasms.local';
    this.fromName = process.env.BREVO_FROM_NAME || 'NovaSMS';
  }

  async send(to: string, subject: string, html: string): Promise<EmailSendResult> {
    try {
      const payload = {
        sender: {
          email: this.fromEmail,
          name: this.fromName,
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      };

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Brevo HTTP ${response.status}: ${text}` };
      }

      const data = (await response.json()) as BrevoSendResponse;
      return { success: true, messageId: data.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Brevo send failed';
      this.logger.error(`Brevo send error: ${message}`);
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
