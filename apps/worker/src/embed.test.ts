import { randomUUID } from 'node:crypto';
import {
  createComponent,
  createJobQueue,
  createSpace,
  createTenant,
  embedIndexed,
  makeModelEndpoint,
  passageBlocks,
  runsThisMonth,
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
import type { EmbedRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Embedder } from './embedder.js';
import { embedJob } from './jobs/embed.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;

/** A vector of 384 places, its text's length in the first: enough to tell texts apart. */
const vectorOf = (text: string) =>
  Array.from({ length: 384 }, (_, index) => (index === 0 ? text.length : 0.5));

/** An artifact's embedding, from the queue to its passages (the G7 plan, G7-F). */
describe("an artifact's embedding, from the queue to its passages", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let ada = '';
  let general = '';
  const asked: EmbedRequest[] = [];
  const embedder: Embedder = async (request) => {
    asked.push(request);
    return {
      type: 'embedded',
      model: request.call.model,
      vectors: request.call.inputs.map(vectorOf),
      usage: { in: 40 },
    };
  };

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
  const component = (title: string, texts: string[]) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        blocks: texts.map((value, at) => ({
          type: 'paragraph' as const,
          id: `p${at + 1}`,
          style: 'body',
          content: [{ type: 'text' as const, value, marks: [] }],
        })),
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });
  const passages = (artifact: string) => as((trx) => passageBlocks(trx, artifact));

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
      general = (await createSpace(trx, 'Embedded')).id;
      const written = await makeModelEndpoint(
        trx,
        {
          name: 'Embedding',
          protocol: 'openai',
          baseUrl: 'https://models.example.test',
          model: 'stand-in-embed-384',
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
      await setServingEmbedding(trx, {
        model: 'stand-in-embed-384',
        dims: 384,
        endpointId: written.endpoint.id,
      });
    });
  });

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await db?.drop();
  });

  it('GEN-033 embeds a new version in the background, each batch a run of its author, costed, and writes its passages', async () => {
    const sites = await component('Sites', [
      'The north weir floods each spring.',
      'A dam on the river.',
    ]);
    // Found by words at once; by meaning once the job has run.
    expect(await passages(sites)).toEqual([]);
    await work();
    expect(asked.map((each) => each.call.inputs.length)).toEqual([2]);
    expect(await passages(sites)).toEqual(['p1', 'p2']);
    // One run, Ada's, its 40 tokens at 0.02 a million rounding to one millionth of a dollar.
    expect(await as((trx) => runsThisMonth(trx, ada))).toEqual({
      runs: 1,
      costs: [{ currency: 'USD', micros: 1n }],
    });
  });

  it('embeds words held anywhere once: a block whose words are already embedded keeps its meaning at once', async () => {
    const before = asked.length;
    const again = await component('Sites again', [
      'The north weir floods each spring.',
      'Something new.',
    ]);
    // The shared words' passage is written as the version is indexed, before any job.
    expect(await passages(again)).toEqual(['p1']);
    await work();
    expect(asked.slice(before).map((each) => each.call.inputs)).toEqual([['Something new.']]);
    expect(await passages(again)).toEqual(['p1', 'p2']);
  });

  it('queues an artifact once however often it is indexed before its job runs', async () => {
    const often = await component('Often', ['Saved once.']);
    await as((trx) => embedIndexed(trx, often, { queue: true }));
    await as((trx) => embedIndexed(trx, often, { queue: true }));
    expect(await queue.waiting(tenant.id, 'embed')).toEqual([often]);
    await work();
    expect(await queue.waiting(tenant.id, 'embed')).toEqual([]);
  });
});
