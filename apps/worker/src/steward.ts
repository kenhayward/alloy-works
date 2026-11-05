import { setTimeout as wait } from 'node:timers/promises';
import {
  createDeliveredStore,
  createJobQueue,
  createStewardDatabase,
  createTenantDatabase,
  createTenantMaker,
  type Tenant,
} from '@alloy-works/db';
import { setUpTenantStore, storeForPurging } from '@alloy-works/objects';
import { pino } from 'pino';
import { processNextProviderCopy, processNextRequest } from './jobs/tenant-create.js';
import { processNextPurge, sweepStuckPurges } from './jobs/tenant-purge.js';
import { loadStewardConfig } from './steward-config.js';

/**
 * **The steward**: a process of its own, the worker's image with another command (ADR-0083). Only it
 * holds what can drop a tenant's roles and the store's administrative credential; it parses no archive
 * and renders no content. It claims `tenant_purge` and `provider_share` alone, and makes what is asked
 * for on `tenant_request`.
 */
const config = loadStewardConfig(process.env);
const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const steward = createStewardDatabase(config.databaseUrl);
const queue = createJobQueue(config.databaseUrl);
const store = storeForPurging(config.objectStore, config.objectStoreAdmin);
const delivered = config.deliveredUrl ? createDeliveredStore(config.deliveredUrl) : undefined;
const tenants = createTenantDatabase(config.databaseUrl);
const maker = createTenantMaker(config.databaseUrl);

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
    ...(delivered ? { delivered } : {}),
    workerId: `steward-${process.pid}`,
    leaseMs: LEASE_MS,
    log,
  }).catch((error: unknown) => {
    log.error({ err: error }, 'the steward could not take a job');
    return 'idle' as const;
  });
  const making = {
    maker,
    db: tenants,
    queue,
    sealingKey: config.sealingKey,
    setUpStore: (tenant: Tenant) =>
      setUpTenantStore({
        settings: config.objectStore,
        admin: config.objectStoreAdmin,
        sealingKey: config.sealingKey,
        adminUrl: config.databaseUrl,
        tenant,
      }),
    workerId: `steward-${process.pid}`,
    leaseMs: LEASE_MS,
    log,
  };
  const made = await processNextRequest(making).catch((error: unknown) => {
    log.error({ err: error }, 'the steward could not take a request');
    return 'idle' as const;
  });
  const copied = await processNextProviderCopy(making).catch((error: unknown) => {
    log.error({ err: error }, 'the steward could not take a copy');
    return 'idle' as const;
  });
  const quiet = outcome === 'idle' || outcome === 'waiting';
  if (quiet && made === 'idle' && copied === 'idle' && running) await wait(POLL_MS);
}
await maker.close();
await tenants.close();
await delivered?.close();
await queue.close();
await steward.close();
