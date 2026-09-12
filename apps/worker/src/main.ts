// The process: read the configuration, wait for work, and stop cleanly. Everything it decides lives
// in modules with tests of their own; this file only wires them and loops.
import { createJobQueue, createTenantDatabase, JOB_CHANNEL } from '@alloy-works/db';
import { createObjectStores } from '@alloy-works/objects';
import pg from 'pg';
import pino from 'pino';
import { describeWorkerConfig, loadWorkerConfig } from './config.js';
import { sampleJob } from './jobs/sample.js';
import { sweepExpiredSignIns } from './sweep.js';
import { createTypst } from './typst.js';
import { processNext, type JobHandler } from './worker.js';

const config = loadWorkerConfig(process.env);
const log = pino({ level: config.logLevel });
const db = createTenantDatabase(config.databaseUrl);
const queue = createJobQueue(config.databaseUrl);
const stores = createObjectStores(config.objectStore, config.objectStoreKey);
const typst = createTypst({ binary: config.typstBinary });
const handlers: Record<string, JobHandler> = { sample_pdf: sampleJob({ db, stores, typst }) };

// A connection of its own, held open: NOTIFY wakes the worker between polls.
const listener = new pg.Client({ connectionString: config.databaseUrl });
await listener.connect();
await listener.query(`listen ${JOB_CHANNEL}`);
let wake: () => void = () => {};
listener.on('notification', () => wake());

let running = true;
const sweep = setInterval(() => {
  void sweepExpiredSignIns(db)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired sign-ins'))
    .catch((error: unknown) => log.error({ err: error }, 'sweep failed'));
}, config.sweepIntervalMs);

const stop = async (signal: string) => {
  running = false;
  wake();
  clearInterval(sweep);
  log.info({ signal }, 'stopping');
  await listener.end();
  await queue.close();
  await db.close();
};
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

log.info({ config: describeWorkerConfig(config), typst: await typst.version() }, 'starting');
while (running) {
  const outcome = await processNext({
    queue,
    db,
    handlers,
    workerId: config.workerId,
    leaseMs: config.leaseMs,
    log,
  }).catch((error: unknown) => {
    log.error({ err: error }, 'the worker could not take a job');
    return 'idle' as const;
  });
  if (outcome === 'idle' && running) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.pollIntervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
