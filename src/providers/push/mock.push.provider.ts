import { Injectable, Logger } from '@nestjs/common';
import type { PushProvider, PushSendResult } from './push.provider.interface';

/**
 * Provider mock pour tests et environnements sans Firebase
 */
@Injectable()
export class MockPushProvider implements PushProvider {
  private readonly logger = new Logger(MockPushProvider.name);

  async send(
    deviceToken: string,
    title: string,
    body: string,
    _data?: Record<string, string>,
  ): Promise<PushSendResult> {
    this.logger.log(
      `[MOCK] Push envoyé → token=${deviceToken} title="${title}" body="${body}"`,
    );
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  async sendBatch(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number }> {
    await Promise.all(tokens.map((t) => this.send(t, title, body, data)));
    return { successCount: tokens.length, failureCount: 0 };
  }
}
