const { SimulationVisaProvider } = require('./simulation.visa.provider');

describe('SimulationVisaProvider — Visa simulation, aucun appel Stripe', () => {
  let provider;

  beforeEach(() => {
    provider = new SimulationVisaProvider();
  });

  it('charge() retourne success=true avec status=succeeded', async () => {
    const result = await provider.charge({
      amount: 10000,
      currency: 'eur',
      description: 'Recharge NovaSMS',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('succeeded');
    expect(result.transactionId).toMatch(/^sim-visa-/);
  });

  it('transactionId est unique pour chaque charge', async () => {
    const r1 = await provider.charge({ amount: 5000 });
    const r2 = await provider.charge({ amount: 25000 });

    expect(r1.transactionId).not.toBe(r2.transactionId);
  });

  it('fonctionne sans currency ni description (parametres optionnels)', async () => {
    const result = await provider.charge({ amount: 10000 });

    expect(result.success).toBe(true);
  });

  it('getPaymentIntent() retourne toujours succeeded pour simulation', async () => {
    const intent = await provider.getPaymentIntent('sim-visa-abc123');

    expect(intent).not.toBeNull();
    expect(intent.id).toBe('sim-visa-abc123');
    expect(intent.status).toBe('succeeded');
  });

  it('isConfigured() retourne toujours true (simulation sans cle)', () => {
    expect(provider.isConfigured()).toBe(true);
  });
});
