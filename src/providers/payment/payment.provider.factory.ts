import { Injectable, Logger } from '@nestjs/common';
import { MobileMoneyProvider } from './interfaces/mobile-money.provider.interface';
import { VisaProvider } from './interfaces/visa.provider.interface';
import { SimulationMobileMoneyProvider } from './implementations/mobile-money/simulation.mobile-money.provider';
import { NovaSendMobileMoneyProvider } from './implementations/mobile-money/novasend-mobile-money.provider';
import { SimulationVisaProvider } from './implementations/visa/simulation.visa.provider';
import { StripeVisaProvider } from './implementations/visa/stripe.visa.provider';

type MobileMoneyProviderName = 'novasend' | 'simulation';
type VisaProviderName = 'stripe' | 'simulation';

/**
 * Factory paiement basée sur MOBILE_MONEY_PROVIDER et VISA_PROVIDER.
 * Staging : simulation (defaut). Production : novasend / stripe.
 * STAGING ET PRODUCTION = EXACTEMENT LE MEME CODE — seul .env differe.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);

  // Singletons pour que la Map en mémoire (simulation) survive entre les appels
  private readonly _simulationMM = new SimulationMobileMoneyProvider();
  private readonly _simulationVisa = new SimulationVisaProvider();
  private _novasendMM: NovaSendMobileMoneyProvider | null = null;
  private _stripeVisa: StripeVisaProvider | null = null;

  getMobileMoneyProvider(): MobileMoneyProvider {
    const name = (
      process.env.MOBILE_MONEY_PROVIDER || 'simulation'
    ).toLowerCase() as MobileMoneyProviderName;

    if (name === 'novasend') {
      this._novasendMM ??= new NovaSendMobileMoneyProvider();
      return this._novasendMM;
    }
    return this._simulationMM;
  }

  getVisaProvider(): VisaProvider {
    const name = (
      process.env.VISA_PROVIDER || 'simulation'
    ).toLowerCase() as VisaProviderName;

    if (name === 'stripe') {
      this._stripeVisa ??= new StripeVisaProvider();
      return this._stripeVisa;
    }
    return this._simulationVisa;
  }

  getHealthStatus() {
    const mmProvider = (
      process.env.MOBILE_MONEY_PROVIDER || 'simulation'
    ).toLowerCase();
    const visaProvider = (
      process.env.VISA_PROVIDER || 'simulation'
    ).toLowerCase();

    return {
      providerType: 'payment',
      mobileMoney: {
        selected: mmProvider,
        novasendConfigured: Boolean(process.env.NOVASEND_MM_API_KEY),
      },
      visa: {
        selected: visaProvider,
        stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
        stripeSandbox:
          process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ?? false,
      },
    };
  }
}
