import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  OUTLINE_SCHEMA_VERSION,
  type ContentDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { rebuildHistory } from './search-history.js';
import {
  SEARCH_RANK_BOUND,
  searchWords,
  type SearchAnswer,
  type SearchFilters,
  type SearchOptions,
  type SearchRoad,
} from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact, recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';
const text = (value: string) => [{ type: 'text', value, marks: [] }];

type Results = Extract<SearchAnswer, { outcome: 'results' }>;

function resultsOf(answer: SearchAnswer | undefined): Results {
  if (answer?.outcome !== 'results') throw new Error(`Expected results, not ${answer?.outcome}`);
  return answer;
}

/** Every index a JSON plan names, wherever in the plan. */
function indexesIn(plan: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'Index Name' && typeof value === 'string') names.push(value);
        else walk(value);
      }
    }
  };
  walk(plan);
  return names;
}

/** A JSON plan's node types, outermost first, depth first. */
function nodesIn(plan: unknown): string[] {
  const types: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      const { 'Node Type': type, ...rest } = node as Record<string, unknown>;
      if (typeof type === 'string') types.push(type);
      for (const value of Object.values(rest)) walk(value);
    }
  };
  walk(plan);
  return types;
}

/** The width the planner reckons of each sort in a JSON plan. */
function sortWidthsIn(plan: unknown): number[] {
  const widths: number[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record['Node Type'] === 'Sort') widths.push(Number(record['Plan Width']));
      Object.values(record).forEach(walk);
    }
  };
  walk(plan);
  return widths;
}

const ZERO_CHANGED = ['today', 'week', 'month', 'year', 'earlier'].map((value) => ({
  value,
  label: value,
  count: 0,
  capped: false,
}));

