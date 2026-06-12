import { PaymentProviderFactory } from './payment.provider.factory';
import { SimulationMobileMoneyProvider } from './implementations/mobile-money/simulation.mobile-money.provider';
import { SimulationVisaProvider } from './implementations/visa/simulation.visa.provider';

describe("PaymentProviderFactory — routage par variable d'environnement", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest
      .spyOn(
        require('./implementations/mobile-money/novasend-mobile-money.provider'),
        'NovaSendMobileMoneyProvider',
      )
      .mockImplementation(function () {
        return {};
      });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── getMobileMoneyProvider ─────────────────────────────────────────────────

  it('retourne SimulationMobileMoneyProvider quand MOBILE_MONEY_PROVIDER est absent', () => {
    delete process.env.MOBILE_MONEY_PROVIDER;
    const factory = new PaymentProviderFactory();

    const provider = factory.getMobileMoneyProvider();

    expect(provider).toBeInstanceOf(SimulationMobileMoneyProvider);
  });

  it('retourne SimulationMobileMoneyProvider quand MOBILE_MONEY_PROVIDER=simulation', () => {
    process.env.MOBILE_MONEY_PROVIDER = 'simulation';
    const factory = new PaymentProviderFactory();

    const provider = factory.getMobileMoneyProvider();

    expect(provider).toBeInstanceOf(SimulationMobileMoneyProvider);
  });

  it('simulation mobile money: initiatePayment() fonctionne sans appel reseau', async () => {
    delete process.env.MOBILE_MONEY_PROVIDER;
    const factory = new PaymentProviderFactory();
    const provider = factory.getMobileMoneyProvider();

    const result = await provider.initiatePayment({
      operator: 'WAVE',
      phoneNumber: '+22507000001',
      amount: 5000,
      currency: 'XOF',
      accountId: 'acc-test',
      userId: 'usr-test',
    });

    expect(result.success).toBe(true);
    expect(result.transactionId).toMatch(/^sim-mm-/);
  });

  // ── getVisaProvider ────────────────────────────────────────────────────────

  it('retourne SimulationVisaProvider quand VISA_PROVIDER est absent', () => {
    delete process.env.VISA_PROVIDER;
    const factory = new PaymentProviderFactory();

    const provider = factory.getVisaProvider();

    expect(provider).toBeInstanceOf(SimulationVisaProvider);
  });

  it('retourne SimulationVisaProvider quand VISA_PROVIDER=simulation', () => {
    process.env.VISA_PROVIDER = 'simulation';
    const factory = new PaymentProviderFactory();

    const provider = factory.getVisaProvider();

    expect(provider).toBeInstanceOf(SimulationVisaProvider);
  });

  it('simulation visa: charge() fonctionne sans cle Stripe', async () => {
    delete process.env.VISA_PROVIDER;
    const factory = new PaymentProviderFactory();
    const provider = factory.getVisaProvider();

    const result = await provider.charge({ amount: 10000, currency: 'eur' });

    expect(result.success).toBe(true);
    expect(result.transactionId).toMatch(/^sim-visa-/);
    expect(result.status).toBe('succeeded');
  });

  it('SimulationVisaProvider.isConfigured() retourne true sans aucune cle', () => {
    delete process.env.VISA_PROVIDER;
    delete process.env.STRIPE_SECRET_KEY;
    const factory = new PaymentProviderFactory();

    const provider = factory.getVisaProvider();

    expect(provider.isConfigured()).toBe(true);
  });

  // ── getHealthStatus ────────────────────────────────────────────────────────

  it('getHealthStatus() retourne simulation par defaut pour les deux providers', () => {
    delete process.env.MOBILE_MONEY_PROVIDER;
    delete process.env.VISA_PROVIDER;
    const factory = new PaymentProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.mobileMoney.selected).toBe('simulation');
    expect(health.visa.selected).toBe('simulation');
  });

  it('getHealthStatus() detecte stripe quand VISA_PROVIDER=stripe', () => {
    process.env.VISA_PROVIDER = 'stripe';
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    const factory = new PaymentProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.visa.selected).toBe('stripe');
    expect(health.visa.stripeConfigured).toBe(true);
    expect(health.visa.stripeSandbox).toBe(true);
  });

  it('getHealthStatus() detecte novasend quand MOBILE_MONEY_PROVIDER=novasend', () => {
    process.env.MOBILE_MONEY_PROVIDER = 'novasend';
    process.env.NOVASEND_MM_API_KEY = 'key-test';
    const factory = new PaymentProviderFactory();

    const health = factory.getHealthStatus();

    expect(health.mobileMoney.selected).toBe('novasend');
    expect(health.mobileMoney.novasendConfigured).toBe(true);
  });
});
