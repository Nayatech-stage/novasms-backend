import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ImportService } from '../contacts/import.service';

const logger = new Logger('ImportQueue');

// In test environment we avoid creating real Redis connections and workers
// to prevent open handles and noisy logs during Jest runs.
const isTest =
  process.env.NODE_ENV === 'test' ||
  typeof process.env.JEST_WORKER_ID !== 'undefined';

type ImportJobData = {
  accountId: string;
  fileName: string;
  mappedData: Record<string, unknown>[];
};

type ImportQueueLike = Pick<Queue, 'add' | 'close' | 'getJob'>;

let connection: IORedis | null = null;
export let importQueue: ImportQueueLike;
export let importWorker: Worker | null = null;
type RedisLike = Pick<
  IORedis,
  'on' | 'disconnect' | 'quit' | 'get' | 'set' | 'del'
>;

export let redisConnection: RedisLike;

if (isTest) {
  // Minimal stubs used by tests to allow importing and graceful cleanup.
  redisConnection = {
    on: () => redisConnection,
    disconnect: () => {},
    quit: async () => 'OK',
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
  } as unknown as RedisLike;

  importQueue = {
    add: async () => undefined,
    close: async () => undefined,
    getJob: async () => undefined,
  } as unknown as ImportQueueLike;

  importWorker = null;
} else {
  connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    // BullMQ workers require maxRetriesPerRequest to be null for blocking commands.
    maxRetriesPerRequest: null,
  });

  // Connection lifecycle logging to help debug Redis issues
  connection.on('connect', () => logger.log('[REDIS] connect'));
  connection.on('ready', () => logger.log('[REDIS] ready'));
  connection.on('error', (err) =>
    logger.error(`[REDIS] error ${err && err.message}`),
  );
  connection.on('close', () => logger.log('[REDIS] closed'));
  connection.on('reconnecting', () => logger.log('[REDIS] reconnecting'));

  importQueue = new Queue('import-contacts', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 10,
      removeOnFail: 100,
    },
  });

  redisConnection = connection;
  // Worker initialization is provided via exported function below.
}

// Le worker doit avoir accès à ImportService — à initialiser dans main.ts ou un module dédié
export function initImportWorker(importService: ImportService) {
  if (isTest) {
    // In E2E tests we bypass Redis and execute the queued import immediately
    // so the flow can still validate end-to-end report generation.
    importQueue.add = (async (_name: string, data: ImportJobData) => {
      return importService.processFullImport(
        data.accountId,
        data.fileName,
        data.mappedData,
      );
    }) as unknown as Queue['add'];

    return null;
  }

  if (!connection) {
    throw new Error('Redis connection not initialized for import worker');
  }

  importWorker = new Worker(
    'import-contacts',
    async (job) => {
      const { accountId, fileName, mappedData } = job.data;

      // Délègue le traitement complet au service
      logger.log(
        `[IMPORT WORKER] starting job ${job.id} file: ${fileName} rows: ${(mappedData || []).length}`,
      );
      return importService.processFullImport(accountId, fileName, mappedData);
    },
    {
      connection,
      concurrency: 2, // Traitement parallèle de 2 imports max pour performance
    },
  );

  logger.log('[IMPORT WORKER] initialized for queue import-contacts');

  importWorker.on('active', (job) => {
    try {
      logger.log(
        `[IMPORT WORKER] active job ${job.id} name ${job.name} dataKeys ${Object.keys(job.data || {}).join(',')}`,
      );
    } catch {
      logger.log('[IMPORT WORKER] active job (error logging job data)');
    }
  });

  importWorker.on('error', (err) => {
    logger.error(
      `[IMPORT WORKER] error ${err && err.stack ? err.stack : String(err)}`,
    );
  });

  importWorker.on('completed', (job) => {
    logger.log(`Import job ${job.id} completed`);
  });

  importWorker.on('failed', (job, err) => {
    logger.error(`Import job ${job?.id} failed: ${err.message}`);
  });

  return importWorker;
}
// Graceful shutdown (only in non-test environments)
if (!isTest) {
  process.on('SIGINT', () => {
    void (async () => {
      if (importWorker) await importWorker.close();
      await importQueue.close();
    })();
  });
}
