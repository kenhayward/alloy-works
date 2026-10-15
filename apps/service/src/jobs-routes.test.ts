import { failJob } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

/** Jobs through the API (the R3 plan, R3-B to R3-E). Grace reads General; Ada submits. */
describe('jobs, and the impact report', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  const submit = (subject: string, key?: string) =>
    h.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${subject}/impact-reports`,
      headers: {
        host: HOST,
        cookie: h.cookies.ada!,
        ...(key === undefined ? {} : { 'idempotency-key': key }),
      },
      payload: { depth: 3 },
    });

  it('API-040 API-041 answers a submitted job at once, accepted, and reads it to its requester alone', async () => {
    const component = await h.component(h.general, 'Calibrate');
    const made = await submit(component.id);
    expect(made.statusCode, made.body).toBe(200);
    const job = made.json<{ id: string }>();
    expect(job).toMatchObject({
      kind: 'impact_report',
      subject: component.id,
      parameters: { depth: 3 },
      state: 'accepted',
      startedAt: null,
      finishedAt: null,
      progress: null,
      cancelRequested: false,
      failure: null,
      outcome: null,
      result: null,
    });
    const read = await h.call('ada', 'GET', `/v1/jobs/${job.id}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual(made.json());
    expect((await h.call('grace', 'GET', `/v1/jobs/${job.id}`)).statusCode).toBe(404);
    expect((await h.call('grace', 'POST', `/v1/jobs/${job.id}/cancel`)).statusCode).toBe(404);
  });

  it('API-057 answers a retried submission with the job the first made, starting no second', async () => {
    const component = await h.component(h.general, 'Prime');
    const first = await submit(component.id, 'report-once');
    const again = await submit(component.id, 'report-once');
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    const { rows } = await queryAs(
      h.db.adminUrl,
      `select count(*)::int as count from ${h.tenant.schema}.api_job where subject_id = $1`,
      [component.id],
    );
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('API-042 cancels a job not yet run, having done nothing, and refuses one finished', async () => {
    const component = await h.component(h.general, 'Drain');
    const job = (await submit(component.id)).json<{ id: string }>();
    const cancelled = await h.call('ada', 'POST', `/v1/jobs/${job.id}/cancel`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({
      state: 'cancelled',
      outcome: { depthsWalked: 0, depthsAsked: 3, reached: 0, cut: false },
    });
    const again = await h.call('ada', 'POST', `/v1/jobs/${job.id}/cancel`);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'job_finished' });
    const download = await h.call('ada', 'GET', `/v1/jobs/${job.id}/download`);
    expect(download.statusCode).toBe(409);
    expect(download.json()).toMatchObject({ code: 'job_not_ready' });
  });

  it('API-043 reads a failed job after, its failure in an error shape', async () => {
    const component = await h.component(h.general, 'Flush');
    const job = (await submit(component.id)).json<{ id: string }>();
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      failJob(trx, job.id, {
        code: 'job_failed',
        message: 'The report could not be made. Ask for it again.',
      }),
    );
    const read = await h.call('ada', 'GET', `/v1/jobs/${job.id}`);
    expect(read.json()).toMatchObject({
      state: 'failed',
      failure: { code: 'job_failed', message: 'The report could not be made. Ask for it again.' },
    });
    expect(read.json<{ finishedAt: string | null }>().finishedAt).not.toBeNull();
  });

  it('refuses a depth not from 1 to 10, and an artifact the caller may not read', async () => {
    const component = await h.component(h.general, 'Bounded');
    const deep = await h.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${component.id}/impact-reports`,
      headers: { host: HOST, cookie: h.cookies.ada! },
      payload: { depth: 11 },
    });
    expect(deep.statusCode).toBe(400);
    const hidden = await h.component(h.quality, 'Hidden');
    const refused = await h.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${hidden.id}/impact-reports`,
      headers: { host: HOST, cookie: h.cookies.grace! },
      payload: { depth: 1 },
    });
    expect(refused.statusCode).toBe(404);
  });
});
