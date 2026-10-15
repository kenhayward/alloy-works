import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import {
  cancelJob,
  failJob,
  finishJob,
  progressJob,
  readJob,
  startJob,
  submitImpactReport,
} from './jobs.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('jobs through the API (the R3 plan, R3-A to R3-D)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let subject = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const submit = (depth = 3) => as((trx) => submitImpactReport(trx, { by: ada, subject, depth }));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await as(async (trx) => {
      const person = (name: string) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: randomUUID(),
            email: null,
            display_name: name,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('Ada');
      grace = await person('Grace');
      const made = await createComponent(trx, {
        spaceId: (await createSpace(trx, 'Shared')).id,
        title: 'Calibrate',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      subject = made.version.artifactId;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('API-040 API-041 accepts a job at once and queues it, readable by its requester alone', async () => {
    const job = await submit();
    expect(job).toMatchObject({
      kind: 'impact_report',
      subject,
      parameters: { depth: 3 },
      requestedBy: ada,
      state: 'accepted',
      startedAt: null,
      progress: null,
      cancelRequested: false,
      failure: null,
      result: null,
    });
    const { rows } = await queryAs(
      db.adminUrl,
      `select kind from platform.job where subject_id = $1`,
      [job.id],
    );
    expect(rows).toEqual([{ kind: 'impact_report' }]);
    expect(await as((trx) => readJob(trx, job.id, ada))).toEqual(job);
    expect(await as((trx) => readJob(trx, job.id, grace))).toBeUndefined();
  });

  it('API-041 says when a running job started and how far it has got', async () => {
    const job = await submit();
    const started = await as((trx) => startJob(trx, job.id));
    expect(started).toMatchObject({ state: 'running', progress: null });
    expect(started!.startedAt).toBeInstanceOf(Date);
    expect(await as((trx) => progressJob(trx, job.id, { done: 1, of: 3, unit: 'depth' }))).toBe(
      true,
    );
    expect(await as((trx) => readJob(trx, job.id, ada))).toMatchObject({
      state: 'running',
      progress: { done: 1, of: 3, unit: 'depth' },
    });
  });

  it('API-042 cancels a job not yet run at once, having done nothing, and a finished one not at all', async () => {
    const job = await submit(4);
    expect(await as((trx) => cancelJob(trx, job.id, grace))).toEqual({ answer: 'missing' });
    const cancelled = await as((trx) => cancelJob(trx, job.id, ada));
    expect(cancelled).toMatchObject({
      answer: 'cancelled',
      job: {
        state: 'cancelled',
        outcome: { depthsWalked: 0, depthsAsked: 4, reached: 0, cut: false },
      },
    });
    // The worker meets it later, and has nothing to do.
    expect(await as((trx) => startJob(trx, job.id))).toBeUndefined();
    expect(await as((trx) => cancelJob(trx, job.id, ada))).toMatchObject({ answer: 'finished' });
  });

  it('API-042 asks a running job to stop, which it does at its next step, saying how far it got and keeping nothing', async () => {
    const job = await submit(5);
    await as((trx) => startJob(trx, job.id));
    expect(await as((trx) => cancelJob(trx, job.id, ada))).toMatchObject({
      answer: 'cancelling',
      job: { state: 'running', cancelRequested: true },
    });
    expect(await as((trx) => progressJob(trx, job.id, { done: 2, of: 5, unit: 'depth' }))).toBe(
      false,
    );
    const stopped = await as((trx) =>
      finishJob(trx, job.id, { depthsWalked: 2, depthsAsked: 5, reached: 7, cut: false }, null),
    );
    expect(stopped).toMatchObject({
      state: 'cancelled',
      outcome: { depthsWalked: 2, depthsAsked: 5, reached: 7, cut: false },
      result: null,
    });
    expect(stopped!.finishedAt).toBeInstanceOf(Date);
  });

  it('API-043 keeps a failure in an error shape, and the job readable after', async () => {
    const job = await submit();
    await as((trx) => startJob(trx, job.id));
    await as((trx) =>
      failJob(trx, job.id, { code: 'job_failed', message: 'The report could not be made.' }),
    );
    expect(await as((trx) => readJob(trx, job.id, ada))).toMatchObject({
      state: 'failed',
      failure: { code: 'job_failed', message: 'The report could not be made.' },
      result: null,
    });
  });

  it('keeps a finished job result where nothing asked it to stop', async () => {
    const job = await submit(2);
    await as((trx) => startJob(trx, job.id));
    const done = await as((trx) =>
      finishJob(
        trx,
        job.id,
        { depthsWalked: 2, depthsAsked: 2, reached: 3, cut: true },
        { key: 'tenant/sha256/abc', sha256: 'abc', bytes: 120 },
      ),
    );
    expect(done).toMatchObject({
      state: 'succeeded',
      outcome: { depthsWalked: 2, depthsAsked: 2, reached: 3, cut: true },
      result: { key: 'tenant/sha256/abc', sha256: 'abc', bytes: 120 },
    });
  });
});
