import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, enqueueJob, type JobQueue } from './queue.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const SUBJECT = '11111111-2222-3333-4444-555555555555';

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

  it('knows every tenant, and one by name', async () => {
    const all = await service.tenants();
    expect(all.map((tenant) => tenant.id).sort()).toEqual([a.id, b.id].sort());
    expect(await service.tenant(a.id)).toEqual(a);
    expect(await service.tenant('nobody')).toBeUndefined();
  });
});
