export interface PushSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface PushProvider {
  /**
   * Envoyer une notification push à un device token FCM ou endpoint Web Push
   */
  send(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushSendResult>;

  /**
   * Envoyer à plusieurs tokens en batch
   */
  sendBatch(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number }>;
}
