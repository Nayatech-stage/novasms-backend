import { Logger } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp.provider.interface';

export class MockWhatsappProvider implements WhatsappProvider {
  private readonly logger = new Logger(MockWhatsappProvider.name);

  async send(to: string, message: string) {
    // simple mock: log and return success
    // In a real provider this would call an API like Twilio Conversations/WhatsApp or Vonage
    // Keep deterministic for tests
    this.logger.log(
      `[SIMULATION WhatsApp] send to=${to} message=${message.slice(0, 50)}...`,
    );
    return { success: true, messageId: `mock-wa-${Date.now()}` };
  }
}
