import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, enqueueJob, type JobQueue } from './queue.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const SUBJECT = '11111111-2222-3333-4444-555555555555';

/**
 * Ends every other client connection to this test database from outside, as a database restart,
 * a failover or an operator's `pg_terminate_backend` would, and gives the pool a moment to hear it.
 */
async function endIdleConnections(db: TestDatabase): Promise<number> {
  const ended = await queryAs(
    db.adminUrl,
    `select pg_terminate_backend(pid) from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid() and backend_type = 'client backend'`,
    [db.name],
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  return ended.rowCount ?? 0;
}

describe('the job queue', () => {
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
    service = createTenantDatabase(db.serviceUrl);
    queue = createJobQueue(db.workerUrl);
  });

  afterAll(async () => {
    await queue.close();
    await service.close();
    await db.drop();
  });

  const enqueue = (tenant: Tenant) =>
    service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', SUBJECT));
  const claim = () => queue.claim({ workerId: 'worker-1', leaseMs: 60_000 });

  it('carries on when the server ends a connection idle in its pool, rather than crashing the process (issue #169)', async () => {
    await claim();
    expect(await endIdleConnections(db)).toBeGreaterThan(0);
    await expect(claim()).resolves.toBeUndefined();
  });

  it("hands a tenant's work to a worker, once", async () => {
    await enqueue(a);
    const job = await claim();
    expect(job).toMatchObject({
      tenantId: a.id,
      kind: 'sample_pdf',
      subjectId: SUBJECT,
      attempts: 1,
    });
    expect(await claim()).toBeUndefined();
    await queue.complete(job!);
  });

  it('refuses a row that names another tenant', async () => {
    await expect(
      service.withTenant(a, (trx) =>
        sql`insert into platform.job (tenant_id, kind, subject_id)
              values (${b.id}, 'sample_pdf', ${SUBJECT}::uuid)`.execute(trx),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it('offers a job again once the claim on it runs out', async () => {
    await enqueue(b);
    const first = await queue.claim({ workerId: 'stops-here', leaseMs: 50 });
    expect(first?.tenantId).toBe(b.id);
    expect(await claim()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const again = await claim();
    expect(again).toMatchObject({ id: first!.id, attempts: 2 });
    await queue.complete(again!);
  });

  it('retries while it may, then gives up, recording only the kind of failure', async () => {
    await enqueue(a);
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = await claim();
      outcomes.push(await queue.fail(job!, 'typst_failed', { retryInMs: 0 }));
    }
    expect(outcomes).toEqual(['retry', 'retry', 'failed']);
    expect(await claim()).toBeUndefined();
    const { rows } = await queryAs(
      db.adminUrl,
      `select last_error, failed_at is not null as given_up from platform.job
        where tenant_id = $1 and failed_at is not null`,
      [a.id],
    );
    expect(rows).toEqual([{ last_error: 'typst_failed', given_up: true }]);
  });

  it('gives up on a job whose worker never came back', async () => {
    await enqueue(b);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await queue.claim({ workerId: 'vanishes', leaseMs: 40 })).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const abandoned = await queue.abandoned();
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ tenantId: b.id, kind: 'sample_pdf' });
    expect(await queue.abandoned()).toEqual([]);
  });

  it('is closed to the service, which only ever enqueues inside a tenant', async () => {
    await expect(queryAs(db.serviceUrl, 'select * from platform.job')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("answers the subjects of a tenant's jobs of one kind still waiting or running, and none finished, given up, of another kind or another tenant's", async () => {
    const subject = (n: number) => `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const check = (tenant: Tenant, id: string) =>
      service.withTenant(tenant, (trx) => enqueueJob(trx, 'check_pdf', id));
    await check(a, subject(1)); // waiting
    await check(a, subject(2)); // running
    await check(a, subject(3)); // finished
    await check(a, subject(4)); // given up
    await check(b, subject(5)); // another tenant's
    await service.withTenant(a, (trx) => enqueueJob(trx, 'publish', subject(6)));
    // Running, finished and given up, set as the queue would leave each.
    await queryAs(
      db.adminUrl,
      `update platform.job set attempts = 1, locked_by = 'worker-1', locked_until = now() + interval '1 minute'
        where subject_id = $1`,
      [subject(2)],
    );
    await queryAs(
      db.adminUrl,
      'update platform.job set finished_at = now() where subject_id = $1',
      [subject(3)],
    );
    await queryAs(
      db.adminUrl,
      `update platform.job set attempts = 3, failed_at = now(), last_error = 'check_failed'
        where subject_id = $1`,
      [subject(4)],
    );

    expect((await queue.waiting(a.id, 'check_pdf')).sort()).toEqual([subject(1), subject(2)]);
    expect(await queue.waiting(b.id, 'check_pdf')).toEqual([subject(5)]);
    expect(await queue.waiting(a.id, 'ingest')).toEqual([]);
  });

  it("answers each subject of a tenant's jobs of one kind that gave up after their last attempt, with how many did, and no other", async () => {
    const subject = (n: number) => `88888888-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const check = (tenant: Tenant, id: string) =>
      service.withTenant(tenant, (trx) => enqueueJob(trx, 'check_pdf', id));
    // Two checks of one subject given up, one of another, and one of a third still waiting.
    for (const n of [1, 1, 2, 3]) await check(a, subject(n));
    await check(b, subject(4)); // another tenant's, given up
    await service.withTenant(a, (trx) => enqueueJob(trx, 'publish', subject(5))); // another kind's
    await queryAs(
      db.adminUrl,
      `update platform.job set attempts = max_attempts, failed_at = now(), last_error = 'check_failed'
        where subject_id = any($1::uuid[])`,
      [[subject(1), subject(2), subject(4), subject(5)]],
    );
    // One of a subject finished after a retry: attempts spent, and done, not given up.
    await check(a, subject(6));
    await queryAs(
      db.adminUrl,
      'update platform.job set attempts = 2, finished_at = now() where subject_id = $1',
      [subject(6)],
    );

    /** What the queue answers of this test's own subjects, beside those an earlier test left. */
    const ours = (answer: ReadonlyMap<string, number>) =>
      [...answer].filter(([id]) => id.startsWith('88888888-')).sort();
    expect(ours(await queue.givenUp(a.id, 'check_pdf'))).toEqual([
      [subject(1), 2],
      [subject(2), 1],
    ]);
    expect(ours(await queue.givenUp(b.id, 'check_pdf'))).toEqual([[subject(4), 1]]);
    expect(await queue.givenUp(a.id, 'ingest')).toEqual(new Map());
  });

  it('knows every tenant, and one by name', async () => {
    const all = await service.tenants();
    expect(all.map((tenant) => tenant.id).sort()).toEqual([a.id, b.id].sort());
    expect(await service.tenant(a.id)).toEqual(a);
    expect(await service.tenant('nobody')).toBeUndefined();
  });
});
