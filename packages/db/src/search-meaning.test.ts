import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { copyPassages, storeEmbeddings, textHash, vectorLiteral } from './embeddings.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { searchMeaning, type MeaningHit, type MeaningRoad } from './search-meaning.js';
import { searchWords } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const MODEL = 'embed-384';

/** A unit vector leaning `lean` of the way from the first place towards the second. */
const towards = (lean: number) =>
  Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 - lean : index === 1 ? lean : 0));

describe('searching by meaning (the G7 plan, G7-H and G7-I)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let ivy = '';
  let open = '';
  let closed = '';
  const parts = new Map<string, string>();

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** A component of one block in a space, its block's vector `vector`, its passage written. */
  const part = (space: string, title: string, words: string, vector: number[]) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
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
      const { rows } = await sql<{ id: string; body: string }>`
        select e.id, st.body from search_entry e join search_text st on st.entry_id = e.id
         where e.artifact_id = ${made.version.artifactId} and st.place = 'block:p1'`.execute(trx);
      await storeEmbeddings(trx, [
        { textHash: textHash(rows[0]!.body), model: MODEL, modelVersion: MODEL, dims: 384, vector },
      ]);
      await copyPassages(
        trx,
        rows.map((row) => row.id),
        [{ model: MODEL, dims: 384, endpointId: '00000000-0000-4000-8000-000000000000' }],
      );
      parts.set(title, made.version.artifactId);
      return made.version.artifactId;
    });
  const meaning = (who: string, road?: MeaningRoad, filters?: { kinds?: string[] }) =>
    as((trx) =>
      searchMeaning(trx, who, {
        vector: towards(0),
        model: MODEL,
        dims: 384,
        ...(road === undefined ? {} : { road }),
        ...(filters === undefined ? {} : { filters }),
      }),
    ) as Promise<MeaningHit[]>;

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
      const person = async (subject: string, name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada', 'Ada');
      ivy = await person('ivy', 'Ivy');
      open = (await createSpace(trx, 'Open')).id;
      closed = (await createSpace(trx, 'Closed')).id;
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      for (const space of [open, closed]) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      // Ivy reads Open alone.
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ivy },
        level: { kind: 'space', id: open },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    // What Ivy may not read lies nearest the query; what she may, further off.
    await part(closed, 'Confidential weir', 'A confidential note on the north weir.', towards(0));
    await part(open, 'Sites', 'The north weir floods each spring.', towards(0.1));
    await part(open, 'Dams', 'A dam holds back the river.', towards(0.2));
    await part(open, 'Gardens', 'Roses and tulips in the borders.', towards(0.5));
    // Sharing nothing with the query: past the farthest meaning finds.
    await part(open, 'Elsewhere', 'Invoices are due monthly.', towards(1));
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('SCH-013 finds by meaning over what the reader may read, sharing the words’ permission filter, nearest first', async () => {
    for (const road of ['exact', 'index'] as const) {
      const hits = await meaning(ivy, road);
      const titles = await as(async (trx) => {
        const { rows } = await sql<{ id: string; title: string }>`
          select id, title from search_entry where id = any(${hits.map((each) => each.entry)}::uuid[])`.execute(
          trx,
        );
        const byId = new Map(rows.map((row) => [row.id, row.title]));
        return hits.map((each) => byId.get(each.entry));
      });
      expect(titles, road).toEqual(['Sites', 'Dams', 'Gardens']);
      expect(hits[0]!.block, road).toBe('p1');
    }
    // Ada reads both spaces, and finds the confidential part first.
    expect((await meaning(ada, 'exact')).length).toBe(4);
  });

  it('SCH-013 finds nothing archived or deleted by meaning, as by words', async () => {
    await as((trx) =>
      sql`update search_entry set archived = true where artifact_id = ${parts.get('Dams')!}`.execute(
        trx,
      ),
    );
    try {
      const hits = await meaning(ivy, 'exact');
      expect(hits).toHaveLength(2);
    } finally {
      await as((trx) =>
        sql`update search_entry set archived = false where artifact_id = ${parts.get('Dams')!}`.execute(
          trx,
        ),
      );
    }
  });

  it('SCH-014 labels each result by how it was found, words, meaning or both, in one list fused by rank', async () => {
    const hits = await meaning(ivy, 'exact');
    const answer = await as((trx) => searchWords(trx, ivy, 'weir', { meaning: hits }));
    if (answer === undefined || answer.outcome !== 'results') {
      throw new Error('no results');
    }
    const found = new Map(answer.items.map((each) => [each.title, each.found]));
    // Found both ways first, then by meaning alone; the count holds both, the facets the words' alone.
    expect(answer.items[0]!.title).toBe('Sites');
    expect(found.get('Sites')).toBe('both');
    expect(found.get('Dams')).toBe('meaning');
    expect(found.get('Confidential weir')).toBeUndefined();
    expect(answer.count).toBe(answer.items.length);
    expect(answer.facets.kinds).toEqual([
      expect.objectContaining({ value: 'component', count: 1 }),
    ]);
    // What meaning alone found shows the block it found.
    expect(answer.items.find((each) => each.title === 'Dams')?.place).toBe('block:p1');
  });

  it('SCH-035 applies the changed filter as meaning scans, so none older than asked is among its best', async () => {
    const hits = await as((trx) =>
      searchMeaning(trx, ivy, {
        vector: towards(0),
        model: MODEL,
        dims: 384,
        filters: { changed: { within: 'earlier' } },
      }),
    );
    expect(hits).toEqual([]);
  });

  it('pages the words past their best fifty after what was fused, so every match the count says is reachable', async () => {
    for (let at = 0; at < 55; at += 1) {
      await part(open, `Weir note ${at}`, `Weir note number ${at}.`, towards(1));
    }
    const hits = await meaning(ivy, 'exact');
    const pages = await as(async (trx) => {
      const first = await searchWords(trx, ivy, 'weir', { meaning: hits, limit: 50 });
      const second = await searchWords(trx, ivy, 'weir', { meaning: hits, limit: 50, offset: 50 });
      return [first, second];
    });
    const [first, second] = pages.map((each) =>
      each !== undefined && each.outcome === 'results' ? each : undefined,
    );
    const seen = new Set([...first!.items, ...second!.items].map((each) => each.artifactId));
    expect(seen.size).toBe(first!.count);
  });

  it('SCH-035 gives a reader who sees a sliver a full page by meaning, though the nearest overall are hidden from them', async () => {
    // Three thousand passages nearest the query, all in Closed: an index alone, stopping at its
    // nearest, would hand Ivy nothing.
    await as(async (trx) => {
      const hidden = parts.get('Confidential weir')!;
      const { rows } = await sql<{ id: string }>`
        select id from search_entry where artifact_id = ${hidden}`.execute(trx);
      await sql`insert into search_passage (entry_id, block_id, text_hash, model, dims, vector)
        select ${rows[0]!.id}::uuid, 'h' || n, ${'0'.repeat(64)}, ${MODEL}, 384,
               ${vectorLiteral(towards(0))}::extensions.halfvec
          from generate_series(1, 3000) n`.execute(trx);
    });
    for (const road of ['index', 'exact'] as const) {
      expect((await meaning(ivy, road)).length, road).toBe(3);
    }
  });

  it('scans the vector index of the dimension a search names, never every passage, above the threshold', async () => {
    const plan = await as(async (trx) => {
      await sql`set local enable_seqscan = off`.execute(trx);
      const { rows } = await sql<{ 'QUERY PLAN': string }>`
        explain select entry_id from search_passage p where p.dims = 384
        order by (p.vector::extensions.halfvec(384)) operator(extensions.<=>)
                 ${vectorLiteral(towards(0))}::extensions.halfvec(384)
        limit 10`.execute(trx);
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('search_passage_384');
  });
});
