import { WhatsappProvider } from './whatsapp.provider.interface';

export class MockWhatsappProvider implements WhatsappProvider {
  async send(to: string, message: string) {
    // simple mock: log and return success
    // In a real provider this would call an API like Twilio Conversations/WhatsApp or Vonage
    // Keep deterministic for tests
    console.log(
      `[MockWhatsapp] send to=${to} message=${message.slice(0, 50)}...`,
    );
    return { success: true, messageId: `mock-wa-${Date.now()}` };
  }
}
