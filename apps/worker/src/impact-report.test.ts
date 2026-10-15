import { randomUUID } from 'node:crypto';
import {
  cancelJob,
  createComponent,
  createJobQueue,
  createSpace,
  createTenant,
  findRole,
  grant,
  IMPACT_LIMIT,
  migrate,
  prepareDatabase,
  readJob,
  startJob,
  submitImpactReport,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { impactReportJob } from './jobs/impact-report.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * The impact report, from the queue to the store (the R3 plan, R3-F). Ada reads Shared and not
 * Restricted. Nothing in content references a component from another component, so the index's rows
 * are written directly: the walk reads the index, whatever wrote it.
 */
describe('an impact report, from the queue to the store', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let ada = '';
  let shared = '';
  let restricted = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** `count` components in `space`, each referencing `target`, made in one transaction. */
  const referencing = (target: { artifactId: string }, count: number, space: string) =>
    as(async (trx) => {
      const made: { artifactId: string; id: string }[] = [];
      for (let each = 0; each < count; each += 1) {
        const component = await createComponent(trx, {
          spaceId: space,
          title: `Step ${each}`,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (component.answer !== 'created') throw new Error(component.answer);
        made.push(component.version);
      }
      await trx
        .insertInto('reference')
        .values(
          made.map((each) => ({
            from_id: each.artifactId,
            from_version: each.id,
            node: null,
            to_id: target.artifactId,
            to_kind: 'component',
            mode: 'latest' as const,
            to_version: null,
          })),
        )
        .execute();
      return made;
    });

  const component = (space: string, title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
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
    handlers = { impact_report: impactReportJob({ db: worker, stores }) };
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
      shared = (await createSpace(trx, 'Shared')).id;
      restricted = (await createSpace(trx, 'Restricted')).id;
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: shared },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await queue.close();
    await worker.close();
    await service.close();
    await store.drop();
    await db.drop();
  });

  const work = () =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 120_000,
      log: quiet,
    });

  it('REL-032 REL-050 writes every artifact a change reaches, beyond the interactive limit, as its requester, and says the walk was cut', async () => {
    const target = await component(shared, 'Calibrate');
    await referencing(target, IMPACT_LIMIT + 5, shared);
    // One Ada may not read: neither written nor walked past.
    const [hidden] = await referencing(target, 1, restricted);
    await referencing(hidden!, 1, shared);

    const job = await as((trx) =>
      submitImpactReport(trx, { by: ada, subject: target.artifactId, depth: 2 }),
    );
    expect(await work()).toBe('done');

    const done = (await as((trx) => readJob(trx, job.id, ada)))!;
    expect(done).toMatchObject({
      state: 'succeeded',
      progress: { done: 2, of: 2, unit: 'depth' },
      outcome: { depthsWalked: 2, depthsAsked: 2, reached: IMPACT_LIMIT + 5, cut: true },
    });
    const kept = await as((trx) => stores.forTenant(trx, tenant));
    const lines = new TextDecoder()
      .decode(await kept.get(done.result!.key))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; depth: number; via: string });
    expect(lines).toHaveLength(IMPACT_LIMIT + 5);
    expect(lines.every((line) => line.depth === 1 && line.via === target.artifactId)).toBe(true);
    expect(lines.some((line) => line.id === hidden!.artifactId)).toBe(false);
  }, 120_000);

  it('API-042 stops a running report at its next depth where a cancel was asked, keeping nothing and saying how far it got', async () => {
    const target = await component(shared, 'Prime');
    const [near] = await referencing(target, 1, shared);
    await referencing(near!, 1, shared);
    const job = await as((trx) =>
      submitImpactReport(trx, { by: ada, subject: target.artifactId, depth: 3 }),
    );
    // Running already when the cancel arrives, as a worker would have it.
    await as((trx) => startJob(trx, job.id));
    await as((trx) => cancelJob(trx, job.id, ada));

    expect(await work()).toBe('done');
    expect(await as((trx) => readJob(trx, job.id, ada))).toMatchObject({
      state: 'cancelled',
      outcome: { depthsWalked: 1, depthsAsked: 3, reached: 1 },
      result: null,
    });
  });

  it('API-042 keeps nothing where a cancel arrives at the last depth', async () => {
    const target = await component(shared, 'Flush');
    await referencing(target, 1, shared);
    const job = await as((trx) =>
      submitImpactReport(trx, { by: ada, subject: target.artifactId, depth: 1 }),
    );
    await as((trx) => startJob(trx, job.id));
    await as((trx) => cancelJob(trx, job.id, ada));

    expect(await work()).toBe('done');
    expect(await as((trx) => readJob(trx, job.id, ada))).toMatchObject({
      state: 'cancelled',
      outcome: { depthsWalked: 1, depthsAsked: 1 },
      result: null,
    });
  });

  it('API-043 fails a report whose requester may no longer read what it starts from, in an error shape', async () => {
    const hidden = await component(restricted, 'Hidden');
    const job = await as((trx) =>
      submitImpactReport(trx, { by: ada, subject: hidden.artifactId, depth: 1 }),
    );

    expect(await work()).toBe('failed');
    expect(await as((trx) => readJob(trx, job.id, ada))).toMatchObject({
      state: 'failed',
      failure: { code: 'subject_unreadable' },
      result: null,
    });
  });
});
