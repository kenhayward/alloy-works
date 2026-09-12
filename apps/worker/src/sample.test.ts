import {
  bootstrapCluster,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  enqueueJob,
  migrate,
  type Job,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleJob } from './jobs/sample.js';
import { createTypst, typstBinaryPath } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('the sample job, from the queue to the store', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let principal: string;

  const typst = createTypst({ binary: typstBinaryPath() });

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await store.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
    handlers = { sample_pdf: sampleJob({ db: worker, stores, typst }) };
    principal = await service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  });

  afterAll(async () => {
    await queue.close();
    await worker.close();
    await service.close();
    await store.drop();
    await db.drop();
  });

  const request = () =>
    service.withTenant(tenant, async (trx) => {
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal })
        .returning('id')
        .executeTakeFirstOrThrow();
      await enqueueJob(trx, 'sample_pdf', sample.id);
      return sample.id;
    });

  const sample = (id: string) =>
    service.withTenant(tenant, (trx) =>
      trx.selectFrom('sample').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );

  const work = (deps: Partial<Parameters<typeof processNext>[0]> = {}) =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 60_000,
      log: quiet,
      ...deps,
    });

  it("renders what a tenant asked for, and keeps it in that tenant's own store", async () => {
    const id = await request();
    expect(await work()).toBe('done');
    const row = await sample(id);
    expect(row).toMatchObject({ state: 'done', engine: '0.15.1', bytes: expect.any(Number) });
    expect(row.object_key).toMatch(new RegExp(`^${tenant.role}/sha256/[0-9a-f]{64}$`));
    const tenantStore = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const pdf = await tenantStore.get(row.object_key!);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('Development');
  });

  it('has nothing to do when the queue is empty', async () => {
    expect(await work()).toBe('idle');
  });

  it('tries again, then gives up and says so on the sample, recording only the kind', async () => {
    const id = await request();
    const broken = {
      sample_pdf: sampleJob({
        db: worker,
        stores,
        typst: createTypst({ binary: 'no-typst-here' }),
      }),
    };
    // Retried at once, rather than after the seconds a worker waits in earnest.
    const eager = {
      ...queue,
      fail: (job: Job, reason: string) => queue.fail(job, reason, { retryInMs: 0 }),
    };
    expect(await work({ handlers: broken, queue: eager })).toBe('retry');
    expect(await work({ handlers: broken, queue: eager })).toBe('retry');
    expect(await work({ handlers: broken, queue: eager })).toBe('failed');
    expect(await sample(id)).toMatchObject({ state: 'failed', object_key: null });
  });

  it('refuses a kind it does not know rather than guessing', async () => {
    await service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', crypto.randomUUID()));
    expect(await work({ handlers: {} })).toBe('failed');
  });
});
