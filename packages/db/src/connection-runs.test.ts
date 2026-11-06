import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { connectionRunsSince } from './connection-runs.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { recordQueryRun, type QueryRun } from './query-runs.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const UP = '11111111-1111-4111-8111-111111111111';
const DOWN = '22222222-2222-4222-8222-222222222222';

describe("each connection's recent runs, for Diagnostics (the DG plan, pre-flight 12)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });
  const run = (connection: string, outcome: QueryRun['outcome'], failure: string | null = null) =>
    as((trx) =>
      recordQueryRun(trx, {
        act: 'sample',
        principal: null,
        connection,
        queryDefinition: null,
        document: null,
        durationMs: 10,
        rows: null,
        bytes: null,
        outcome,
        failure,
      }),
    );

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

  it('counts runs, failures and time-outs by connection, and says which last failed', async () => {
    await run(UP, 'failed', 'timeout');
    await run(UP, 'ran');
    await run(DOWN, 'ran');
    await run(DOWN, 'failed', 'timeout');
    await run(DOWN, 'failed', 'connection_refused');
    const runs = await as((trx) => connectionRunsSince(trx, new Date(Date.now() - 60_000)));
    expect(runs).toEqual([
      expect.objectContaining({
        connection: UP,
        runs: 2,
        failed: 1,
        timedOut: 1,
        lastFailed: false,
      }),
      expect.objectContaining({
        connection: DOWN,
        runs: 3,
        failed: 2,
        timedOut: 1,
        lastFailed: true,
        lastFailure: 'connection_refused',
      }),
    ]);
  });
});
