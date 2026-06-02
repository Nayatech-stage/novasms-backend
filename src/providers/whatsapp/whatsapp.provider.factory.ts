import { Injectable, Logger } from '@nestjs/common';
import { WhatsappProvider } from './whatsapp.provider.interface';
import { MockWhatsappProvider } from './mock.whatsapp.provider';
import { TwilioWhatsappProvider } from './twilio.whatsapp.provider';

type WhatsappProviderName = 'mock';

@Injectable()
export class WhatsappProviderFactory {
  private readonly logger = new Logger(WhatsappProviderFactory.name);

  getProvider(): WhatsappProvider {
    const selected = (process.env.WHATSAPP_PROVIDER || 'mock').toLowerCase();
    if (selected === 'twilio') {
      // ensure credentials exist
      if (
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_WHATSAPP_NUMBER
      ) {
        return new TwilioWhatsappProvider();
      }
      this.logger.warn('TWILIO config missing, falling back to mock WhatsApp');
    }

    this.logger.warn('Using MockWhatsappProvider');
    return new MockWhatsappProvider();
  }

  getHealthStatus() {
    return {
      providerType: 'whatsapp',
      provider: process.env.WHATSAPP_PROVIDER || 'mock',
    };
  }
}
