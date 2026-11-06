import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { ownJobs } from './own-jobs.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, enqueueJob, type JobQueue } from './queue.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SUBJECT = '11111111-2222-3333-4444-555555555555';

describe("an environment's own jobs, by kind and state (the DG plan, pre-flight 8)", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let queue: JobQueue;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    a = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    b = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    queue = createJobQueue(db.workerUrl);
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await service?.close();
    await db?.drop();
  });

  it("reads its own jobs' kinds, states, times and failure codes, and nobody else's", async () => {
    await service.withTenant(a, async (trx) => {
      await enqueueJob(trx, 'publish', SUBJECT);
      await enqueueJob(trx, 'publish', SUBJECT);
      await enqueueJob(trx, 'embed', SUBJECT);
    });
    await service.withTenant(b, (trx) => enqueueJob(trx, 'import', SUBJECT));
    const claimed = await queue.claim({ workerId: 'w1', leaseMs: 60_000, kinds: ['embed'] });
    await queue.fail({ ...claimed!, attempts: claimed!.maxAttempts }, 'connector_unreachable');
    const running = await queue.claim({ workerId: 'w1', leaseMs: 60_000, kinds: ['publish'] });
    expect(running).toBeDefined();

    const jobs = await service.withTenant(a, (trx) => ownJobs(trx, new Date(0)));
    expect(
      jobs.map(({ kind, state, jobs: count, lastError }) => [kind, state, count, lastError]),
    ).toEqual([
      ['embed', 'failed', 1, 'connector_unreachable'],
      ['publish', 'running', 1, null],
      ['publish', 'waiting', 1, null],
    ]);
    expect(jobs[0]!.lastAt).toBeInstanceOf(Date);
    const theirs = await service.withTenant(b, (trx) => ownJobs(trx, new Date(0)));
    expect(theirs.map((each) => each.kind)).toEqual(['import']);
  });

  it("leaves the queue itself closed to an environment's role", async () => {
    await expect(
      service.withTenant(a, (trx) => sql`select count(*) from platform.job`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
