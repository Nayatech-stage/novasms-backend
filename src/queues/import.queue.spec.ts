import type { ImportService } from '../contacts/import.service';

type Handler = (...args: unknown[]) => void;

class FakeRedis {
  static instances: FakeRedis[] = [];
  handlers: Record<string, Handler[]> = {};
  constructor(
    public url: string,
    public opts: Record<string, unknown>,
  ) {
    FakeRedis.instances.push(this);
  }
  on(event: string, cb: Handler) {
    (this.handlers[event] ||= []).push(cb);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    (this.handlers[event] || []).forEach((cb) => cb(...args));
  }
  disconnect() {}
  quit() {
    return Promise.resolve('OK');
  }
}

class FakeQueue {
  static instances: FakeQueue[] = [];
  add = jest.fn();
  close = jest.fn();
  getJob = jest.fn();
  constructor(
    public name: string,
    public opts: Record<string, unknown>,
  ) {
    FakeQueue.instances.push(this);
  }
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  handlers: Record<string, Handler> = {};
  close = jest.fn().mockResolvedValue(undefined);
  constructor(
    public name: string,
    public processor: (job: unknown) => Promise<unknown>,
    public opts: Record<string, unknown>,
  ) {
    FakeWorker.instances.push(this);
  }
  on(event: string, cb: Handler) {
    this.handlers[event] = cb;
    return this;
  }
}

function makeImportService() {
  return {
    processFullImport: jest.fn().mockResolvedValue({ imported: 2 }),
  } as unknown as ImportService & { processFullImport: jest.Mock };
}

function loadProdModule() {
  let mod!: typeof import('./import.queue');
  const sigintBefore = process.listeners('SIGINT');
  const savedWorkerId = process.env.JEST_WORKER_ID;
  const savedNodeEnv = process.env.NODE_ENV;

  jest.isolateModules(() => {
    jest.doMock('ioredis', () => ({ __esModule: true, default: FakeRedis }));
    jest.doMock('bullmq', () => ({ Queue: FakeQueue, Worker: FakeWorker }));
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'production';
    mod = require('./import.queue') as typeof import('./import.queue');
  });

  process.env.JEST_WORKER_ID = savedWorkerId;
  process.env.NODE_ENV = savedNodeEnv;
  const sigintHandlers = process
    .listeners('SIGINT')
    .filter((l) => !sigintBefore.includes(l));
  const cleanup = () =>
    sigintHandlers.forEach((l) => process.removeListener('SIGINT', l));
  return { mod, sigintHandlers, cleanup };
}

describe('import.queue – branche production (Redis/BullMQ mockés)', () => {
  let loaded: ReturnType<typeof loadProdModule>;

  beforeEach(() => {
    FakeRedis.instances = [];
    FakeQueue.instances = [];
    FakeWorker.instances = [];
    loaded = loadProdModule();
  });

  afterEach(() => {
    loaded.cleanup();
    jest.resetModules();
    jest.dontMock('ioredis');
    jest.dontMock('bullmq');
  });

  it('crée la connexion Redis avec maxRetriesPerRequest null et log les événements', () => {
    expect(FakeRedis.instances).toHaveLength(1);
    const redis = FakeRedis.instances[0];
    expect(redis.opts).toEqual({ maxRetriesPerRequest: null });
    // Exécute les handlers de cycle de vie pour couvrir les lignes de log
    redis.emit('connect');
    redis.emit('ready');
    redis.emit('error', new Error('boom'));
    redis.emit('close');
    redis.emit('reconnecting');
  });

  it('crée la queue import-contacts avec retry exponentiel', () => {
    expect(FakeQueue.instances).toHaveLength(1);
    const queue = FakeQueue.instances[0];
    expect(queue.name).toBe('import-contacts');
    expect(queue.opts.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  });

  it('initImportWorker crée un worker concurrency=2 qui délègue à ImportService', async () => {
    const svc = makeImportService();
    const worker = loaded.mod.initImportWorker(svc);
    expect(worker).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
    const fake = FakeWorker.instances[0];
    expect(fake.name).toBe('import-contacts');
    expect(fake.opts).toMatchObject({ concurrency: 2 });

    const result = await fake.processor({
      id: 'job-1',
      data: {
        accountId: 'acc-1',
        fileName: 'contacts.csv',
        mappedData: [{ telephone: '+2250700000001' }],
      },
    });
    expect(result).toEqual({ imported: 2 });
    expect(svc.processFullImport).toHaveBeenCalledWith(
      'acc-1',
      'contacts.csv',
      [{ telephone: '+2250700000001' }],
    );
  });

  it('les handlers d’événements du worker ne lèvent pas', () => {
    loaded.mod.initImportWorker(makeImportService());
    const fake = FakeWorker.instances[0];

    fake.handlers['active']({ id: 'j-1', name: 'import', data: { a: 1 } });
    // Couvre la branche catch du handler active (accès à job.data qui lève)
    const throwingJob = {
      id: 'j-2',
      name: 'import',
      get data(): never {
        throw new Error('inaccessible');
      },
    };
    expect(() => fake.handlers['active'](throwingJob)).not.toThrow();

    fake.handlers['error'](new Error('worker error'));
    fake.handlers['error']('erreur brute');
    fake.handlers['completed']({ id: 'j-1' });
    fake.handlers['failed']({ id: 'j-1' }, new Error('échec'));
    fake.handlers['failed'](undefined, new Error('échec sans job'));
  });

  it('le handler SIGINT ferme worker et queue', async () => {
    loaded.mod.initImportWorker(makeImportService());
    expect(loaded.sigintHandlers.length).toBeGreaterThan(0);
    for (const h of loaded.sigintHandlers) {
      (h as () => void)();
    }
    // Laisse la promesse interne se résoudre
    await new Promise((r) => setImmediate(r));
    expect(FakeWorker.instances[0].close).toHaveBeenCalled();
    expect(FakeQueue.instances[0].close).toHaveBeenCalled();
  });
});

describe('import.queue – branche test (stubs)', () => {
  it('expose des stubs Redis/queue inoffensifs', async () => {
    const mod = await import('./import.queue');
    await expect(mod.redisConnection.get('k')).resolves.toBeNull();
    await expect(mod.redisConnection.set('k', 'v')).resolves.toBe('OK');
    await expect(mod.redisConnection.del('k')).resolves.toBe(0);
    await expect(mod.redisConnection.quit()).resolves.toBe('OK');
    expect(() => mod.redisConnection.disconnect()).not.toThrow();
    mod.redisConnection.on('error', () => {});
    await expect(
      (mod.importQueue as { close: () => Promise<unknown> }).close(),
    ).resolves.toBeUndefined();
    await expect(
      (mod.importQueue as { getJob: (id: string) => Promise<unknown> }).getJob(
        'j-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('initImportWorker en mode test exécute l’import immédiatement via add', async () => {
    const mod = await import('./import.queue');
    const svc = makeImportService();
    const worker = mod.initImportWorker(svc);
    expect(worker).toBeNull();

    await (
      mod.importQueue.add as unknown as (
        name: string,
        data: unknown,
      ) => Promise<unknown>
    )('import-contacts', {
      accountId: 'acc-1',
      fileName: 'f.csv',
      mappedData: [{ telephone: '+2250700000001' }],
    });
    expect(svc.processFullImport).toHaveBeenCalledWith('acc-1', 'f.csv', [
      { telephone: '+2250700000001' },
    ]);
  });
});
