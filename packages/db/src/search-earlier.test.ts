import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  blockIdentifierFrom,
  DEFINITION_SCHEMA_VERSION,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact } from './archival.js';
import { makeBaseline } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { createDocument } from './documents.js';
import { ERASED_NAME, erasePerson } from './erasure.js';
import { grant } from './grants.js';
import { invite } from './invitations.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { indexVersion, reindexSearch } from './search.js';
import { searchWords, type SearchAnswer } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
  beforeTheLogDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const words = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: words(value),
});

function resultsOf(answer: SearchAnswer | 'baseline_not_found' | undefined) {
  if (answer === undefined || answer === 'baseline_not_found' || answer.outcome !== 'results') {
    throw new Error(`Expected results, not ${JSON.stringify(answer)}`);
  }
  return answer;
}

const numberOf = (version: StoredVersion) => `${version.revision}.${version.version}`;

describe('searching earlier versions and baselines', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let ivy: string;
  let general: string;
  let quality: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const component = (space: string, author: string, title: string) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const revise = (version: StoredVersion, text: string) =>
    tenant(async (trx) => {
      const substance = substanceOf(version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: version.author!,
        substance: {
          ...substance,
          content: {
            ...(substance.content as ContentDocument),
            content: [para('b1', text)],
          } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const document = (author: string, title: string) =>
    tenant(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const outline = (version: StoredVersion, nodes: OutlineNode[]) =>
    tenant(async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: version.author!,
        substance: {
          kind: 'document',
          content: { ...(version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const reference = (component: string, id = nodeId()): OutlineNode => ({
    type: 'reference',
    id,
    component,
    mode: { kind: 'latest' },
    ...base,
    children: [],
  });
  const section = (title: string, id = nodeId()): OutlineNode => ({
    type: 'section',
    id,
    title: words(title),
    ...base,
    children: [],
  });

  const baseline = (version: StoredVersion, name: string, maker: string) =>
    tenant(async (trx) => {
      const made = await makeBaseline(trx, {
        documentId: version.artifactId,
        version: version.id,
        name,
        maker,
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return { id: made.baseline };
    });

  const search = (
    principal: string,
    query: string,
    scope?: 'latest' | 'all' | { readonly baseline: string },
  ) => tenant((trx) => searchWords(trx, principal, query, scope === undefined ? {} : { scope }));

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
    await tenant(async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      // Ivy has signed in and been granted nothing.
      ivy = await person(trx, 'ivy', 'Ivy');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada authors General; Grace authors General and Quality, which Ada may not read.
      for (const [principal, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('SCH-003 finds a word only in an earlier version under all, naming that version, and never by default', async () => {
    const first = await component(general, ada, 'Gauge notes');
    const second = await revise(first, 'The quokka habitat');
    const third = await revise(second, 'The wombat burrow');

    expect(resultsOf(await search(ada, 'quokka')).items).toEqual([]);
    expect(resultsOf(await search(ada, 'quokka', 'latest')).items).toEqual([]);
    const earlier = resultsOf(await search(ada, 'quokka', 'all'));
    expect(earlier.items).toMatchObject([
      {
        artifactId: first.artifactId,
        place: 'block:b1',
        version: { id: second.id, number: numberOf(second), latest: false },
        baseline: null,
      },
    ]);
    expect(resultsOf(await search(ada, 'wombat', 'all')).items).toMatchObject([
      { version: { id: third.id, number: numberOf(third), latest: true } },
    ]);
    // Its title in all three versions: one result, at its newest, counted once.
    const titled = resultsOf(await search(ada, 'gauge', 'all'));
    expect(titled.items).toHaveLength(1);
    expect(titled.items[0]).toMatchObject({ version: { id: third.id, latest: true } });
    expect(titled.count).toBe(1);
    expect(titled.facets.kinds).toEqual([
      { value: 'component', label: 'component', count: 1, capped: false },
    ]);
    expect(titled.facets.changed.find((each) => each.value === 'today')?.count).toBe(1);
  });

  it('keeps each moved row as it was, and keeps nothing for a version indexed again', async () => {
    const first = await component(general, ada, 'Kept rows');
    const entry = await tenant((trx) =>
      trx
        .selectFrom('search_entry')
        .select('id')
        .where('artifact_id', '=', first.artifactId)
        .executeTakeFirstOrThrow(),
    );
    // Indexed again at the same version, as a dataset's image is (assets.ts): nothing kept.
    await tenant((trx) => indexVersion(trx, first));
    const again = await tenant((trx) =>
      trx
        .selectFrom('search_earlier')
        .select('id')
        .where('artifact_id', '=', first.artifactId)
        .execute(),
    );
    expect(again).toEqual([]);
    const current = await tenant((trx) =>
      trx
        .selectFrom('search_entry')
        .select('id')
        .where('artifact_id', '=', first.artifactId)
        .executeTakeFirstOrThrow(),
    );
    await revise(first, 'The numbat');
    const kept = await tenant((trx) =>
      trx
        .selectFrom('search_earlier as e')
        .leftJoin('search_earlier_text as t', 't.entry_id', 'e.id')
        .select(['e.id', 'e.version_id', 't.place'])
        .where('e.artifact_id', '=', first.artifactId)
        .execute(),
    );
    expect(entry.id).not.toBe(current.id);
    expect(kept).toEqual([{ id: current.id, version_id: first.id, place: 'title' }]);
  });

  it('SCH-003 finds a word in a baseline that pins its version, and not in one that does not', async () => {
    const pinned = await revise(await component(general, ada, 'Survey'), 'The bilby count');
    const node = nodeId();
    const findings = nodeId();
    const placed = await outline(await document(ada, 'Field report'), [
      section('Dunnart findings', findings),
      reference(pinned.artifactId, node),
    ]);
    const approved = await baseline(placed, 'Approved', ada);
    const later = await revise(pinned, 'The bandicoot count');
    const moved = await outline(placed, [
      section('Quoll findings', findings),
      reference(pinned.artifactId, node),
    ]);
    const final = await baseline(moved, 'Final', ada);

    expect(resultsOf(await search(ada, 'bilby')).items).toEqual([]);
    expect(resultsOf(await search(ada, 'bilby', { baseline: approved.id })).items).toMatchObject([
      {
        kind: 'component',
        artifactId: pinned.artifactId,
        version: { id: pinned.id, latest: false },
        baseline: { id: approved.id, name: 'Approved', document: placed.artifactId, node },
      },
    ]);
    expect(resultsOf(await search(ada, 'bilby', { baseline: final.id })).items).toEqual([]);
    expect(resultsOf(await search(ada, 'bandicoot', { baseline: final.id })).items).toMatchObject([
      { artifactId: pinned.artifactId, version: { id: later.id, latest: true } },
    ]);
    // A section's words at the version the baseline pins.
    expect(resultsOf(await search(ada, 'dunnart', { baseline: approved.id })).items).toMatchObject([
      {
        kind: 'section',
        node: findings,
        version: { id: placed.id, latest: false },
        baseline: { id: approved.id, node: findings },
      },
    ]);
    expect(resultsOf(await search(ada, 'dunnart')).items).toEqual([]);
    expect(resultsOf(await search(ada, 'dunnart', { baseline: final.id })).items).toEqual([]);

    // Archived: out of every version's search, still in its baseline (LIF-020).
    await tenant((trx) => archiveArtifact(trx, pinned.artifactId, ada));
    expect(resultsOf(await search(ada, 'bilby', 'all')).items).toEqual([]);
    expect(resultsOf(await search(ada, 'bandicoot', 'all')).items).toEqual([]);
    expect(resultsOf(await search(ada, 'bilby', { baseline: approved.id })).items).toHaveLength(1);
  });

  it('SCH-010 SCH-032 withholds from a baseline search a pin its reader may not read, from results, counts and facets', async () => {
    const hidden = await revise(await component(quality, grace, 'Platypus'), 'The echidna den');
    const shown = await revise(await component(general, grace, 'Wallaby'), 'The echidna trail');
    const placed = await outline(await document(grace, 'Monotremes'), [
      reference(hidden.artifactId),
      reference(shown.artifactId),
    ]);
    const made = await baseline(placed, 'Reviewed', grace);

    const seen = resultsOf(await search(ada, 'echidna', { baseline: made.id }));
    expect(seen.items.map((each) => each.artifactId)).toEqual([shown.artifactId]);
    expect(seen.count).toBe(1);
    expect(seen.facets.spaces.map((each) => each.value)).toEqual([general]);

    // A word only the withheld pin holds: nothing found, nothing counted.
    const none = resultsOf(await search(ada, 'den', { baseline: made.id }));
    expect(none.items).toEqual([]);
    expect(none.count).toBe(0);
    expect(none.facets.kinds).toEqual([]);
    expect(none.facets.spaces).toEqual([]);
    expect(none.facets.fields).toEqual([]);
    expect(none.facets.changed.every((each) => each.count === 0)).toBe(true);

    // A reader of nothing: every version holds nothing for them, and the baseline is none.
    const nothing = resultsOf(await search(ivy, 'echidna', 'all'));
    expect(nothing.items).toEqual([]);
    expect(nothing.count).toBe(0);
    expect(nothing.facets.kinds).toEqual([]);
    expect(await search(ivy, 'echidna', { baseline: made.id })).toBe('baseline_not_found');
    expect(await search(ada, 'echidna', { baseline: 'not-an-id' })).toBe('baseline_not_found');
    expect(await search(ada, 'echidna', { baseline: '00000000-0000-4000-8000-000000000000' })).toBe(
      'baseline_not_found',
    );
  });

  it('reads no union for the latest version alone', async () => {
    const statements: string[] = [];
    const spied = (trx: TenantTransaction): TenantTransaction =>
      new Proxy(trx, {
        get(target, key) {
          if (key === 'getExecutor') {
            return () => {
              const executor = target.getExecutor();
              return new Proxy(executor, {
                get(inner, name) {
                  const value = Reflect.get(inner, name) as unknown;
                  if (name === 'executeQuery') {
                    return (query: { sql: string }, ...rest: unknown[]) => {
                      statements.push(query.sql);
                      return (value as (...args: unknown[]) => unknown).call(inner, query, ...rest);
                    };
                  }
                  return typeof value === 'function' ? value.bind(inner) : value;
                },
              });
            };
          }
          const value = Reflect.get(target, key) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const statement = async (scope: 'latest' | 'all') => {
      statements.length = 0;
      await tenant((trx) => searchWords(spied(trx), ada, 'gauge', { scope }));
      // The search itself, not a check of the schema it runs on.
      return statements.find((each) => each.includes('readable_fields')) ?? '';
    };
    expect(await statement('latest')).not.toMatch(/union|search_earlier/iu);
    expect(await statement('all')).toMatch(/union all/iu);
  });

  it("writes every earlier version's rows for a tenant that had none, and only when asked", async () => {
    const first = await component(general, ada, 'Rebuilt');
    const second = await revise(first, 'The potoroo');
    await revise(second, 'The pademelon');
    const rows = () =>
      tenant(async (trx) =>
        (
          await sql<{ version_id: string; n: number }>`
            select version_id, count(*)::int as n from search_earlier
            where artifact_id = ${first.artifactId} group by version_id order by version_id`.execute(
            trx,
          )
        ).rows.map((row) => `${row.version_id}:${row.n}`),
      );
    const before = await rows();
    expect(before).toHaveLength(2);
    // As 0088's run finds an environment: no earlier rows at all. Rebuilding the current set leaves
    // them alone; only the earlier scope writes them (#596 moves it to a job).
    await tenant((trx) => trx.deleteFrom('search_earlier').execute());
    await tenant((trx) => reindexSearch(trx));
    expect(await rows()).toEqual([]);
    await tenant((trx) => reindexSearch(trx, 'earlier'));
    expect(await rows()).toEqual(before);
    expect(resultsOf(await search(ada, 'potoroo', 'all')).items).toMatchObject([
      { version: { id: second.id, latest: false } },
    ]);
  });

  /** A person-valued Steward on a Register type, made once, so a component names somebody. */
  let stewardship: Promise<{ owner: string; type: string }> | undefined;
  const steward = () =>
    (stewardship ??= (async () => {
      const defined = (kind: 'field' | 'metadataSchema' | 'componentType', body: object) =>
        tenant(async (trx) => {
          const made = await createDefinition(trx, {
            kind,
            author: ada,
            definition: { schemaVersion: DEFINITION_SCHEMA_VERSION, ...body },
          });
          if (made.answer !== 'created') throw new Error(made.answer);
          return made.definition.id;
        });
      const owner = await defined('field', {
        name: 'Steward',
        dataType: 'user',
        multiplicity: 'one',
        validation: {},
      });
      const schema = await defined('metadataSchema', {
        name: 'Stewardship',
        entries: [{ field: owner, required: false, fixed: false }],
      });
      const type = await defined('componentType', {
        name: 'Register',
        assignments: [{ schema, requires: [] }],
      });
      return { owner, type };
    })());

  /** A version of `version` holding these values, recorded in `trx`. */
  const valuesIn = async (
    trx: TenantTransaction,
    version: StoredVersion,
    values: Record<string, unknown>,
  ) => {
    const recorded = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author: ada,
      substance: { ...substanceOf(version), values } as never,
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  /** A Register component whose second version names `named` as its Steward. */
  const stewardedBy = async (named: string) => {
    const { owner, type } = await steward();
    const made = await tenant((trx) =>
      createComponent(trx, {
        spaceId: general,
        componentTypeId: type,
        title: 'Register',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return tenant((trx) => valuesIn(trx, made.version, { [owner]: { user: named } }));
  };

  /** Every earlier word search holds of an artifact. */
  const earlierWords = (artifact: string) =>
    tenant(async (trx) =>
      (
        await trx
          .selectFrom('search_earlier')
          .select('body')
          .where('artifact_id', '=', artifact)
          .execute()
      )
        .map((row) => row.body)
        .join(' '),
    );

  it("VER-038 erases a person's name from every earlier version's words", async () => {
    const hedy = await tenant((trx) => person(trx, 'hedy', 'Hedy'));
    const named = await stewardedBy(hedy);
    await tenant((trx) => valuesIn(trx, named, {}));
    expect(resultsOf(await search(ada, 'hedy', 'all')).items).toHaveLength(1);

    await tenant((trx) => erasePerson(trx, hedy, ada));
    expect(resultsOf(await search(ada, 'hedy', 'all')).items).toEqual([]);
    const said = await earlierWords(named.artifactId);
    expect(said).not.toContain('Hedy');
    expect(said).toContain(ERASED_NAME);
  });

  it("VER-038 erases the name of somebody invited who never signed in from earlier versions' words", async () => {
    const alan = await tenant(async (trx) => {
      const invited = await invite(trx, {
        email: `alan-${randomUUID()}@example.test`,
        external: false,
        invitedBy: ada,
      });
      if (!('invited' in invited)) throw new Error('not invited');
      await trx
        .updateTable('principal')
        .set({ display_name: 'Alan' })
        .where('id', '=', invited.invited.principalId)
        .execute();
      return invited.invited.principalId;
    });
    const named = await stewardedBy(alan);
    await tenant((trx) => valuesIn(trx, named, {}));
    expect(await earlierWords(named.artifactId)).toContain('Alan');
    expect((await tenant((trx) => erasePerson(trx, alan, ada)))?.answer).toBe('erased');
    expect(await earlierWords(named.artifactId)).not.toContain('Alan');
  });

  it('VER-038 erases a name that a save moves aside while the erasure runs', async () => {
    const zelda = await tenant((trx) => person(trx, 'zelda', 'Zelda'));
    const named = await stewardedBy(zelda);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let moved!: () => void;
    const saved = new Promise<void>((resolve) => (moved = resolve));
    // A save that stops naming her, its rows naming her moved aside and not yet committed.
    const saving = tenant(async (trx) => {
      await valuesIn(trx, named, {});
      moved();
      await held;
    });
    await saved;
    const erasing = tenant((trx) => erasePerson(trx, zelda, ada));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await saving;
    await erasing;
    expect(await earlierWords(named.artifactId)).not.toContain('Zelda');
    // Nor in its history, which folded her name in with the save (SV3-K).
    const history = await tenant((trx) =>
      trx
        .selectFrom('search_history')
        .select(sql<string>`body || ' ' || vector::text`.as('words'))
        .where('artifact_id', '=', named.artifactId)
        .execute(),
    );
    expect(history.length).toBeGreaterThan(0);
    expect(history.map((each) => each.words).join(' ')).not.toMatch(/zelda/iu);
  });

  it('refuses to index a stale version over a newer one, moving nothing', async () => {
    const first = await component(general, ada, 'Stale');
    const second = await revise(first, 'The bettong');
    const before = await earlierWords(first.artifactId);
    await expect(tenant((trx) => indexVersion(trx, first))).rejects.toThrow(/newer/u);
    const current = await tenant((trx) =>
      trx
        .selectFrom('search_entry')
        .select('version_id')
        .distinct()
        .where('artifact_id', '=', first.artifactId)
        .execute(),
    );
    expect(current).toEqual([{ version_id: second.id }]);
    expect(await earlierWords(first.artifactId)).toBe(before);
  });
});

describe('migration 0088, which keeps earlier versions searchable', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0087 and none after, where every environment stood before SV1.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0088-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 88;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('SCH-003 writes, in the run that applies it, the earlier versions an environment already held', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const service = beforeTheLogDatabase(db.serviceUrl);
    try {
      // Written before 0088: indexing moves nothing, as there is nowhere to move it.
      const earlier = await service.withTenant(tenant, async (trx) => {
        const ada = await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const made = await createComponent(trx, {
          spaceId: space.id,
          title: 'Wombat burrows',
          language: 'en-GB',
          direction: 'ltr',
          author: ada.id,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version) as Extract<
          ReturnType<typeof substanceOf>,
          { kind: 'component' }
        >;
        let version = made.version;
        for (const text of ['The quokka', 'The numbat']) {
          const next = await recordVersion(trx, {
            artifactId: version.artifactId,
            openedFrom: version.id,
            author: ada.id,
            substance: {
              ...substance,
              content: {
                ...(substance.content as ContentDocument),
                content: [para('b1', text)],
              } as ContentDocument,
            },
          });
          if (next.answer !== 'recorded') throw new Error(next.answer);
          if (text === 'The quokka') version = next.version;
        }
        return version;
      });

      const report = await migrate(db.migratorUrl);
      expect(report.tenants[id]).toEqual([
        '0088_search_earlier',
        '0089_search_threads',
        '0090_search_at_scale',
        '0091_search_history',
        '0092_search_scoped',
        '0093_search_history_titles',
        '0094_search_history_fields',
        '0095_workflow',
        '0096_workflow_gates',
        '0097_workflow_publishing',
        '0098_workflow_query_definitions',
        '0099_workflow_dates',
        '0100_section_waivers',
        '0101_template_moves',
        '0102_reference_index',
        '0103_api_jobs',
        '0104_variable_definitions',
        '0105_provenance_without_bindings',
        '0106_conditions_and_profiles',
        '0107_cohorts',
        '0108_relationships',
        '0109_thread_internal',
        '0110_search_conditions',
        '0111_scoped_effectivity',
        '0112_divergent_lines',
        '0113_line_returned',
        '0114_publication_shares',
        '0115_query_limits',
        '0116_cohort_on_failure',
        '0117_dataset_source',
        '0118_tenant_export',
        '0119_range_preview',
        '0120_model_endpoints',
        '0121_assistant',
        '0122_prompts',
        '0123_workflow_prompts',
        '0124_prompt_libraries',
        '0125_prompt_trials',
        '0126_run_transcripts',
        '0127_conversations',
        '0128_guardrails',
        '0129_conversation_context',
        '0130_creation_proposals',
        '0131_personal_prompts',
        '0132_generation_limits',
        '0133_generation_budget',
        '0134_caching',
        '0135_embeddings',
        '0136_embedding_queue',
        '0137_embedding_confirmed',
        '0138_service_identities',
        '0139_webhooks',
        '0140_webhook_notification',
        '0141_extensions',
      ]);
      const kept = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('search_earlier as e')
          .innerJoin('search_earlier_text as t', 't.entry_id', 'e.id')
          .select(['e.version_id', 't.place', 't.body'])
          .where('t.place', '=', 'block:b1')
          .execute(),
      );
      expect(kept).toEqual([{ version_id: earlier.id, place: 'block:b1', body: 'The quokka' }]);
      const rows = await service.withTenant(tenant, (trx) =>
        trx.selectFrom('search_earlier').select('version_id').execute(),
      );
      expect(rows).toHaveLength(2);
    } finally {
      await service.close();
    }
  });
});
