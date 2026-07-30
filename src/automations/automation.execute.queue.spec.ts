const { AutomationExecutionProcessor } = require('./automation.execute.queue');

const JOB_DATA = {
  automationId: 'auto-1',
  executionId: 'exec-1',
  contactId: 'c-1',
};

function makeJob(data: unknown, attemptsMade?: number, maxAttempts?: number) {
  return {
    data,
    opts: { attempts: maxAttempts === undefined ? 3 : maxAttempts },
    attemptsMade: attemptsMade === undefined ? 0 : attemptsMade,
  };
}

describe('AutomationExecutionProcessor — worker BullMQ', () => {
  let processor;
  let svc;

  beforeEach(() => {
    svc = {
      executeQueuedAutomation: jest.fn().mockResolvedValue({ success: true }),
      markExecutionFailed: jest.fn().mockResolvedValue(undefined),
    };
    processor = new AutomationExecutionProcessor(svc);
  });

  it('appelle executeQueuedAutomation avec les donnees du job', async () => {
    await processor.process(makeJob(JOB_DATA));
    expect(svc.executeQueuedAutomation).toHaveBeenCalledTimes(1);
    expect(svc.executeQueuedAutomation).toHaveBeenCalledWith(JOB_DATA);
  });

  it('retourne le resultat de executeQueuedAutomation', async () => {
    svc.executeQueuedAutomation.mockResolvedValueOnce({
      success: true,
      channel: 'Email',
    });
    const result = await processor.process(makeJob(JOB_DATA));
    expect(result).toEqual({ success: true, channel: 'Email' });
  });

  it('marque FAILED et re-leve sur la tentative finale (attemptsMade+1 >= attempts)', async () => {
    const err = new Error('provider timeout');
    svc.executeQueuedAutomation.mockRejectedValueOnce(err);
    // attemptsMade=2, attempts=3 → 2+1=3 >= 3 → tentative finale
    const job = makeJob(JOB_DATA, 2, 3);

    await expect(processor.process(job)).rejects.toThrow('provider timeout');

    expect(svc.markExecutionFailed).toHaveBeenCalledTimes(1);
    expect(svc.markExecutionFailed).toHaveBeenCalledWith(
      'exec-1',
      'provider timeout',
    );
  });

  it('NE marque PAS FAILED avant la tentative finale', async () => {
    const err = new Error('provider temporary error');
    svc.executeQueuedAutomation.mockRejectedValueOnce(err);
    // attemptsMade=0, attempts=3 → 0+1=1 < 3 → pas finale
    const job = makeJob(JOB_DATA, 0, 3);

    await expect(processor.process(job)).rejects.toThrow(
      'provider temporary error',
    );

    expect(svc.markExecutionFailed).not.toHaveBeenCalled();
  });

  it('marque FAILED avec message generique quand erreur non-Error', async () => {
    svc.executeQueuedAutomation.mockRejectedValueOnce('string error');
    const job = makeJob(JOB_DATA, 2, 3);

    await expect(processor.process(job)).rejects.toBe('string error');

    expect(svc.markExecutionFailed).toHaveBeenCalledWith(
      'exec-1',
      "Impossible d'exécuter l'automatisation.",
    );
  });

  it('treats opts.attempts=undefined as maxAttempts=1 (single attempt = finale)', async () => {
    const err = new Error('crash');
    svc.executeQueuedAutomation.mockRejectedValueOnce(err);
    // opts.attempts undefined → maxAttempts=1, attemptsMade=0 → 0+1 >= 1 → finale
    const job = { data: JOB_DATA, opts: {}, attemptsMade: 0 };

    await expect(processor.process(job)).rejects.toThrow('crash');
    expect(svc.markExecutionFailed).toHaveBeenCalledTimes(1);
  });
});
