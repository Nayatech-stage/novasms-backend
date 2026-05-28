import { Injectable } from '@nestjs/common';
import { EmailProviderFactory } from './providers/email/email.provider.factory';
import { SmsProviderFactory } from './providers/sms/sms.provider.factory';

@Injectable()
export class AppService {
  constructor(
    private readonly emailProviderFactory: EmailProviderFactory,
    private readonly smsProviderFactory: SmsProviderFactory,
  ) {}

  getHealth(): string {
    return 'NovaSMS API is running';
  }

  getStatus(): object {
    const providers = {
      email: this.emailProviderFactory.getHealthStatus(),
      sms: this.smsProviderFactory.getHealthStatus(),
    };

    return {
      status: 'ok',
      service: 'NovaSMS API',
      timestamp: new Date().toISOString(),
      providers,
    };
  }

  getProvidersHealth(): object {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      providers: {
        email: this.emailProviderFactory.getHealthStatus(),
        sms: this.smsProviderFactory.getHealthStatus(),
      },
    };
  }
}
