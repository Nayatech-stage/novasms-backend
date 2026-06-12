const {
  SimulationMobileMoneyProvider,
} = require('./simulation.mobile-money.provider');

const BASE_PARAMS = {
  operator: 'WAVE',
  phoneNumber: '+22507000001',
  amount: 10000,
  currency: 'XOF',
  accountId: 'acc-1',
  userId: 'usr-1',
};

describe('SimulationMobileMoneyProvider — Mobile Money simulation', () => {
  let provider;
  let logSpy;

  beforeEach(() => {
    provider = new SimulationMobileMoneyProvider();
    logSpy = jest.spyOn(provider['logger'], 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── initiatePayment ────────────────────────────────────────────────────────

  it('initiatePayment() retourne success=true avec status=pending', async () => {
    const result = await provider.initiatePayment(BASE_PARAMS);

    expect(result.success).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.transactionId).toMatch(/^sim-mm-/);
  });

  it('log visible lors de initiatePayment()', async () => {
    await provider.initiatePayment(BASE_PARAMS);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MOBILE MONEY SIMULATION]'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('WAVE'));
  });

  it('chaque initiation genere un transactionId unique', async () => {
    const r1 = await provider.initiatePayment(BASE_PARAMS);
    const r2 = await provider.initiatePayment({
      ...BASE_PARAMS,
      operator: 'ORANGE',
    });

    expect(r1.transactionId).not.toBe(r2.transactionId);
  });

  // ── confirmPayment — OTP valide ────────────────────────────────────────────

  it('confirmPayment() avec OTP >= 4 chiffres retourne completed', async () => {
    const initiated = await provider.initiatePayment(BASE_PARAMS);
    const result = await provider.confirmPayment(
      initiated.transactionId,
      '1234',
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.transactionId).toBe(initiated.transactionId);
  });

  it('confirmPayment() accepte OTP a 6 chiffres (mode prod)', async () => {
    const initiated = await provider.initiatePayment(BASE_PARAMS);
    const result = await provider.confirmPayment(
      initiated.transactionId,
      '654321',
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });

  // ── confirmPayment — OTP invalide ─────────────────────────────────────────

  it('confirmPayment() avec OTP < 4 chars retourne failed', async () => {
    const initiated = await provider.initiatePayment(BASE_PARAMS);
    const result = await provider.confirmPayment(initiated.transactionId, '12');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });

  it('confirmPayment() avec OTP vide retourne failed', async () => {
    const initiated = await provider.initiatePayment(BASE_PARAMS);
    const result = await provider.confirmPayment(initiated.transactionId, '');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
  });

  // ── getStatus ──────────────────────────────────────────────────────────────

  it('getStatus() retourne pending apres initiation', async () => {
    const initiated = await provider.initiatePayment(BASE_PARAMS);
    const status = await provider.getStatus(initiated.transactionId);

    expect(status.status).toBe('pending');
  });

  it('getStatus() retourne completed apres confirmation reussie', async () => {
    const initiated = await provider.initiatePayment(BASE_PARAMS);
    await provider.confirmPayment(initiated.transactionId, '1234');
    const status = await provider.getStatus(initiated.transactionId);

    expect(status.status).toBe('completed');
  });

  it('getStatus() pour transaction inconnue retourne failed', async () => {
    const status = await provider.getStatus('sim-mm-inconnu-xyz');

    expect(status.success).toBe(false);
    expect(status.status).toBe('failed');
    expect(status.error).toContain('introuvable');
  });

  // ── operateurs supportes ──────────────────────────────────────────────────

  it('accepte tous les operateurs WAVE, ORANGE, MOMO, MOOV', async () => {
    const operators = ['WAVE', 'ORANGE', 'MOMO', 'MOOV'];

    for (const operator of operators) {
      const result = await provider.initiatePayment({
        ...BASE_PARAMS,
        operator,
      });
      expect(result.success).toBe(true);
    }
  });
});
