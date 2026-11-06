import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backgroundWork, recordBackgroundWork } from './background-work.js';
import { bootstrapCluster } from './bootstrap.js';
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

describe('background work recorded, a row per tenant and kind of work (the DG plan, DG-G)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 6, 10, minute));

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

  it('keeps the last run, the last failure as a code, and next due from the gap between runs', async () => {
    await as((trx) =>
      recordBackgroundWork(trx, {
        work: 'sweepMail',
        startedAt: at(0),
        finishedAt: at(1),
        outcome: 'succeeded',
      }),
    );
    let [row] = await as((trx) => backgroundWork(trx));
    // One run says nothing of the cadence.
    expect(row).toMatchObject({ work: 'sweepMail', outcome: 'succeeded', nextDueAt: null });

    await as((trx) =>
      recordBackgroundWork(trx, {
        work: 'sweepMail',
        startedAt: at(5),
        finishedAt: at(6),
        outcome: 'failed',
        failure: 'connection_refused',
      }),
    );
    [row] = await as((trx) => backgroundWork(trx));
    expect(row).toMatchObject({
      outcome: 'failed',
      failure: 'connection_refused',
      failedAt: at(6),
      failures: 1,
      nextDueAt: at(10),
    });

    await as((trx) =>
      recordBackgroundWork(trx, {
        work: 'sweepMail',
        startedAt: at(10),
        finishedAt: at(11),
        outcome: 'succeeded',
      }),
    );
    [row] = await as((trx) => backgroundWork(trx));
    // The last failure is kept when it clears; the run of failures is not.
    expect(row).toMatchObject({
      outcome: 'succeeded',
      failure: 'connection_refused',
      failedAt: at(6),
      failures: 0,
      lastFinishedAt: at(11),
    });
  });

  it('keeps a paused run apart from a failing one, and refuses a failure that is not a code', async () => {
    await as((trx) =>
      recordBackgroundWork(trx, {
        work: 'sweepDates',
        startedAt: at(0),
        finishedAt: at(0),
        outcome: 'paused',
      }),
    );
    const rows = await as((trx) => backgroundWork(trx));
    expect(rows.find((each) => each.work === 'sweepDates')).toMatchObject({
      outcome: 'paused',
      failures: 0,
    });
    await expect(
      as((trx) =>
        recordBackgroundWork(trx, {
          work: 'sweepDates',
          startedAt: at(1),
          finishedAt: at(1),
          outcome: 'failed',
          failure: 'Ada Lovelace could not be found',
        }),
      ),
    ).rejects.toThrow();
  });
});
