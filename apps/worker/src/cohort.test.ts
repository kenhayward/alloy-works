import { randomUUID } from 'node:crypto';
import {
  createJobQueue,
  createTemplate,
  createTenant,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  readCohort,
  readJob,
  submitCohort,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cohortJob } from './jobs/cohort.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

/** A cohort's run, from the queue to the store (the R7 plan, R7-E). */
describe("a cohort's run, from the queue to the store", () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let ada = '';
  let general = '';
  let template = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const work = () =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 600_000,
      log: quiet,
    });

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await store.setUp(db.adminUrl, tenant);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
    handlers = { cohort: cohortJob({ db: worker, stores }) };
    await as(async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: randomUUID(),
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const made = await createTemplate(trx, {
        spaceId: general,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Site report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
          parameters: [
            {
              name: 'site',
              type: { base: 'integer' },
              required: true,
              list: false,
              changeable: true,
              feeds: { arguments: true },
            },
          ],
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      template = made.template.id;
    });
  }, 120_000);

  afterAll(async () => {
    await queue.close();
    await worker.close();
    await service.close();
    await store.drop();
    await db.drop();
  });

  const asked = (rows: Record<string, unknown>[]) =>
    as(async (trx) => {
      const answer = await submitCohort(trx, {
        by: ada,
        spaceId: general,
        template,
        title: 'Site {site}',
        language: 'en-GB',
        direction: 'ltr',
        rows,
        source: { rows: rows.length },
      });
      if (answer.answer !== 'submitted') throw new Error(answer.answer);
      return answer;
    });

  it('REU-033 makes forty documents, one row failing alone, and reports every row', async () => {
    const rows = Array.from({ length: 40 }, (_, at) => ({
      site: at === 6 ? 'seven' : String(at + 1),
    }));
    const { cohort, job } = await asked(rows);
    expect(await work()).toBe('done');

    const done = (await as((trx) => readJob(trx, job.id, ada)))!;
    expect(done).toMatchObject({
      state: 'succeeded',
      progress: { done: 40, of: 40, unit: 'row' },
      outcome: { made: 39, failed: 1, of: 40 },
    });
    const kept = await as((trx) => stores.forTenant(trx, tenant));
    const lines = new TextDecoder()
      .decode(await kept.get(done.result!.key))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { row: number; state: string; failure: unknown });
    expect(lines).toHaveLength(40);
    expect(lines[6]).toMatchObject({
      row: 7,
      state: 'failed',
      failure: { code: 'parameter.invalid' },
    });
    const after = (await as((trx) => readCohort(trx, cohort.id)))!;
    expect(after.rows.filter((each) => each.document !== null)).toHaveLength(39);
  }, 120_000);

  it("makes four hundred documents well within the hour bulk generation's budget names", async () => {
    const rows = Array.from({ length: 400 }, (_, at) => ({ site: String(at + 1) }));
    const { job } = await asked(rows);
    const started = Date.now();
    expect(await work()).toBe('done');
    const took = Date.now() - started;
    expect((await as((trx) => readJob(trx, job.id, ada)))!.outcome).toEqual({
      made: 400,
      failed: 0,
      of: 400,
    });
    // An hour is the budget; a tenth of it here leaves the margin production needs.
    expect(took).toBeLessThan(6 * 60 * 1000);
  }, 600_000);
});
