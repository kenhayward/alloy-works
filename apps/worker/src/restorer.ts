import { setTimeout as wait } from 'node:timers/promises';
import { createJobQueue, createRestorerDatabase, createTenantDatabase } from '@alloy-works/db';
import { createObjectStores } from '@alloy-works/objects';
import { pino } from 'pino';
import { loadWorkerConfig } from './config.js';
import { restorationJob } from './jobs/restoration.js';
import { processNext } from './worker.js';

/**
 * **The restorer**: a process of its own, the worker's image with another command, since restoring is
 * the one thing that must get past a tenant's live triggers (the EI plan, S1). Only it holds
 * `RESTORER_DATABASE_URL`, the login that can become a tenant's owner; the worker, which runs Typst
 * over content, does not, and never claims this kind of job.
 */
const config = loadWorkerConfig(process.env);
const restorerUrl = process.env['RESTORER_DATABASE_URL'];
if (!restorerUrl) throw new Error('RESTORER_DATABASE_URL is not set');

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const db = createTenantDatabase(config.databaseUrl);
const restorer = createRestorerDatabase(restorerUrl);
const queue = createJobQueue(config.databaseUrl);
const stores = createObjectStores(config.objectStore, config.objectStoreKey);
const handlers = { restoration: restorationJob({ db, restorer, stores }) };

let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

log.info({ workerId: config.workerId }, 'the restorer is starting');
while (running) {
  const outcome = await processNext({
    queue,
    db,
    handlers,
    workerId: `${config.workerId}-restorer`,
    // A restore holds its job for as long as it takes at any size S2 measured, and then some.
    leaseMs: Math.max(config.leaseMs, 30 * 60_000),
    log,
  }).catch((error: unknown) => {
    log.error({ err: error }, 'the restorer could not take a job');
    return 'idle' as const;
  });
  if (outcome === 'idle' && running) await wait(config.pollIntervalMs);
}
await queue.close();
await restorer.close();
await db.close();
