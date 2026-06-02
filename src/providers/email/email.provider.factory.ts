import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider } from './email.provider.interface';
import { ResendProvider } from './resend.provider';
import { BrevoProvider } from './brevo.provider';
import { MockEmailProvider } from './mock.provider';

type EmailProviderName = 'resend' | 'brevo' | 'mock';

type EmailProviderOverrides = Partial<Record<EmailProviderName, EmailProvider>>;

class FailoverEmailProvider implements EmailProvider {
  constructor(
    private readonly primary: EmailProvider,
    private readonly secondary: EmailProvider,
    private readonly logger: Logger,
    private readonly primaryName: EmailProviderName,
    private readonly secondaryName: EmailProviderName,
  ) {}

  async send(to: string, subject: string, html: string) {
    try {
      const primaryResult = await this.primary.send(to, subject, html);
      if (primaryResult.success) return primaryResult;

      this.logger.warn(
        `Primary email provider (${this.primaryName}) failed, fallback to ${this.secondaryName}`,
      );
      return this.secondary.send(to, subject, html);
    } catch (error) {
      this.logger.warn(
        `Primary email provider (${this.primaryName}) threw an error, fallback to ${this.secondaryName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.secondary.send(to, subject, html);
    }
  }

  async sendBatch(
    contacts: { email: string }[],
    subject: string,
    html: string,
  ) {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const result = await this.send(contact.email, subject, html);
      if (result.success) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}

class SingleEmailProvider implements EmailProvider {
  constructor(private readonly primary: EmailProvider) {}

  async send(to: string, subject: string, html: string) {
    return this.primary.send(to, subject, html);
  }

  async sendBatch(
    contacts: { email: string }[],
    subject: string,
    html: string,
  ) {
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const result = await this.send(contact.email, subject, html);
      if (result.success) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}

/**
 * Factory email basee sur EMAIL_PROVIDER.
 * Valeur par defaut: resend.
 */
@Injectable()
export class EmailProviderFactory {
  private readonly logger = new Logger(EmailProviderFactory.name);

  private isProviderConfigured(name: EmailProviderName): boolean {
    if (name === 'resend') {
      return Boolean(process.env.RESEND_API_KEY);
    }
    return Boolean(process.env.BREVO_API_KEY);
  }

  private resolveProviderOrder(): {
    primary: EmailProviderName;
    secondary: EmailProviderName;
  } {
    const selected = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();

    if (selected === 'mock') {
      return { primary: 'mock', secondary: 'mock' };
    }

    if (selected === 'brevo') {
      return { primary: 'brevo', secondary: 'resend' };
    }

    return { primary: 'resend', secondary: 'brevo' };
  }

  private buildProvider(
    name: EmailProviderName,
    overrides?: EmailProviderOverrides,
  ): EmailProvider {
    if (overrides?.[name]) return overrides[name];

    if (name === 'mock') return new MockEmailProvider();
    if (name === 'brevo') return new BrevoProvider();
    return new ResendProvider();
  }

  getProvider(overrides?: EmailProviderOverrides): EmailProvider {
    const { primary, secondary } = this.resolveProviderOrder();
    const primaryConfigured = this.isProviderConfigured(primary);
    const secondaryConfigured = this.isProviderConfigured(secondary);
    const hasOverrides = Boolean(
      overrides && (overrides[primary] || overrides[secondary]),
    );

    this.logger.log(
      `Email providers configured: primary=${primary}, secondary=${secondary}`,
    );

    if (primary === 'mock') {
      this.logger.warn('EMAIL_PROVIDER=mock, using local mock provider');
      return new MockEmailProvider();
    }
    // If no provider credentials are configured and no overrides provided, use mock.
    if (!primaryConfigured && !secondaryConfigured && !hasOverrides) {
      this.logger.warn(
        'No email provider credentials configured, using local mock provider',
      );
      return new MockEmailProvider();
    }

    const primaryProvider = this.buildProvider(primary, overrides);

    // If secondary not configured but an override exists for it, treat as configured.
    const effectiveSecondaryConfigured =
      secondaryConfigured || Boolean(overrides && overrides[secondary]);

    if (!effectiveSecondaryConfigured) {
      this.logger.warn(
        `Secondary email provider (${secondary}) not configured, fallback disabled`,
      );
      return new SingleEmailProvider(primaryProvider);
    }

    return new FailoverEmailProvider(
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
      providerType: 'email',
      primary,
      secondary,
      config: {
        resendApiKeyConfigured: Boolean(process.env.RESEND_API_KEY),
        brevoApiKeyConfigured: Boolean(process.env.BREVO_API_KEY),
        emailProviderMock: primary === 'mock',
        fallbackEnabled: this.isProviderConfigured(secondary),
      },
    };
  }
}
