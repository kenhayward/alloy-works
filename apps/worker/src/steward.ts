import { setTimeout as wait } from 'node:timers/promises';
import { createJobQueue, createStewardDatabase } from '@alloy-works/db';
import { storeForPurging } from '@alloy-works/objects';
import { pino } from 'pino';
import { processNextPurge, sweepStuckPurges } from './jobs/tenant-purge.js';
import { loadStewardConfig } from './steward-config.js';

/**
 * **The steward**: a process of its own, the worker's image with another command (ADR-0083). Only it
 * holds what can drop a tenant's roles and the store's administrative credential; it parses no archive
 * and renders no content. It claims `tenant_purge` alone.
 */
const config = loadStewardConfig(process.env);
const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const steward = createStewardDatabase(config.databaseUrl);
const queue = createJobQueue(config.databaseUrl);
const store = storeForPurging(config.objectStore, config.objectStoreAdmin);

const LEASE_MS = 30 * 60_000;
const POLL_MS = 30_000;
const SWEEP_MS = 5 * 60_000;

let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

log.info('the steward is starting');
let swept = 0;
while (running) {
  if (Date.now() - swept >= SWEEP_MS) {
    swept = Date.now();
    await sweepStuckPurges({ steward, log }).catch((error: unknown) =>
      log.error({ err: error }, 'the sweep of stuck purges failed'),
    );
  }
  const outcome = await processNextPurge({
    queue,
    steward,
    store,
    workerId: `steward-${process.pid}`,
    leaseMs: LEASE_MS,
    log,
  }).catch((error: unknown) => {
    log.error({ err: error }, 'the steward could not take a job');
    return 'idle' as const;
  });
  if ((outcome === 'idle' || outcome === 'waiting') && running) await wait(POLL_MS);
}
await queue.close();
await steward.close();
