import { Injectable, Logger } from '@nestjs/common';
import type { PushProvider, PushSendResult } from './push.provider.interface';

/**
 * Provider FCM (Firebase Cloud Messaging)
 * Utilise l'API HTTP v1 de Firebase via fetch (pas de SDK nécessaire).
 * Variables d'env requises :
 *   FCM_PROJECT_ID    – ID du projet Firebase
 *   FCM_SERVICE_ACCOUNT_KEY – JSON stringify de la clé de service compte Firebase
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);
  private readonly projectId: string;
  private readonly fcmUrl: string;

  constructor() {
    this.projectId = process.env.FCM_PROJECT_ID || '';
    this.fcmUrl = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
  }

  private async getAccessToken(): Promise<string> {
    // En production: obtenir un token OAuth2 depuis la clé de service Firebase
    // Pour le moment on utilise la clé serveur legacy (FCM_SERVER_KEY)
    const serverKey = process.env.FCM_SERVER_KEY || '';
    if (!serverKey) throw new Error('FCM_SERVER_KEY non configuré');
    return serverKey;
  }

  async send(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushSendResult> {
    try {
      const token = await this.getAccessToken();
      const payload = {
        message: {
          token: deviceToken,
          notification: { title, body },
          data: data || {},
        },
      };

      const response = await fetch(this.fcmUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FCM HTTP ${response.status}: ${errorText}`);
      }

      const result = (await response.json()) as { name?: string };
      this.logger.log(`Push FCM envoyé: ${result.name}`);
      return { success: true, messageId: result.name };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`FCM push failed to ${deviceToken}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  async sendBatch(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number }> {
    const results = await Promise.allSettled(
      tokens.map((token) => this.send(token, title, body, data)),
    );
    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;
    return { successCount, failureCount: tokens.length - successCount };
  }
}
