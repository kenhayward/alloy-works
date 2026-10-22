import { randomUUID } from 'node:crypto';
import {
  createComponent,
  createJobQueue,
  createSpace,
  createTenant,
  makeModelEndpoint,
  migrate,
  prepareDatabase,
  setModelCredential,
  setServingEmbedding,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Embedder } from './embedder.js';
import { embedJob } from './jobs/embed.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

/**
 * SCH-067's budget (the FR plan, FR-E), held provisionally as the pipeline's: 60 seconds at p95 and
 * none above five minutes. The embedder here is an instant fake, so this shows the bookkeeping, not a
 * provider's latency. Twenty measured, nearest-rank, as CNT-186's.
 */
const BUDGET = { p95: 60, max: 300 } as const;
const SAMPLES = 20;
const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;
const MODEL = 'stand-in-embed-384';

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("meaning's lag, from a version's cut to its passages (the FR plan, FR-E)", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let ada = '';
  let general = '';
  const embedder: Embedder = async (request) => ({
    type: 'embedded',
    model: request.call.model,
    vectors: request.call.inputs.map((text) =>
      Array.from({ length: 384 }, (_, index) => (index === 0 ? text.length : 0.5)),
    ),
    usage: { in: 40 },
  });

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  /** The worker's loop, woken at once: every job waiting, until none is. */
  const drain = async () => {
    for (;;) {
      const outcome = await processNext({
        queue,
        db: worker,
        handlers,
        workerId: 'worker-1',
        leaseMs: 600_000,
        log: quiet,
      });
      if (outcome === 'idle') return;
    }
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    handlers = { embed: embedJob({ db: worker, embedder }) };
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
      general = (await createSpace(trx, 'Measured')).id;
      const written = await makeModelEndpoint(
        trx,
        {
          name: 'Embedding',
          protocol: 'openai',
          baseUrl: 'https://models.example.test',
          model: MODEL,
          contextWindow: 8192,
          priceIn: 0.02,
          priceOut: 0,
          currency: 'USD',
          boundary: 'inside',
        },
        ada,
      );
      if (written.answer !== 'written') throw new Error(written.answer);
      await setModelCredential(trx, written.endpoint, SEALED, ada);
      await setServingEmbedding(trx, { model: MODEL, dims: 384, endpointId: written.endpoint.id });
    });
  });

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await db?.drop();
  });

  it('SCH-067 measures every version cut from its cut to its passages, and reports them against the stated budget', async () => {
    const cut: { id: string; createdAt: Date }[] = [];
    for (let at = 0; at < SAMPLES; at++) {
      const version = await as(async (trx) => {
        const made = await createComponent(trx, {
          spaceId: general,
          title: `Measured ${at}`,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
          blocks: [1, 2, 3].map((n) => ({
            type: 'paragraph' as const,
            id: `p${n}`,
            style: 'body',
            content: [
              { type: 'text' as const, value: `Weir ${at}, paragraph ${n}, new words.`, marks: [] },
            ],
          })),
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version;
      });
      cut.push(version);
      await drain();
    }
    // As the cluster holds them: the tenant's role answers through no reader of its own.
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    const { rows } = await admin
      .query<{ version_id: string; cut_at: Date; findable_at: Date }>(
        `select version_id, cut_at, findable_at from "${tenant.schema}".embedding_lag`,
      )
      .finally(() => admin.end());
    // Every version measured, from its cut.
    expect(new Map(rows.map((row) => [row.version_id, row.cut_at]))).toEqual(
      new Map(cut.map((each) => [each.id, each.createdAt])),
    );
    const lags = rows.map((row) => (row.findable_at.getTime() - row.cut_at.getTime()) / 1000);
    expect(lags.every((lag) => lag >= 0)).toBe(true);
    expect(percentile(lags, 95)).toBeLessThanOrEqual(BUDGET.p95);
    expect(Math.max(...lags)).toBeLessThanOrEqual(BUDGET.max);
  });
});
