import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider.interface';
import { TwilioProvider } from './twilio.provider';
import { AfricasTalkingProvider } from './africastalking.provider';
import { SimulationSmsProvider } from './implementations/simulation.provider';
import { NovaSendSmsProvider } from './implementations/novasend.provider';

type SmsProviderName = 'twilio' | 'africastalking' | 'simulation' | 'novasend';

type SmsProviderOverrides = Partial<Record<SmsProviderName, SmsProvider>>;

class FailoverSmsProvider implements SmsProvider {
  constructor(
    private readonly primary: SmsProvider,
    private readonly secondary: SmsProvider,
    private readonly logger: Logger,
    private readonly primaryName: SmsProviderName,
    private readonly secondaryName: SmsProviderName,
  ) {}

  async send(to: string, message: string) {
    try {
      const primaryResult = await this.primary.send(to, message);
      if (primaryResult.success) return primaryResult;

      this.logger.warn(
        `Primary SMS provider (${this.primaryName}) failed, fallback to ${this.secondaryName}`,
      );
      return this.secondary.send(to, message);
    } catch (error) {
      this.logger.warn(
        `Primary SMS provider (${this.primaryName}) threw an error, fallback to ${this.secondaryName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.secondary.send(to, message);
    }
  }

  async sendBatch(contacts: { phone: string }[], message: string) {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const result = await this.send(contact.phone, message);
      if (result.success) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}

class SingleSmsProvider implements SmsProvider {
  constructor(private readonly primary: SmsProvider) {}

  async send(to: string, message: string) {
    return this.primary.send(to, message);
  }

  async sendBatch(contacts: { phone: string }[], message: string) {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const result = await this.send(contact.phone, message);
      if (result.success) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}

/**
 * Factory SMS basee sur SMS_PROVIDER.
 * Valeur par defaut: twilio.
 */
@Injectable()
export class SmsProviderFactory {
  private readonly logger = new Logger(SmsProviderFactory.name);

  private isRealProviderConfigured(name: SmsProviderName): boolean {
    if (name === 'twilio') {
      return (
        Boolean(process.env.TWILIO_ACCOUNT_SID) &&
        Boolean(process.env.TWILIO_AUTH_TOKEN) &&
        Boolean(process.env.TWILIO_PHONE_NUMBER)
      );
    }
    if (name === 'africastalking') {
      return (
        Boolean(process.env.AFRICASTALKING_API_KEY) &&
        Boolean(process.env.AFRICASTALKING_USERNAME) &&
        Boolean(process.env.AFRICASTALKING_SENDER_ID)
      );
    }
    if (name === 'novasend') {
      return (
        Boolean(process.env.NOVASEND_SMS_API_KEY) &&
        Boolean(process.env.NOVASEND_SMS_SENDER_ID)
      );
    }
    // simulation is always "configured"
    return true;
  }

  private resolveProviderOrder(): {
    primary: SmsProviderName;
    secondary: SmsProviderName | null;
  } {
    const selected = (
      process.env.SMS_PROVIDER || 'simulation'
    ).toLowerCase() as SmsProviderName;

    // Standalone providers — pas de failover
    if (selected === 'simulation' || selected === 'novasend') {
      return { primary: selected, secondary: null };
    }

    if (selected === 'africastalking') {
      return { primary: 'africastalking', secondary: 'twilio' };
    }

    return { primary: 'twilio', secondary: 'africastalking' };
  }

  private buildProvider(
    name: SmsProviderName,
    overrides?: SmsProviderOverrides,
  ): SmsProvider {
    if (overrides?.[name]) return overrides[name];

    if (name === 'simulation') return new SimulationSmsProvider();
    if (name === 'novasend') return new NovaSendSmsProvider();
    if (name === 'africastalking') return new AfricasTalkingProvider();
    return new TwilioProvider();
  }

  getProvider(overrides?: SmsProviderOverrides): SmsProvider {
    const { primary, secondary } = this.resolveProviderOrder();
    this.logger.log(
      `SMS provider: primary=${primary}${secondary ? `, secondary=${secondary}` : ' (no fallback)'}`,
    );

    const primaryProvider = this.buildProvider(primary, overrides);

    if (!secondary) {
      return new SingleSmsProvider(primaryProvider);
    }

    const secondaryConfigured =
      this.isRealProviderConfigured(secondary) ||
      Boolean(overrides && overrides[secondary]);

    if (!secondaryConfigured) {
      this.logger.warn(
        `Secondary SMS provider (${secondary}) not configured, fallback disabled`,
      );
      return new SingleSmsProvider(primaryProvider);
    }

    return new FailoverSmsProvider(
      primaryProvider,
      this.buildProvider(secondary, overrides),
      this.logger,
      primary,
      secondary,
    );
  }

  getHealthStatus() {
    const { primary, secondary } = this.resolveProviderOrder();

    return {
      providerType: 'sms',
      primary,
      secondary: secondary ?? null,
      config: {
        simulationActive: primary === 'simulation',
        twilioConfigured:
          Boolean(process.env.TWILIO_ACCOUNT_SID) &&
          Boolean(process.env.TWILIO_AUTH_TOKEN) &&
          Boolean(process.env.TWILIO_PHONE_NUMBER),
        africastalkingConfigured:
          Boolean(process.env.AFRICASTALKING_API_KEY) &&
          Boolean(process.env.AFRICASTALKING_USERNAME) &&
          Boolean(process.env.AFRICASTALKING_SENDER_ID),
        novasendConfigured:
          Boolean(process.env.NOVASEND_SMS_API_KEY) &&
          Boolean(process.env.NOVASEND_SMS_SENDER_ID),
        fallbackEnabled: secondary
          ? this.isRealProviderConfigured(secondary)
          : false,
      },
    };
  }
}
