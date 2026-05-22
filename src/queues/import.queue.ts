/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ImportService } from '../contacts/import.service';

const connection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  {
    // BullMQ workers require maxRetriesPerRequest to be null for blocking commands.
    maxRetriesPerRequest: null,
  },
);

// Connection lifecycle logging to help debug Redis issues
connection.on('connect', () => console.log('[REDIS] connect'));
connection.on('ready', () => console.log('[REDIS] ready'));
connection.on('error', (err) => console.error('[REDIS] error', err && err.message));
connection.on('close', () => console.log('[REDIS] closed'));
connection.on('reconnecting', () => console.log('[REDIS] reconnecting'));

export const importQueue = new Queue('import-contacts', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 10,
    removeOnFail: 100,
  },
});

// Le worker doit avoir accès à ImportService — à initialiser dans main.ts ou un module dédié
export let importWorker: Worker | null = null;

export function initImportWorker(importService: ImportService) {
  importWorker = new Worker(
    'import-contacts',
    async (job) => {
      const { accountId, fileName, mappedData } = job.data;

      // Délègue le traitement complet au service
      console.log('[IMPORT WORKER] starting job', job.id, 'file:', fileName, 'rows:', (mappedData || []).length);
      return importService.processFullImport(accountId, fileName, mappedData);
    },
    {
      connection,
      concurrency: 2, // Traitement parallèle de 2 imports max pour performance
    },
  );

  console.log('[IMPORT WORKER] initialized for queue import-contacts');

  importWorker.on('active', (job) => {
    try {
      console.log('[IMPORT WORKER] active job', job.id, 'name', job.name, 'dataKeys', Object.keys(job.data || {}));
    } catch (e) {
      console.log('[IMPORT WORKER] active job (error logging job data)');
    }
  });

  importWorker.on('error', (err) => {
    console.error('[IMPORT WORKER] error', err && err.stack ? err.stack : err);
  });

  importWorker.on('completed', (job) => {
    console.log(`✅ Import job ${job.id} completed`);
  });

  importWorker.on('failed', (job, err) => {
    console.error(`❌ Import job ${job?.id} failed:`, err.message);
  });

  return importWorker;
}

// Graceful shutdown
process.on('SIGINT', () => {
  void (async () => {
    if (importWorker) await importWorker.close();
    await importQueue.close();
  })();
});

// Exporter la connexion Redis pour réutilisation (cache preview, etc.)
export const redisConnection = connection;
