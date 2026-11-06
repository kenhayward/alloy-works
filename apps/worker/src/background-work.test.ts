import {
  backgroundWork,
  createTenant,
  migrate,
  prepareDatabase,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inEachTenant, PAUSED } from './background.js';
import { sweepMailEverywhere } from './sweep.js';
import type { WorkerLog } from './worker.js';

const errors: object[] = [];
const log: WorkerLog = {
  info: () => {},
  warn: () => {},
  error: (details) => errors.push(details),
};

describe('background work recorded in each tenant as it runs (the DG plan, DG-G)', () => {
  let db: TestDatabase;
  let worker: TenantDatabase;
  let tenants: Tenant[];
  const recorded = (tenant: Tenant) =>
    worker.withTenant(tenant, (trx) => backgroundWork(trx), { actorKind: 'system' });

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenants = [];
    for (const [name, host] of [
      ['Production', 'acme.alloy.test'],
      ['Development', 'dev.acme.alloy.test'],
    ] as const) {
      tenants.push(
        await createTenant(db.adminUrl, db.migratorUrl, {
          organisation: { id: 'acme', name: 'Acme' },
          tenant: { id: db.newTenantId(), name },
          hostnames: [host],
        }),
      );
    }
    worker = testTenantDatabase(db.workerUrl);
  });

  afterAll(async () => {
    await worker?.close();
    await db?.drop();
  });

  it('records a sweep run in every live tenant', async () => {
    await sweepMailEverywhere(worker, log);
    for (const tenant of tenants) {
      expect(await recorded(tenant)).toEqual([
        expect.objectContaining({ work: 'sweepMailEverywhere', outcome: 'succeeded' }),
      ]);
    }
  });

  it('records one tenant failing by its code, another paused, and goes on to the rest', async () => {
    const [production, development] = tenants as [Tenant, Tenant];
    const done = await inEachTenant(worker, log, 'sweepDates', async (tenant) => {
      if (tenant.id === production.id) {
        throw Object.assign(new Error('Ada Lovelace was not found'), { code: 'not_found' });
      }
      return PAUSED;
    });
    expect(done).toEqual([]);
    expect((await recorded(production)).find((each) => each.work === 'sweepDates')).toMatchObject({
      outcome: 'failed',
      failure: 'not_found',
      failures: 1,
    });
    expect((await recorded(development)).find((each) => each.work === 'sweepDates')).toMatchObject({
      outcome: 'paused',
      failure: null,
    });
    expect(errors).toHaveLength(1);
  });
});
