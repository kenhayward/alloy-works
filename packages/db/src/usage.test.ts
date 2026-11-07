import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { recordCapabilityMinute } from './measurements.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { recordQueryRun } from './query-runs.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { countUsage, usageDays } from './usage.js';

describe('usage counted by day, each night (the DG plan, DG-I; ADR-0100)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });
  const day = (n: number, hour = 10) => new Date(Date.UTC(2026, 10, n, hour));
  const searches = (at: Date, answered: number, refused: number) =>
    as((trx) =>
      recordCapabilityMinute(trx, at, [
        {
          capability: 'Reference searches',
          requests: answered + refused,
          clientErrors: 0,
          serverErrors: 0,
          refused,
          buckets: [answered + refused],
        },
      ]),
    );
  const ran = async (at: Date, durationMs: number) => {
    await as(async (trx) => {
      await recordQueryRun(trx, {
        act: 'sample',
        principal: null,
        connection: '33333333-3333-4333-8333-333333333333',
        queryDefinition: null,
        document: null,
        durationMs,
        rows: 1,
        bytes: 10,
        outcome: 'ran',
        failure: null,
      });
    });
    // Insert-only to the service: the run's time set, as the administrator, to the day it stands for.
    await queryAs(
      db.adminUrl,
      `update "${tenant.schema}".query_run set at = $1 where duration_ms = $2`,
      [at, durationMs],
    );
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
  }, 120_000);

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('ADM-011 measures query time, reference searches and the database by day, each attributable to its day', async () => {
    await ran(day(4), 1200);
    await ran(day(4, 23), 300);
    await ran(day(5), 50);
    await searches(day(5), 3, 2);

    expect(await as((trx) => countUsage(trx, day(6, 0)))).toBe(true);
    const counted = await as((trx) => usageDays(trx, '2026-10-01', '2026-11-06'));
    const amount = (on: string, measure: string) =>
      counted.find((each) => each.day === on && each.measure === measure)?.amount;
    expect(amount('2026-11-04', 'queryMs')).toBe(1500);
    expect(amount('2026-11-05', 'queryMs')).toBe(50);
    // A search the environment refused is not one made.
    expect(amount('2026-11-05', 'referenceSearches')).toBe(3);
    // A sample is what is held when it is counted, on the day it is counted.
    expect(amount('2026-11-06', 'databaseBytes')).toBeGreaterThan(0);
    // Nothing made is not stored.
    expect(counted.some((each) => each.measure === 'publications')).toBe(false);
  });

  it('counts once a day, then the last three days again, so what lands late still counts', async () => {
    await ran(day(5, 12), 25);
    expect(await as((trx) => countUsage(trx, day(6, 9)))).toBe(false);
    expect(await as((trx) => countUsage(trx, day(7, 0)))).toBe(true);
    const counted = await as((trx) => usageDays(trx, '2026-11-01', '2026-11-07'));
    expect(
      counted.find((each) => each.day === '2026-11-05' && each.measure === 'queryMs')?.amount,
    ).toBe(75);
  });

  it('ADM-035 keeps 13 months of days, as declared, and forgets the rest', async () => {
    await as((trx) =>
      trx
        .insertInto('usage_day')
        .values({ day: '2025-10-01', measure: 'publications', amount: 4 })
        .execute(),
    );
    expect(await as((trx) => countUsage(trx, day(8, 0)))).toBe(true);
    expect(await as((trx) => usageDays(trx, '2025-01-01', '2025-12-31'))).toEqual([]);
  });
});
