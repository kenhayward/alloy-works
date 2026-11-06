import { BUCKETS_VERSION, bucketOf, emptyBuckets } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { capabilityUsage, recordCapabilityMinute, rollUpMeasurements } from './measurements.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const timed = (...ms: number[]) => {
  const buckets = emptyBuckets();
  for (const each of ms) buckets[bucketOf(each)]! += 1;
  return buckets;
};

describe("a capability's requests measured by minute and rolled up (the DG plan, DG-B)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });

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

  it('adds what two processes counted in one minute to one row', async () => {
    const minute = new Date('2026-11-06T10:00:00Z');
    const once = {
      capability: 'Components',
      requests: 3,
      clientErrors: 1,
      serverErrors: 0,
      refused: 0,
      buckets: timed(20, 40, 300),
    };
    await as((trx) => recordCapabilityMinute(trx, minute, [once]));
    await as((trx) =>
      recordCapabilityMinute(trx, minute, [{ ...once, serverErrors: 1, buckets: timed(9000) }]),
    );
    const [row] = await as((trx) =>
      capabilityUsage(trx, 'minute', new Date('2026-11-06T09:00:00Z')),
    );
    expect(row).toMatchObject({
      capability: 'Components',
      requests: 6,
      clientErrors: 2,
      serverErrors: 1,
      bucketsVersion: BUCKETS_VERSION,
    });
    expect(row!.buckets).toEqual(timed(20, 40, 300, 9000));
  });

  it('ADM-035 rolls minutes past 7 days into hours and hours past 90 into days, exactly, and forgets days past 13 months', async () => {
    await as((trx) => sql`delete from capability_usage`.execute(trx));
    const now = new Date('2026-11-06T12:00:00Z');
    const day = 86_400_000;
    const row = (buckets: number[]) => ({
      capability: 'Search',
      requests: 1,
      clientErrors: 0,
      serverErrors: 0,
      refused: 0,
      buckets,
    });
    const old = now.getTime() - 8 * day;
    await as(async (trx) => {
      await recordCapabilityMinute(trx, new Date(old), [row(timed(40))]);
      await recordCapabilityMinute(trx, new Date(old + 60_000), [row(timed(400))]);
      // Within the week: kept by minute.
      await recordCapabilityMinute(trx, new Date(now.getTime() - 60_000), [row(timed(40))]);
    });
    await as((trx) => rollUpMeasurements(trx, now));
    const hours = await as((trx) => capabilityUsage(trx, 'hour', new Date(0)));
    expect(hours.map((each) => [each.requests, each.buckets])).toEqual([[2, timed(40, 400)]]);
    expect(await as((trx) => capabilityUsage(trx, 'minute', new Date(0)))).toHaveLength(1);

    await as((trx) => rollUpMeasurements(trx, new Date(now.getTime() + 91 * day)));
    const days = await as((trx) => capabilityUsage(trx, 'day', new Date(0)));
    expect(days.map((each) => [each.requests, each.buckets])).toEqual([
      [2, timed(40, 400)],
      [1, timed(40)],
    ]);
    await as((trx) => rollUpMeasurements(trx, new Date(now.getTime() + 400 * day)));
    expect(await as((trx) => capabilityUsage(trx, 'day', new Date(0)))).toEqual([]);
  });
});
