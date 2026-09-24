import {
  bootstrapCluster,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  enqueueJob,
  listenToTenants,
  migrate,
  type Job,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts, type PinnedFonts } from './fonts.js';
import { sampleJob } from './jobs/sample.js';
import { JobRefused } from './refusal.js';
import { createTypst, typstBinaryPath, type Typst } from './typst.js';
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
  let fonts: PinnedFonts;
  let typst: Typst;

  beforeAll(async () => {
    fonts = await loadPinnedFonts();
    typst = createTypst({ binary: typstBinaryPath(), fonts });
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

  it("says so on the environment's channel, in the transaction that finishes it", async () => {
    const listener = listenToTenants(db.serviceUrl);
    try {
      const id = await request();
      let deliver: (event: unknown) => void = () => {};
      const heard = new Promise<unknown>((resolve) => {
        deliver = resolve;
      });
      const { stop, ready } = listener.subscribe(tenant.id, (event) => {
        stop();
        deliver(event);
      });
      // Heard before the work starts: what it announces must have committed by then, and anything
      // committed before the LISTEN lands would reach nobody.
      await ready;
      expect(await work()).toBe('done');
      expect(await heard).toEqual({ kind: 'sample', id, state: 'done' });
    } finally {
      await listener.close();
    }
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
        typst: createTypst({ binary: 'no-typst-here', fonts }),
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

  it('finishes a job refused on its merits at once, never trying the same input again (issue #146)', async () => {
    const id = await request();
    const told: unknown[] = [];
    const refusing: Record<string, JobHandler> = {
      sample_pdf: {
        run: async () => {
          throw new JobRefused('sample_refused', 'The sample cannot be made from this.');
        },
        failed: async (_tenant, _job, cause) => {
          told.push(cause);
        },
      },
    };
    const eager = {
      ...queue,
      fail: (job: Job, reason: string) => queue.fail(job, reason, { retryInMs: 0 }),
    };
    expect(await work({ handlers: refusing, queue: eager })).toBe('failed');
    // Nothing is left to claim: the job is failed, with its reason, after one attempt.
    expect(await work({ handlers: refusing, queue: eager })).toBe('idle');
    const [job] = (
      await queryAs(
        db.adminUrl,
        'select attempts, last_error, failed_at is not null as failed from platform.job where subject_id = $1',
        [id],
      )
    ).rows;
    expect(job).toEqual({ attempts: 1, last_error: 'sample_refused', failed: true });
    expect(told).toHaveLength(1);
    expect(told[0]).toBeInstanceOf(JobRefused);
  });

  it("records a refusal by Typst as its code, and nowhere the engine's diagnostic, which quotes content", async () => {
    const id = await request();
    const told: unknown[] = [];
    const heard: unknown[] = [];
    const listening: WorkerLog = {
      info: (...entry) => heard.push(entry),
      warn: (...entry) => heard.push(entry),
      error: (...entry) => heard.push(entry),
    };
    // Typst's diagnostic for this names the character it could not set and the line that holds it:
    // a private-use character no pinned face has. (STIX Two Math holds much of the private-use area
    // from U+E000, which the sample's text falls back to since equations 2 pinned it.)
    const refused = JSON.stringify({ environment: 'Grace \u{f8ff}', requestedAt: 'now' });
    // The sample job as it runs, with the real Typst handed content it refuses in place of the name.
    const real = sampleJob({
      db: worker,
      stores,
      typst: {
        version: () => typst.version(),
        compile: (template, _data, createdAt) => typst.compile(template, refused, createdAt),
      },
    });
    const refusing: Record<string, JobHandler> = {
      sample_pdf: {
        run: (tenant, job) => real.run(tenant, job),
        failed: async (tenant, job, cause) => {
          told.push(cause);
          await real.failed(tenant, job, cause);
        },
      },
    };
    expect(await work({ handlers: refusing, log: listening })).toBe('failed');
    const { rows } = await queryAs(
      db.adminUrl,
      'select attempts, last_error from platform.job where subject_id = $1',
      [id],
    );
    expect(rows).toEqual([{ attempts: 1, last_error: 'typst_refused' }]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      code: 'typst_refused',
      message: 'Typst refused the document.',
    });
    expect((told[0] as Error).cause).toBeUndefined();
    expect(await sample(id)).toMatchObject({ state: 'failed', object_key: null });
    const everything = JSON.stringify([heard, rows, pino.stdSerializers.err(told[0] as Error)]);
    for (const quoted of ['f8ff', 'F8FF', '\u{f8ff}', 'Grace', 'displayed', 'PDF/UA', 'main.typ']) {
      expect(everything).not.toContain(quoted);
    }
  });

  it('refuses a kind it does not know rather than guessing', async () => {
    await service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', crypto.randomUUID()));
    expect(await work({ handlers: {} })).toBe('failed');
  });
});
