export interface WhatsappProvider {
  send(
    to: string,
    message: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
