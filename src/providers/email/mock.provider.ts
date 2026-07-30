import { Logger } from '@nestjs/common';
import type {
  EmailBatchResult,
  EmailContact,
  EmailProvider,
  EmailSendResult,
} from './email.provider.interface';

export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);

  async send(
    to: string,
    subject: string,
    html: string,
  ): Promise<EmailSendResult> {
    this.logger.warn(
      `Mock email send to=${to} subject=${subject} htmlLength=${html.length}`,
    );

    return {
      success: true,
      messageId: `mock-${Date.now()}`,
    };
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