describe('search bounded at scale (SV3)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let ivy: string;
  let quality: string;
  let archive: string;
  let approved: string;
  let status: string;
  let general: string;
  let oldYak: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const emptyDocument = (trx: TenantTransaction, spaceId: string, title: string) =>
    createArtifact(trx, {
      author: ada,
      spaceId,
      substance: {
        kind: 'document',
        content: {
          schemaVersion: OUTLINE_SCHEMA_VERSION,
          title,
          language: 'en-GB',
          direction: 'ltr',
          nodes: [],
        },
      } as never,
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      ivy = await person(trx, 'ivy', 'Ivy');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      archive = (await createSpace(trx, 'Archive')).id;
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      for (const space of [general, quality, archive]) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      // Ada reads the tenant, and so its fields; Ivy reads General, where no yak is.
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ivy },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      approved = (
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'field',
            content: {
              schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
              id: randomUUID(),
              name: 'Approved',
              dataType: 'boolean',
              multiplicity: 'one',
              validation: {},
            },
          },
        })
      ).artifactId;

      // 1,100 yak sections in Quality, written to the projection directly: the 950th to the 1,050th
      // changed at one instant, so the bound falls inside a tie; every other one Approved.
      const herd = await emptyDocument(trx, quality, 'Yak herd');
      await sql`
        insert into search_entry
          (artifact_id, kind, node, version_id, space_id, title, owner, changed_at, field_values,
           configuration, body, vector)
        select ${herd.artifactId}::uuid, 'section', 'yak' || n, ${herd.id}::uuid, ${quality}::uuid,
               'Yak ' || n, ${ada}::uuid,
               date_trunc('hour', now()) - least(greatest(n, 950), 1050) * interval '1 s'
                 + case when n > 1050 then (1050 - n) * interval '1 s' else interval '0' end,
               jsonb_build_object(${approved}::text, n % 2 = 0), 'english', 'Yak herding ' || n,
               to_tsvector('english', 'Yak herding ' || n)
        from generate_series(1, 1100) n`.execute(trx);
      // And one long ago in Archive, the best yak match of all.
      const old = await emptyDocument(trx, archive, 'Yak annals');
      oldYak = old.artifactId;
      await sql`
        insert into search_entry
          (artifact_id, kind, node, version_id, space_id, title, owner, changed_at, field_values,
           configuration, body, vector)
        values (${old.artifactId}::uuid, 'section', 'old', ${old.id}::uuid, ${archive}::uuid,
                'Yak yak yak', ${ada}::uuid, now() - interval '3 years',
                jsonb_build_object(${approved}::text, true), 'english',
                'Yak yak yak yak yak', to_tsvector('english', 'Yak yak yak yak yak'))`.execute(trx);
      await sql`
        update search_entry set changed_at = now() - interval '3 years'
        where artifact_id = ${old.artifactId}`.execute(trx);
      await sql`
        insert into search_text (entry_id, place, body, configuration)
        select id, 'title', title, configuration from search_entry
        where kind = 'section' and title ilike 'yak%'`.execute(trx);
      // Gnu: thirty in General, long ago, where Ivy reads, and two hundred newer in Quality, where she
      // may not; and a zebu whose Status is empty.
      status = (
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'field',
            content: {
              schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
              id: randomUUID(),
              name: 'Status',
              dataType: 'text',
              multiplicity: 'one',
              validation: {},
            },
          },
        })
      ).artifactId;
      const herds = await emptyDocument(trx, general, 'Herds');
      await sql`
        insert into search_entry
          (artifact_id, kind, node, version_id, space_id, title, owner, changed_at, field_values,
           configuration, body, vector)
        select ${herds.artifactId}::uuid, 'section', 'gnu' || n, ${herds.id}::uuid,
               case when n <= 30 then ${general}::uuid else ${quality}::uuid end, 'Gnu ' || n, ${ada}::uuid,
               case when n <= 30 then now() - interval '2 days' else now() - n * interval '1 s' end,
               '{}', 'english'::regconfig, 'Gnu grazing', to_tsvector('english', 'Gnu grazing')
        from generate_series(1, 230) n
        union all
        select ${herds.artifactId}::uuid, 'section', 'zebu', ${herds.id}::uuid, ${quality}::uuid,
               'Zebu', ${ada}::uuid, now(), jsonb_build_object(${status}::text, ''), 'english',
               'Zebu', to_tsvector('english', 'Zebu')`.execute(trx);
      // The same words in two configurations.
      const kites = await emptyDocument(trx, quality, 'Kites');
      await sql`
        insert into search_entry
          (artifact_id, kind, node, version_id, space_id, title, owner, changed_at, configuration,
           body, vector)
        values (${kites.artifactId}::uuid, 'section', 'en', ${kites.id}::uuid, ${quality}::uuid,
                'Kites', ${ada}::uuid, now(), 'english', 'Running kites',
                to_tsvector('english', 'Running kites')),
               (${kites.artifactId}::uuid, 'section', 'simple', ${kites.id}::uuid, ${quality}::uuid,
                'Kites', ${ada}::uuid, now(), 'simple', 'Running kites',
                to_tsvector('simple', 'Running kites'))`.execute(trx);
      // Every version reads each place's history, made from these rows as 0091's run makes it.
      await rebuildHistory(trx);
      // Two thousand ibex long ago, so the newest rows are a part of the table: in a
      // space of their own, and in no history, so no other test's estimate counts them.
      const highlands = (await createSpace(trx, 'Highlands')).id;
      const ibex = await emptyDocument(trx, highlands, 'Ibex annals');
      await sql`
        insert into search_entry
          (artifact_id, kind, node, version_id, space_id, title, owner, changed_at, configuration,
           body, vector)
        select ${ibex.artifactId}::uuid, 'section', 'ibex' || n, ${ibex.id}::uuid, ${highlands}::uuid,
               'Ibex ' || n, ${ada}::uuid, now() - interval '3 years' - n * interval '1 s',
               'english', 'Ibex grazing', to_tsvector('english', 'Ibex grazing')
        from generate_series(1, 2000) n`.execute(trx);
    });
    // Statistics, as any tenant past its first hour has them, so the planner weighs the indexes.
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      for (const table of ['search_entry', 'search_text', 'search_history']) {
        await admin.query(`analyze ${admin.escapeIdentifier(production.schema)}.${table}`);
      }
    } finally {
      await admin.end();
    }
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const search = (
    principal: string,
    query: string,
    options: SearchOptions & { readonly scope?: 'latest' | 'all' } = {},
  ) =>
    service
      .withTenant(production, (trx) => searchWords(trx, principal, query, options))
      .then(resultsOf);

  /** The plans of a search's statements, by name, with sequential scans off and the road forced. */
  const plans = (
    query: string,
    road: SearchRoad,
    filters: SearchFilters = {},
    scope: 'latest' | 'all' = 'latest',
  ) =>
    service.withTenant(production, async (trx) => {
      await sql`set local enable_seqscan = off`.execute(trx);
      const seen: Record<string, string[]> = {};
      await searchWords(trx, ada, query, {
        filters,
        scope,
        probe: {
          road,
          explain: true,
          seen: (event) => {
            if (event.plan !== undefined) {
              seen[event.statement] = [...(seen[event.statement] ?? []), ...indexesIn(event.plan)];
            }
          },
        },
      });
      return seen;
    });

  it('finds words through their index on either road, and definitions through theirs', async () => {
    // Beside an `or`, where no part of a word is looked for: a tiny table's trigram index costs more
    // than reading every row, and the planner would weigh that rather than the words' index.
    expect((await plans('running or kites', 'indexes')).results).toContain('search_entry_vector');
    expect((await plans('yak', 'walk')).results).toContain('search_entry_changed');
    expect((await plans('yak', 'indexes')).page).toContain('artifact_version_definitions');
    // A filtered search's facets are a second scan, on the road forced.
    const filtered = await plans('running or kites', 'indexes', { spaces: [quality] });
    expect(filtered.facets).toContain('search_entry_vector');
    // Title terms alone are found through titles' own index.
    expect((await plans('title:yak', 'indexes')).results).toContain('search_text_title');
  });

  it('tests the places of only the newest candidates on the indexes road, never every match', async () => {
    const top: string[][] = [];
    await service.withTenant(production, (trx) =>
      searchWords(trx, ada, 'title:yak', {
        scope: 'all',
        probe: {
          road: 'indexes',
          explain: true,
          seen: (event) => {
            if (event.statement === 'results' && event.plan !== undefined) {
              top.push(nodesIn(event.plan).slice(0, 3));
            }
          },
        },
      }),
    );
    // History's scan: the limit over the places' test over the candidates in order, no sort between.
    expect(top[0]).toEqual(['Limit', 'Subquery Scan', 'Sort']);
  });

  it('sorts the candidates whose places it tests by narrow rows, never their words', async () => {
    for (const [query, scope] of [
      ['title:yak', 'all'],
      ['yak title:yak', 'latest'],
    ] as const) {
      const widths: number[] = [];
      await service.withTenant(production, (trx) =>
        searchWords(trx, ada, query, {
          scope,
          probe: {
            road: 'indexes',
            explain: true,
            seen: (event) => {
              if (event.statement === 'results' && event.plan !== undefined) {
                widths.push(...sortWidthsIn(event.plan));
              }
            },
          },
        }),
      );
      // One sort a scan, each of ids, a node, a flag and two times: under a hundred bytes; with
      // every column, hundreds.
      expect({ query, sorts: widths.length > 0 }).toEqual({ query, sorts: true });
      expect({ query, widths: widths.filter((width) => width >= 100) }).toEqual({
        query,
        widths: [],
      });
    }
  });

  it("finds title terms alone under every version through history's titles, not every place's words", async () => {
    // A title few places hold: a tiny table's other indexes cost no more for one most hold.
    const { results } = await plans('title:herds', 'indexes', {}, 'all');
    expect(results).toContain('search_history_title');
    expect(results).not.toContain('search_history_vector');
  });

  it('finds a kind filtered for through its index, the latest and every version', async () => {
    expect((await plans('yak', 'indexes', { kinds: ['section'] })).results).toContain(
      'search_entry_kind',
    );
    expect((await plans('yak', 'indexes', { kinds: ['section'] }, 'all')).results).toContain(
      'search_history_kind',
    );
  });

  /**
   * The matches the planner reckoned when it chose the road for a statement, and the rows it chose by:
   * the first, as a walk that falls back is seen twice with the same.
   */
  const reckoned = async (
    query: string,
    filters: SearchFilters = {},
    statement: 'results' | 'facets' = 'results',
    scope: 'latest' | 'all' = 'latest',
  ) => {
    const seen: { estimate: number; rows: number }[] = [];
    await search(ada, query, {
      filters,
      scope,
      probe: {
        seen: (event) => {
          if (event.statement === statement && event.estimate !== undefined) {
            seen.push({ estimate: event.estimate, rows: event.rows! });
          }
        },
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    return seen[0]!;
  };
  const estimated = async (...args: Parameters<typeof reckoned>) =>
    (await reckoned(...args)).estimate;

  it('sizes the road to the rows changed since a date, the newest a walk reads, and to the table with an end too', async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const table = (await reckoned('grazing')).rows;
    // The two thousand ibex changed three years ago; the rest since.
    for (const changed of [{ from: since }, { within: 'year' as const }]) {
      const { rows } = await reckoned('grazing', { changed });
      expect({ changed, rows }).toEqual({ changed, rows: expect.any(Number) });
      expect(rows).toBeLessThan(table / 2);
    }
    expect((await reckoned('grazing', { changed: { from: since, to: '2999-12-31' } })).rows).toBe(
      table,
    );
  });

  it('reckons a query of title terms alone as matching as many as it does, choosing its road by them', async () => {
    // Over 1,100 titles hold yak; testing the term twice, the planner reckoned a few dozen.
    expect(await estimated('title:yak')).toBeGreaterThan(500);
  });

  it('reckons a query of title terms alone under every version by titles alone', async () => {
    // Herding is in every yak's words and no title: reckoned by every place's words, over a thousand.
    expect(await estimated('title:herding', {}, 'results', 'all')).toBeLessThan(20);
    expect(await estimated('title:yak', {}, 'results', 'all')).toBeGreaterThan(500);
  });

  it('reckons a filtered search as matching as few as it does, choosing its road by them', async () => {
    // One yak section in Archive; filters the planner could not read, it reckoned hundreds.
    expect(await estimated('yak', { kinds: ['section'], spaces: [archive] })).toBeLessThan(20);
  });

  it('reckons the facets under one filter as the matches, which all fail at most it', async () => {
    // Read as a sum of failed filters, the planner reckoned a third of them.
    expect(await estimated('yak', { kinds: ['section'] }, 'facets')).toBe(await estimated('yak'));
  });

  it('finds nothing by a filter of an identifier of no shape, and ignores one beside others', async () => {
    expect((await search(ada, 'yak', { filters: { spaces: ['not an id'] } })).count).toBe(0);
    expect(
      await search(ada, 'yak', { filters: { spaces: ['NOT AN ID', archive], owners: ['x', ada] } }),
    ).toEqual(await search(ada, 'yak', { filters: { spaces: [archive], owners: [ada] } }));
  });

  it('finds a word in each configuration it is written in', async () => {
    const found = await search(ada, 'running');
    expect(found.items.map((each) => each.node).sort()).toEqual(['en', 'simple']);
  });

  const bothRoads = async (scope: 'latest' | 'all', query = 'yak') => {
    for (const filters of [
      {},
      { values: [{ field: approved, value: 'true' }] },
      { kinds: ['section' as const], spaces: [quality, archive] },
    ] satisfies SearchFilters[]) {
      for (let offset = 0; offset <= 1000; offset += 50) {
        const [walk, indexes] = await Promise.all(
          (['walk', 'indexes'] as const).map((road) =>
            search(ada, query, { scope, offset, limit: 50, filters, probe: { road } }),
          ),
        );
        expect({ filters, offset, answer: walk }).toEqual({ filters, offset, answer: indexes });
      }
    }
  };

  it('returns the same page, total and facets on either road, every page, filtered and not', async () => {
    await bothRoads('latest');
  });

  it('returns the same page, total and facets on either road under every version, every page, filtered and not', async () => {
    await bothRoads('all');
  });

  it('returns the same page, total and facets on either road under every version for title terms alone, every page, filtered and not', async () => {
    await bothRoads('all', 'title:yak');
  });

  it('returns the same page, total and facets on either road for words and a scoped term, every page, filtered and not', async () => {
    await bothRoads('latest', 'yak title:yak');
  });

  it('returns the same page, total and facets on either road under every version for words and a scoped term, every page, filtered and not', async () => {
    await bothRoads('all', 'yak title:yak');
  });

  const nothingFor = async (scope: 'latest' | 'all', road?: SearchRoad) => {
    for (const filters of [
      {},
      { spaces: [quality, archive] },
      { kinds: ['section' as const], values: [{ field: approved, value: 'true' }] },
    ] satisfies SearchFilters[]) {
      for (const query of ['yak', 'title:yak', 'yak -herding', 'yak or quagga']) {
        const options = { scope, filters, ...(road === undefined ? {} : { probe: { road } }) };
        // Not vacuous: Ada, who may read them, finds them.
        expect((await search(ada, query, options)).count).toBeGreaterThan(0);
        expect({ query, filters, answer: await search(ivy, query, options) }).toEqual({
          query,
          filters,
          answer: {
            outcome: 'results',
            count: 0,
            capped: false,
            facetsBounded: false,
            items: [],
            facets: {
              kinds: [],
              spaces: [],
              componentTypes: [],
              owners: [],
              changed: ZERO_CHANGED,
              fields: [],
            },
          },
        });
      }
    }
  };

  it('SCH-010 finds nothing, counts and facets included, a user may not read on the walk road', async () => {
    await nothingFor('latest', 'walk');
  });

  it('SCH-010 finds nothing, counts and facets included, a user may not read on the indexes road', async () => {
    await nothingFor('latest', 'indexes');
  });

  it('SCH-010 finds nothing, counts and facets included, a user may not read under every version on the walk road', async () => {
    await nothingFor('all', 'walk');
  });

  it('SCH-010 finds nothing, counts and facets included, a user may not read under every version on the indexes road', async () => {
    await nothingFor('all', 'indexes');
  });

  it('SCH-010 finds nothing, counts and facets included, a user may not read under every version on the road chosen', async () => {
    await nothingFor('all');
  });

  it('finds the current rows of the kinds history does not hold by their indexes, never walking every current row', async () => {
    for (const road of [undefined, 'walk', 'indexes'] as const) {
      const scans: string[] = [];
      await search(ada, 'yak', {
        scope: 'all',
        probe: {
          ...(road === undefined ? {} : { road }),
          seen: (event) => {
            if (event.road !== undefined && event.scan === 'search_entry') scans.push(event.road);
          },
        },
      });
      expect({ road, scans }).toEqual({ road, scans: ['indexes'] });
    }
  });

  it('bounds every version as it bounds the latest, its facets past the bound lower bounds', async () => {
    for (const road of ['walk', 'indexes'] as const) {
      const all = await search(ada, 'yak', { scope: 'all', probe: { road } });
      expect([all.count, all.capped, all.facetsBounded]).toEqual([SEARCH_RANK_BOUND, true, true]);
      expect(all.facets.kinds.every((each) => each.capped)).toBe(true);
    }
  });

  it('finds, under a filter, a match older than the newest 1,000 (SV3-D)', async () => {
    for (const road of ['walk', 'indexes'] as const) {
      const unfiltered = await search(ada, 'yak', { probe: { road } });
      expect(unfiltered.facetsBounded).toBe(true);
      const filtered = await search(ada, 'yak', {
        filters: { spaces: [archive], kinds: ['section'] },
        probe: { road },
      });
      expect(filtered.items.map((each) => [each.artifactId, each.node])).toEqual([[oldYak, 'old']]);
      expect([filtered.count, filtered.capped]).toEqual([1, false]);
      // The facet the reader chose counts at least what the results do.
      expect(filtered.facets.spaces.find((each) => each.value === archive)?.count).toBe(1);
    }
  });

  it('ranks only the 1,000 changed most recently past 1,000 matches, so a better match changed earlier is not on the first page (SV3-C)', async () => {
    for (const road of ['walk', 'indexes'] as const) {
      const page = await search(ada, 'yak', { limit: 50, probe: { road } });
      expect([page.count, page.capped]).toEqual([SEARCH_RANK_BOUND, true]);
      expect(page.items.map((each) => each.node)).not.toContain('old');
    }
  });

  it('plans every search for its own parameters', async () => {
    const mode = await service.withTenant(production, async (trx) => {
      await searchWords(trx, ada, 'yak');
      return (
        await sql<{ mode: string }>`select current_setting('plan_cache_mode') as mode`.execute(trx)
      ).rows[0]!.mode;
    });
    expect(mode).toBe('force_custom_plan');
  });

  it('never compiles a search, which costs more than running it', async () => {
    const jit = await service.withTenant(production, async (trx) => {
      await searchWords(trx, ada, 'yak', { scope: 'all' });
      return (await sql<{ jit: string }>`select current_setting('jit') as jit`.execute(trx))
        .rows[0]!.jit;
    });
    expect(jit).toBe('off');
  });

  it('looks for a term under 3 characters as part of a word only beside a longer term', async () => {
    const cart = await service.withTenant(production, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: quality,
        title: 'Ox cart',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...(substance.content as ContentDocument),
            content: [{ type: 'paragraph', id: 'b1', style: 'body', content: text('Wheelwright') }],
          } as ContentDocument,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return made.version.artifactId;
    });
    const found = async (query: string) =>
      (await search(ada, query)).items.map((each) => each.artifactId);
    expect(await found('ox')).toEqual([cart]);
    expect(await found('car')).toEqual([cart]);
    expect(await found('ca')).toEqual([]);
    // Beside a longer term it narrows that term's part of a word, which the trigram index answers.
    expect(await found('wheel ca')).toEqual([cart]);
    expect(await found('wheel cx')).toEqual([]);
  });

  it('finds by scoped terms alone, on either road', async () => {
    for (const road of ['walk', 'indexes'] as const) {
      const found = await search(ada, 'title:yak', {
        filters: { spaces: [archive], kinds: ['section'] },
        probe: { road },
      });
      expect(found.items.map((each) => [each.artifactId, each.node])).toEqual([[oldYak, 'old']]);
    }
  });

  it('falls back from a walk that finds too few among the newest rows it reads to the indexes road, with the same answer', async () => {
    const roads: SearchRoad[] = [];
    const walked = await search(ivy, 'gnu', {
      probe: {
        road: 'walk',
        reads: 100,
        seen: (event) => {
          if (event.road !== undefined) roads.push(event.road);
        },
      },
    });
    // The newest hundred rows are Quality's, which Ivy may not read: the walk finds none of hers.
    expect(roads).toEqual(['walk', 'indexes']);
    expect(walked).toEqual(await search(ivy, 'gnu', { probe: { road: 'indexes' } }));
    expect([walked.count, walked.capped]).toEqual([30, false]);
  });

  it('filters by no empty value of a field, which no facet offers', async () => {
    const found = await search(ada, 'zebu', {
      filters: { values: [{ field: status, value: '' }] },
    });
    expect(found.items).toEqual([]);
  });
});
