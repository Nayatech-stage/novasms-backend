const { SimulationSmsProvider } = require('./simulation.provider');

describe('SimulationSmsProvider — SMS logs console, aucun envoi reel', () => {
  let provider;
  let logSpy;

  beforeEach(() => {
    provider = new SimulationSmsProvider();
    // Intercepter les logs pour verifier le format [SMS SIMULATION]
    logSpy = jest.spyOn(provider['logger'], 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('retourne success=true avec un messageId prefixe sim-', async () => {
    const result = await provider.send('+22507000001', 'Bienvenue sur NovaSMS');

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^sim-/);
  });

  it('messageId est unique pour chaque envoi', async () => {
    const r1 = await provider.send('+22507000001', 'Msg 1');
    const r2 = await provider.send('+22507000002', 'Msg 2');

    expect(r1.messageId).not.toBe(r2.messageId);
  });

  it('log visible: format [SMS SIMULATION] avec numero et message', async () => {
    await provider.send('+22507000003', 'Promo -20%');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SMS SIMULATION]'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('+22507000003'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Promo -20%'));
  });

  it('sendBatch envoie tous les contacts — sent=n, failed=0', async () => {
    const contacts = [
      { phone: '+22507111111' },
      { phone: '+22507222222' },
      { phone: '+22507333333' },
      { phone: '+22507444444' },
    ];
    const result = await provider.sendBatch(contacts, 'Campagne flash');

    expect(result.sent).toBe(4);
    expect(result.failed).toBe(0);
  });

  it('sendBatch avec liste vide retourne sent=0, failed=0', async () => {
    const result = await provider.sendBatch([], 'Aucun destinataire');

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });
});
