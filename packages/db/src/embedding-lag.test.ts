import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ContentDocument } from '@alloy-works/domain';

import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import {
  copyPassages,
  embeddingFreshness,
  recordEmbeddingLag,
  routeEmbedding,
  setServingEmbedding,
  storeEmbeddings,
  sweepEmbeddingLag,
  textHash,
} from './embeddings.js';
import { migrate } from './migrate.js';
import { makeModelEndpoint } from './model-endpoints.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { latestVersion, recordVersion } from './versions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const MODEL = 'stand-in-embed-384';

/** Meaning's lag (the FR plan, FR-E): when a latest version became findable by meaning. */
describe("meaning's lag", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let general = '';
  let serving = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const embed = (words: string) =>
    as((trx) =>
      storeEmbeddings(trx, [
        {
          textHash: textHash(words),
          model: MODEL,
          modelVersion: MODEL,
          dims: 384,
          vector: Array.from({ length: 384 }, () => 0.5),
        },
      ]),
    );
  const component = (title: string, words: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        blocks: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: words, marks: [] }],
          },
        ],
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
  const lagOf = (version: string) =>
    as(async (trx) => {
      const { rows } = await sql<{ cut_at: Date; findable_at: Date }>`
        select cut_at, findable_at from embedding_lag where version_id = ${version}`.execute(trx);
      return rows;
    });

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
      general = (await createSpace(trx, 'Lagged')).id;
      const endpoint = (name: string, model: string) =>
        makeModelEndpoint(
          trx,
          {
            name,
            protocol: 'openai',
            baseUrl: 'https://models.example.test',
            model,
            contextWindow: 8192,
            priceIn: 0.02,
            priceOut: 0,
            currency: 'USD',
            boundary: 'inside',
          },
          ada,
        );
      const written = await endpoint('Embedding', MODEL);
      if (written.answer !== 'written') throw new Error(written.answer);
      serving = written.endpoint.id;
      await setServingEmbedding(trx, { model: MODEL, dims: 384, endpointId: serving });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('SCH-067 records a version wholly reused at its indexing, measured from its cut, once', async () => {
    await embed('The north weir floods each spring.');
    const version = await component('Reused', 'The north weir floods each spring.');
    const rows = await lagOf(version.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cut_at).toEqual(version.createdAt);
    expect(rows[0]!.findable_at.getTime()).toBeGreaterThanOrEqual(version.createdAt.getTime());
    // Asked again, the version keeps its first.
    await as((trx) => recordEmbeddingLag(trx, version.artifactId));
    expect(await lagOf(version.id)).toEqual(rows);
    await expect(
      as((trx) => sql`update embedding_lag set findable_at = now()`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it('SCH-067 records a version once its passages are written after the job, and not before', async () => {
    const version = await component('Embedded later', 'A dam on the river.');
    expect(await lagOf(version.id)).toEqual([]);
    await embed('A dam on the river.');
    await as(async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select id from search_entry where artifact_id = ${version.artifactId}`.execute(trx);
      await copyPassages(
        trx,
        rows.map((each) => each.id),
        [{ model: MODEL, dims: 384, endpointId: serving }],
      );
      await recordEmbeddingLag(trx, version.artifactId);
    });
    const rows = await lagOf(version.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cut_at).toEqual(version.createdAt);
  });

  it("SCH-067 records only the artifact's latest version, and only when every entry carries it", async () => {
    const first = await component('Revised', 'The weir was rebuilt.');
    const second = await as(async (trx) => {
      const latest = (await latestVersion(trx, first.artifactId))!;
      const recorded = await recordVersion(trx, {
        artifactId: first.artifactId,
        openedFrom: latest.id,
        author: ada,
        substance: {
          kind: 'component',
          content: { ...(latest.content as ContentDocument), title: 'Revised again' },
          values: latest.values,
          notCarried: [],
          definitions: latest.definitions,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    await embed('The weir was rebuilt.');
    const record = (version: string) =>
      as(async (trx) => {
        await sql`update search_entry set version_id = ${version}
          where artifact_id = ${first.artifactId}`.execute(trx);
        const { rows } = await sql<{ id: string }>`
          select id from search_entry where artifact_id = ${first.artifactId}`.execute(trx);
        await copyPassages(
          trx,
          rows.map((each) => each.id),
          [{ model: MODEL, dims: 384, endpointId: serving }],
        );
        await recordEmbeddingLag(trx, first.artifactId);
      });
    // Entries still naming the older version: nothing, for either.
    await record(first.id);
    expect(await lagOf(first.id)).toEqual([]);
    expect(await lagOf(second.id)).toEqual([]);
    await record(second.id);
    expect(await lagOf(first.id)).toEqual([]);
    expect(await lagOf(second.id)).toHaveLength(1);
  });

  it('SCH-067 measures nothing while a model is pending or with none serving', async () => {
    await embed('Measured by nobody.');
    const pending = await as(async (trx) => {
      const written = await makeModelEndpoint(
        trx,
        {
          name: 'Embedding, newer',
          protocol: 'openai',
          baseUrl: 'https://models.example.test',
          model: 'stand-in-embed-768',
          contextWindow: 8192,
          priceIn: 0.02,
          priceOut: 0,
          currency: 'USD',
          boundary: 'inside',
        },
        ada,
      );
      if (written.answer !== 'written') throw new Error(written.answer);
      await routeEmbedding(trx, { id: written.endpoint.id, model: 'stand-in-embed-768' });
      return written.endpoint.id;
    });
    expect(pending).toBeTruthy();
    const whilePending = await component('While pending', 'Measured by nobody.');
    expect(await lagOf(whilePending.id)).toEqual([]);
    await as((trx) => routeEmbedding(trx, null));
    const unserved = await component('Unserved', 'Measured by nobody.');
    expect(await lagOf(unserved.id)).toEqual([]);
    await as((trx) => setServingEmbedding(trx, { model: MODEL, dims: 384, endpointId: serving }));
  });

  it("SCH-067 answers the last seven days' p95 and most, nearest-rank, and sweeps rows past 30 days", async () => {
    await as((trx) => sql`delete from embedding_lag`.execute(trx));
    expect(await as((trx) => embeddingFreshness(trx))).toEqual({
      versions: 0,
      p95Seconds: null,
      maxSeconds: null,
    });
    const versions: { id: string }[] = [];
    for (let at = 0; at < 22; at++) versions.push(await component(`Sample ${at}`, `Sample ${at}`));
    await as(async (trx) => {
      // Twenty this week lagging 1 to 20 seconds; one eight days ago; one 31 days ago.
      for (const [at, version] of versions.entries()) {
        const ago = at < 20 ? '1 hour' : at === 20 ? '8 days' : '31 days';
        await sql`insert into embedding_lag (version_id, cut_at, findable_at)
          values (${version.id}, now() - ${ago}::interval,
            now() - ${ago}::interval + ${`${at < 20 ? at + 1 : 900} seconds`}::interval)`.execute(
          trx,
        );
      }
    });
    expect(await as((trx) => embeddingFreshness(trx))).toEqual({
      versions: 20,
      p95Seconds: 19,
      maxSeconds: 20,
    });
    expect(await as((trx) => sweepEmbeddingLag(trx))).toBe(1);
    const { rows } = await as((trx) =>
      sql<{ n: string }>`select count(*) as n from embedding_lag`.execute(trx),
    );
    expect(Number(rows[0]!.n)).toBe(21);
  });
});
