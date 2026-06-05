import { Injectable } from '@nestjs/common';
import { FcmPushProvider } from './fcm.push.provider';
import { MockPushProvider } from './mock.push.provider';
import type { PushProvider } from './push.provider.interface';

/**
 * Factory de provider Push.
 * Contrôlé par PUSH_PROVIDER=fcm|mock (défaut: mock).
 */
@Injectable()
export class PushProviderFactory {
  private readonly provider: PushProvider;

  constructor() {
    const providerType = process.env.PUSH_PROVIDER || 'mock';
    switch (providerType) {
      case 'fcm':
        this.provider = new FcmPushProvider();
        break;
      default:
        this.provider = new MockPushProvider();
    }
  }

  getProvider(): PushProvider {
    return this.provider;
  }
}
