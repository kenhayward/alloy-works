import { randomBytes } from 'node:crypto';
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
import { archiveArtifact, unarchiveArtifact } from './archival.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { deleteArtifact, undeleteArtifact } from './deletion.js';
import { createDocument } from './documents.js';
import { erasePerson } from './erasure.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { reindexScopes, reindexSearch } from './search.js';
import { rebuildHistory } from './search-history.js';
import { searchWords, type SearchAnswer, type SearchOptions } from './search-words.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  beforeTheLogDatabase,
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createSpace } from './spaces.js';
import { startThread } from './threads.js';
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

/** A place's history row as it reads, without its id, which a rebuild makes again. */
const historyOf = (trx: TenantTransaction, artifact: string) =>
  sql<Record<string, unknown>>`
    select kind, node, version_id, space_id, title, owner, changed_at, component_type,
           field_values, configuration::text, body, vector::text, title_vector::text,
           fields_vector::text, archived, deleted
    from search_history where artifact_id = ${artifact}
    order by node nulls first`
    .execute(trx)
    .then((result) => result.rows);

/** A small, seeded generator, so a failing sequence is the same sequence again. */
function seeded(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % below;
  };
}

/** `trx`, every statement it runs pushed to `statements`. */
const spiedOn = (trx: TenantTransaction, statements: string[]): TenantTransaction =>
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

const VOCABULARY = [
  'quokka',
  'numbat',
  'bilby',
  'dingo',
  'wombat',
  'echidna',
  'potoroo',
  'bettong',
  'quoll',
  'dunnart',
  'wallaby',
  'bandicoot',
];

describe('search over every version from one row a place (SV3b)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const component = (title: string, text?: string) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return text === undefined ? made.version : revisedIn(trx, made.version, { text });
    });

  const revisedIn = async (
    trx: TenantTransaction,
    version: StoredVersion,
    change: { text?: string; title?: string; values?: Record<string, unknown> },
  ) => {
    const substance = substanceOf(version) as Extract<
      ReturnType<typeof substanceOf>,
      { kind: 'component' }
    >;
    const content = substance.content as ContentDocument;
    const next = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author: ada,
      substance: {
        ...substance,
        ...(change.values === undefined ? {} : { values: change.values }),
        content: {
          ...content,
          ...(change.title === undefined ? {} : { title: change.title }),
          ...(change.text === undefined ? {} : { content: [para('b1', change.text)] }),
        } as ContentDocument,
      } as never,
    });
    if (next.answer !== 'recorded') throw new Error(next.answer);
    return next.version;
  };

  const revise = (
    version: StoredVersion,
    change: { text?: string; title?: string; values?: Record<string, unknown> },
  ) => tenant((trx) => revisedIn(trx, version, change));

  const document = (title: string) =>
    tenant(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const outline = (version: StoredVersion, nodes: OutlineNode[]) =>
    tenant(async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const section = (title: string, id = nodeId()): OutlineNode => ({
    type: 'section',
    id,
    title: words(title),
    ...base,
    children: [],
  });

  const search = (query: string, options: SearchOptions & { scope?: 'latest' | 'all' } = {}) =>
    tenant((trx) => searchWords(trx, ada, query, options)).then(resultsOf);

  /** A text Stage and Remark and a person Steward on a Register type, made once. */
  let registry:
    Promise<{ stage: string; steward: string; remark: string; type: string }> | undefined;
  const register = () =>
    (registry ??= (async () => {
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
      const stage = await defined('field', {
        name: 'Stage',
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      });
      const steward = await defined('field', {
        name: 'Steward',
        dataType: 'user',
        multiplicity: 'one',
        validation: {},
      });
      const remark = await defined('field', {
        name: 'Remark',
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      });
      const schema = await defined('metadataSchema', {
        name: 'Registry',
        entries: [
          { field: stage, required: false, fixed: false },
          { field: steward, required: false, fixed: false },
          { field: remark, required: false, fixed: false },
        ],
      });
      const type = await defined('componentType', {
        name: 'Register',
        assignments: [{ schema, requires: [] }],
      });
      return { stage, steward, remark, type };
    })());

  const registered = async (title: string) => {
    const { type } = await register();
    const made = await tenant((trx) =>
      createComponent(trx, {
        spaceId: general,
        componentTypeId: type,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

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
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      // At the tenant, so she reads the fields too.
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('folds each version into its place as rebuilding it would, over random runs of versions', async () => {
    const pick = seeded(20261013);
    const phrase = () =>
      Array.from({ length: 1 + pick(4) }, () => VOCABULARY[pick(VOCABULARY.length)]).join(' ');
    let made = await component('Folded notes', phrase());
    let filed = await document('Folded report');
    const sections: { id: string; title: string }[] = [];
    for (let step = 0; step < 12; step += 1) {
      // Numbered, so no version is the one before it again.
      made = await revise(made, {
        text: `${phrase()} ${step}`,
        ...(pick(3) === 0 ? { title: phrase() } : {}),
      });
      // Sections come, go and are renamed, so a place gone from the newest version keeps its row.
      const draw = sections.length === 0 ? 0 : pick(4);
      if (draw < 2) sections.push({ id: nodeId(), title: phrase() });
      else if (draw === 2) sections.splice(pick(sections.length), 1);
      else sections[pick(sections.length)]!.title = `${phrase()} ${step}`;
      filed = await outline(
        filed,
        sections.map((each) => section(each.title, each.id)),
      );
      for (const artifact of [made.artifactId, filed.artifactId]) {
        const folded = await tenant((trx) => historyOf(trx, artifact));
        await tenant((trx) => rebuildHistory(trx, artifact));
        expect({ step, history: await tenant((trx) => historyOf(trx, artifact)) }).toEqual({
          step,
          history: folded,
        });
      }
    }
  });

  it('holds each word once however many versions held it', async () => {
    let made = await component('Burrow', 'The wombat burrow');
    for (const text of ['The wombat burrow ', 'The wombat burrow', ' The wombat burrow']) {
      made = await revise(made, { text });
    }
    const [history, current] = await tenant(async (trx) => [
      await trx
        .selectFrom('search_history')
        .select(['body', 'vector'])
        .where('artifact_id', '=', made.artifactId)
        .executeTakeFirstOrThrow(),
      await trx
        .selectFrom('search_entry')
        .select(['body', 'vector'])
        .where('artifact_id', '=', made.artifactId)
        .executeTakeFirstOrThrow(),
    ]);
    expect(history.vector).toBe(current.vector);
  });

  it('SCH-003 finds a place gone from the newest version under every version only, at the version that held it', async () => {
    const node = nodeId();
    const first = await outline(await document('Survey'), [section('Kowari findings', node)]);
    await outline(first, [section('Mulgara findings')]);
    expect((await search('kowari')).items).toEqual([]);
    expect((await search('kowari', { scope: 'all' })).items).toMatchObject([
      { kind: 'section', node, version: { id: first.id, latest: false } },
    ]);
  });

  it("filters every version by a field's current value, so a value only an earlier version held finds nothing", async () => {
    const { stage } = await register();
    const made = await registered('Tarsier register');
    const draft = await revise(made, { values: { [stage]: 'Draft' } });
    await revise(draft, { values: { [stage]: 'Final' } });
    const filtered = (value: string) =>
      search('tarsier', { scope: 'all', filters: { values: [{ field: stage, value }] } });
    expect((await filtered('Draft')).items).toEqual([]);
    expect((await filtered('Final')).items).toMatchObject([{ artifactId: made.artifactId }]);
  });

  it('LIF-020 keeps archived and deleted places out of every version, and brings them back when undone', async () => {
    const made = await revise(await component('Pangolin'), { text: 'The aardvark' });
    const found = async () =>
      (await search('pangolin aardvark', { scope: 'all' })).items.map((each) => each.artifactId);
    expect(await found()).toEqual([made.artifactId]);
    await tenant((trx) => archiveArtifact(trx, made.artifactId, ada));
    expect(await found()).toEqual([]);
    await tenant((trx) => unarchiveArtifact(trx, made.artifactId, ada));
    expect(await found()).toEqual([made.artifactId]);
    await tenant((trx) => deleteArtifact(trx, made.artifactId, ada));
    expect(await found()).toEqual([]);
    await tenant((trx) => undeleteArtifact(trx, made.artifactId, ada));
    expect(await found()).toEqual([made.artifactId]);
  });

  it('VER-038 finds an erased name under no scope, whether the newest version or only an earlier one named them', async () => {
    const { steward } = await register();
    const named = async (subject: string, name: string, later: boolean) => {
      const who = await tenant((trx) => person(trx, subject, name));
      const made = await registered('Stewarded register');
      const naming = await revise(made, { values: { [steward]: { user: who } } });
      if (later) await revise(naming, { values: {} });
      return { who, artifact: made.artifactId };
    };
    for (const [subject, name, later] of [
      ['ottoline', 'Ottoline', false],
      ['hedwig', 'Hedwig', true],
    ] as const) {
      const { who, artifact } = await named(subject, name, later);
      expect((await search(subject, { scope: 'all' })).items).toHaveLength(1);
      await tenant((trx) => erasePerson(trx, who, ada));
      for (const scope of ['latest', 'all'] as const) {
        expect({ name, scope, items: (await search(subject, { scope })).items }).toEqual({
          name,
          scope,
          items: [],
        });
      }
      const [history] = await tenant((trx) => historyOf(trx, artifact));
      expect(
        `${String(history!.body)} ${String(history!.vector)} ${String(history!.fields_vector)}`,
      ).not.toMatch(new RegExp(subject, 'iu'));
    }
  });

  it('names the newest version matching the whole query, else the newest holding any of its words', async () => {
    const first = await component('Marsupial log', 'The kultarr and the ningaui');
    const second = await revise(first, { text: 'The ningaui' });
    const third = await revise(second, { text: 'The planigale' });
    const named = async (query: string) =>
      (await search(query, { scope: 'all' })).items.map((each) => each.version);
    expect(await named('kultarr ningaui')).toEqual([
      { id: first.id, number: `${first.revision}.${first.version}`, latest: false },
    ]);
    expect(await named('ningaui')).toMatchObject([{ id: second.id, latest: false }]);
    expect(await named('planigale')).toMatchObject([{ id: third.id, latest: true }]);
    // Kultarr and planigale in no one version: the newest holding either, and its passage.
    const spanning = (await search('kultarr planigale', { scope: 'all' })).items;
    expect(spanning).toMatchObject([{ version: { id: third.id, latest: true } }]);
    expect(
      spanning[0]!.passage.filter((piece) => piece.matched).map((piece) => piece.text),
    ).toEqual(['planigale']);
  });

  it('SCH-003 under every version matches a scoped term held by any version of a place, and excludes a place any version held it in', async () => {
    const first = await component('Phascogale ledger', 'Counted');
    await revise(first, { title: 'Antechinus ledger' });
    const found = async (query: string, scope: 'latest' | 'all') =>
      (await search(query, { scope })).items.map((each) => each.artifactId);
    // Held only by an earlier version's place.
    expect(await found('title:phascogale', 'latest')).toEqual([]);
    expect(await found('title:phascogale', 'all')).toEqual([first.artifactId]);
    // Held by the newest version's place.
    expect(await found('title:antechinus', 'all')).toEqual([first.artifactId]);
    // Excluded where any version held it.
    expect(await found('ledger -title:phascogale', 'latest')).toEqual([first.artifactId]);
    expect(await found('ledger -title:phascogale', 'all')).toEqual([]);
    // A row every version reads from the current set: a field, by its own title.
    const { stage } = await register();
    expect(await found('title:stage', 'all')).toContain(stage);
    // A field's term, held only by an earlier version's value (#610).
    const staged = await registered('Dibbler ledger');
    await revise(await revise(staged, { values: { [stage]: 'Pending' } }), {
      values: { [stage]: 'Settled' },
    });
    expect(await found('stage:pending', 'latest')).toEqual([]);
    expect(await found('stage:pending', 'all')).toEqual([staged.artifactId]);
    expect(await found('dibbler stage:pending', 'all')).toEqual([staged.artifactId]);
    expect(await found('dibbler -stage:pending', 'all')).toEqual([]);
  });

  it('SCH-003 under every version matches a field term as its exact test does, a phrase, a hyphenated word and a negation included, on either road, its index narrowing words or not', async () => {
    const { stage, remark } = await register();
    const valued = async (title: string, ...values: Record<string, unknown>[]) => {
      let version = await registered(title);
      for (const each of values) version = await revise(version, { values: each });
      return version.artifactId;
    };
    // A phrase in one field, a word of it in another of the same version, either way round.
    const woylie = await valued('Woylie register', { [stage]: 'Red apple', [remark]: 'Apple' });
    const boodie = await valued('Boodie register', { [stage]: 'Apple', [remark]: 'Red apple' });
    // A hyphenated word, and a word, held only by an earlier version.
    const ningbing = await valued(
      'Ningbing register',
      { [stage]: 'Half-done' },
      { [stage]: 'Done' },
    );
    const wambenger = await valued(
      'Wambenger register',
      { [stage]: 'Pending' },
      { [stage]: 'Settled' },
    );
    for (const [query, expected] of [
      ['stage:"red apple"', [woylie]],
      ['woylie stage:"red apple"', [woylie]],
      ['remark:"red apple"', [boodie]],
      ['boodie remark:"red apple"', [boodie]],
      ['stage:half-done', [ningbing]],
      ['ningbing stage:half-done', [ningbing]],
      ['wambenger stage:-pending', [wambenger]],
    ] as const) {
      for (const road of ['walk', 'indexes'] as const) {
        for (const narrows of [true, false]) {
          const found = (await search(query, { scope: 'all', probe: { road, narrows } })).items.map(
            (each) => each.artifactId,
          );
          expect({ query, road, narrows, found }).toEqual({
            query,
            road,
            narrows,
            found: expected,
          });
        }
      }
    }
  });

  it('SCH-003 under every version matches a place by its words over all its versions together: two words in two versions find it, -word excludes a place any version held it in, and a phrase held only by an earlier version is lost once one of its words reappears in the newest', async () => {
    const first = await component('Aviary', 'The kookaburra');
    await revise(first, { text: 'The cassowary' });
    const found = async (query: string, scope: 'latest' | 'all' = 'all') =>
      (await search(query, { scope })).items.map((each) => each.artifactId);
    expect(await found('kookaburra cassowary')).toEqual([first.artifactId]);
    expect(await found('cassowary -kookaburra', 'latest')).toEqual([first.artifactId]);
    expect(await found('cassowary -kookaburra')).toEqual([]);

    const phrased = await component('Scrub', 'The bushy wallaroo');
    expect(await found('"bushy wallaroo"')).toEqual([phrased.artifactId]);
    await revise(phrased, { text: 'The wallaroo' });
    expect(await found('"bushy wallaroo"')).toEqual([]);
  });

  it("leaves a thread's row in the current set, found once under every version", async () => {
    const made = await component('Kiln', 'Fire it slowly');
    const started = await tenant(async (trx) => {
      const answer = await startThread(trx, {
        on: made.artifactId,
        version: made.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'The tuatara glaze crazed.' }],
        author: ada,
      });
      if (answer.answer !== 'done') throw new Error(answer.answer);
      return answer;
    });
    await revise(made, { text: 'Fire it faster' });
    const kinds = await tenant((trx) =>
      trx
        .selectFrom('search_history')
        .select('kind')
        .where('artifact_id', '=', made.artifactId)
        .execute(),
    );
    expect(kinds).toEqual([{ kind: 'component' }]);
    const found = await search('tuatara', { scope: 'all' });
    expect(found.items).toMatchObject([{ kind: 'thread', thread: { id: started.thread } }]);
    expect(found.count).toBe(1);
  });

  it('SCH-010 SCH-032 finds, counts and facets under every version only what a reader may read, past a deny on an artifact and with a grant outside their spaces', async () => {
    const { hal, kept, granted, quality } = await tenant(async (trx) => {
      const quality = (await createSpace(trx, 'Okapi quality')).id;
      const author = (await findRole(trx, 'Author'))!.id;
      const reader = (await findRole(trx, 'Reader'))!.id;
      await grant(trx, {
        roleId: author,
        subject: { principal: ada },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ada,
      });
      // Four components, each its word only in an earlier version's title and text.
      const made: string[] = [];
      for (const [space, title] of [
        [general, 'Okapi kept'],
        [general, 'Okapi denied'],
        [quality, 'Okapi granted'],
        [quality, 'Okapi unseen'],
      ] as const) {
        const created = await createComponent(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (created.answer !== 'created') throw new Error(created.answer);
        const first = await revisedIn(trx, created.version, { text: 'The okapi browses' });
        await revisedIn(trx, first, { title: 'Tapir register', text: 'The tapir wallows' });
        made.push(created.version.artifactId);
      }
      // Hal reads General but one artifact there, and one artifact in Quality.
      const hal = await person(trx, 'hal', 'Hal');
      await grant(trx, {
        roleId: reader,
        subject: { principal: hal },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      await grant(trx, {
        roleId: reader,
        subject: { principal: hal },
        level: { kind: 'artifact', id: made[1]! },
        effect: 'deny',
        grantedBy: ada,
      });
      await grant(trx, {
        roleId: reader,
        subject: { principal: hal },
        level: { kind: 'artifact', id: made[2]! },
        effect: 'allow',
        grantedBy: ada,
      });
      return { hal, kept: made[0]!, granted: made[2]!, quality, made };
    });
    for (const [query, filters] of [
      ['okapi', {}],
      ['title:okapi', {}],
      ['tapir -walrus', {}],
      ['okapi', { kinds: ['component' as const], spaces: [general, quality] }],
    ] as const) {
      // Not vacuous: Ada finds all four.
      const all = await tenant((trx) => searchWords(trx, ada, query, { scope: 'all', filters }));
      expect(resultsOf(all).items.filter((each) => each.title === 'Tapir register')).toHaveLength(
        4,
      );
      const seen = resultsOf(
        await tenant((trx) => searchWords(trx, hal, query, { scope: 'all', filters })),
      );
      expect({ query, found: seen.items.map((each) => each.artifactId).sort() }).toEqual({
        query,
        found: [kept, granted].sort(),
      });
      expect([seen.count, seen.capped, seen.facetsBounded]).toEqual([2, false, false]);
      expect(seen.facets.kinds).toEqual([
        { value: 'component', label: 'component', count: 2, capped: false },
      ]);
      expect(seen.facets.spaces.map((each) => [each.value, each.count]).sort()).toEqual(
        [
          [general, 1],
          [quality, 1],
        ].sort(),
      );
      expect(seen.facets.owners.map((each) => each.count)).toEqual([2]);
      expect(seen.facets.changed.find((each) => each.value === 'today')?.count).toBe(2);
    }
  });

  it("rebuilds an erased person's history once per artifact", async () => {
    const { steward } = await register();
    const who = await tenant((trx) => person(trx, 'wilhelmina', 'Wilhelmina'));
    const made = await registered('Once rebuilt');
    await revise(made, { values: { [steward]: { user: who } } });
    const statements: string[] = [];
    await tenant((trx) => erasePerson(spiedOn(trx, statements), who, ada));
    expect(statements.filter((each) => /delete from search_history/u.test(each))).toHaveLength(1);
  });

  it('reads every version from history, with no collapse and no earlier rows but for the page', async () => {
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
    await tenant((trx) => searchWords(spied(trx), ada, 'quoll', { scope: 'all' }));
    const candidates = statements.filter(
      (each) => /search_history/u.test(each) && !/readable_fields|unnest/u.test(each),
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const each of candidates) expect(each).not.toMatch(/search_earlier|distinct on/u);
    const page = statements.find((each) => each.includes('readable_fields')) ?? '';
    expect(page).toMatch(/search_history/u);
    expect(page).not.toMatch(/distinct on \(m\./u);
  });

  it('reindexes history last, implied by the whole projection and by earlier versions', async () => {
    expect(await tenant((trx) => reindexScopes(trx, ['history', 'threads', 'earlier']))).toEqual([
      'earlier',
      'threads',
      'history',
    ]);
    expect(await tenant((trx) => reindexScopes(trx, ['whole', 'threads']))).toEqual([
      'whole',
      'history',
    ]);
    expect(await tenant((trx) => reindexScopes(trx, ['threads']))).toEqual(['threads']);
    const made = await revise(await component('Rebuilt history'), { text: 'The pademelon' });
    const before = await tenant((trx) => historyOf(trx, made.artifactId));
    await tenant((trx) => trx.deleteFrom('search_history').execute());
    await tenant((trx) => reindexSearch(trx, 'earlier'));
    expect(await tenant((trx) => historyOf(trx, made.artifactId))).toEqual(before);
  });
});

describe('migration 0091, which keeps one row a place over every version', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0091-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 91;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('SCH-003 writes, in the run that applies it, the history of every place an environment already held', async () => {
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
      // Written before 0091: nothing is folded, as there is nowhere to fold it, and every version is
      // still searched by the union.
      const { ada, artifact } = await service.withTenant(tenant, async (trx) => {
        const ada = (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: 'ada',
              email: null,
              display_name: 'Ada',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
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
          author: ada,
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
            author: ada,
            substance: {
              ...substance,
              content: {
                ...(substance.content as ContentDocument),
                content: [para('b1', text)],
              } as ContentDocument,
            },
          });
          if (next.answer !== 'recorded') throw new Error(next.answer);
          version = next.version;
        }
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space.id },
          effect: 'allow',
          grantedBy: ada,
        });
        return { ada, artifact: made.version.artifactId };
      });
      const unfolded = await service.withTenant(tenant, (trx) =>
        searchWords(trx, ada, 'quokka', { scope: 'all' }),
      );
      expect(resultsOf(unfolded).items).toMatchObject([{ artifactId: artifact }]);

      const report = await migrate(db.migratorUrl);
      expect(report.tenants[id]).toEqual([
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
        '0142_webhook_delivery_ids',
        '0143_publication_generated',
        '0144_embedding_lag',
        '0145_bibliography_entries',
        '0146_citation_styles',
        '0147_publication_citations',
        '0148_default_layout_bibliography',
        '0149_reference_sources',
        '0150_entry_status',
        '0151_citation_proposals',
        '0152_reference_extensions',
        '0153_terms',
        '0154_publication_terms',
        '0155_imports',
        '0156_import_review',
        '0157_import_structure',
        '0158_import_again',
        '0159_translation',
        '0160_publish_in_language',
        '0161_default_layout_languages',
        '0162_untranslated_note',
        '0163_translation_jobs',
        '0164_translation_returns',
        '0165_machine_drafts',
        '0166_interface_language',
        '0167_default_theme_naskh',
        '0168_html_output',
        '0169_default_layout_index',
        '0170_translation_policy_history',
        '0171_publication_locale_data',
        '0172_bridge',
        '0173_bridge_unlisted',
        '0174_ct_studio',
        '0175_entry_superseded',
        '0176_vocabularies',
        '0177_publication_vocabularies',
        '0178_vocabulary_query_runs',
        '0179_licences',
        '0180_asset_rights',
      ]);
      const migrated = await service.withTenant(tenant, (trx) => historyOf(trx, artifact));
      expect(migrated).toHaveLength(1);
      await service.withTenant(tenant, (trx) => rebuildHistory(trx, artifact));
      expect(await service.withTenant(tenant, (trx) => historyOf(trx, artifact))).toEqual(migrated);
      const after = await service.withTenant(tenant, (trx) =>
        searchWords(trx, ada, 'quokka', { scope: 'all' }),
      );
      expect(resultsOf(after).items).toMatchObject([
        { artifactId: artifact, version: { latest: false } },
      ]);
    } finally {
      await service.close();
    }
  });
});

describe("migration 0093, which keeps every version's titles in history", () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0093-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 93;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('SCH-003 folds, in the run that applies it, every title a place held into its history', async () => {
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
      // Folded before 0093, without titles; renamed once, so only an earlier version held the first.
      const { ada, artifact } = await service.withTenant(tenant, async (trx) => {
        const ada = (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: 'ada',
              email: null,
              display_name: 'Ada',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const made = await createComponent(trx, {
          spaceId: space.id,
          title: 'Bilby census',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version) as Extract<
          ReturnType<typeof substanceOf>,
          { kind: 'component' }
        >;
        const next = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: ada,
          substance: {
            ...substance,
            content: { ...(substance.content as ContentDocument), title: 'Dunnart census' },
          } as never,
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space.id },
          effect: 'allow',
          grantedBy: ada,
        });
        return { ada, artifact: made.version.artifactId };
      });

      const report = await migrate(db.migratorUrl);
      expect(report.tenants[id]).toEqual([
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
        '0142_webhook_delivery_ids',
        '0143_publication_generated',
        '0144_embedding_lag',
        '0145_bibliography_entries',
        '0146_citation_styles',
        '0147_publication_citations',
        '0148_default_layout_bibliography',
        '0149_reference_sources',
        '0150_entry_status',
        '0151_citation_proposals',
        '0152_reference_extensions',
        '0153_terms',
        '0154_publication_terms',
        '0155_imports',
        '0156_import_review',
        '0157_import_structure',
        '0158_import_again',
        '0159_translation',
        '0160_publish_in_language',
        '0161_default_layout_languages',
        '0162_untranslated_note',
        '0163_translation_jobs',
        '0164_translation_returns',
        '0165_machine_drafts',
        '0166_interface_language',
        '0167_default_theme_naskh',
        '0168_html_output',
        '0169_default_layout_index',
        '0170_translation_policy_history',
        '0171_publication_locale_data',
        '0172_bridge',
        '0173_bridge_unlisted',
        '0174_ct_studio',
        '0175_entry_superseded',
        '0176_vocabularies',
        '0177_publication_vocabularies',
        '0178_vocabulary_query_runs',
        '0179_licences',
        '0180_asset_rights',
      ]);
      const migrated = await service.withTenant(tenant, (trx) => historyOf(trx, artifact));
      expect(String(migrated[0]?.title_vector)).toMatch(/'bilbi'.*'dunnart'|'dunnart'.*'bilbi'/u);
      await service.withTenant(tenant, (trx) => rebuildHistory(trx, artifact));
      expect(await service.withTenant(tenant, (trx) => historyOf(trx, artifact))).toEqual(migrated);
      for (const query of ['title:bilby', 'title:dunnart']) {
        const found = await service.withTenant(tenant, (trx) =>
          searchWords(trx, ada, query, { scope: 'all' }),
        );
        expect({ query, items: resultsOf(found).items }).toMatchObject({
          query,
          items: [{ artifactId: artifact }],
        });
      }
    } finally {
      await service.close();
    }
  });
});

describe("migration 0094, which keeps every version's fields' words in history", () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0094-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 94;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it("SCH-003 folds, in the run that applies it, every field's words a place held into its history", async () => {
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
      // Folded before 0094, without fields' words; a Stage of Pending, then Settled.
      const { ada, artifact } = await service.withTenant(tenant, async (trx) => {
        const ada = (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: 'ada',
              email: null,
              display_name: 'Ada',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const defined = async (
          kind: 'field' | 'metadataSchema' | 'componentType',
          body: object,
        ) => {
          const made = await createDefinition(trx, {
            kind,
            author: ada,
            definition: { schemaVersion: DEFINITION_SCHEMA_VERSION, ...body },
          });
          if (made.answer !== 'created') throw new Error(made.answer);
          return made.definition.id;
        };
        const stage = await defined('field', {
          name: 'Stage',
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        });
        const schema = await defined('metadataSchema', {
          name: 'Registry',
          entries: [{ field: stage, required: false, fixed: false }],
        });
        const type = await defined('componentType', {
          name: 'Register',
          assignments: [{ schema, requires: [] }],
        });
        const made = await createComponent(trx, {
          spaceId: space.id,
          componentTypeId: type,
          title: 'Quoll register',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        let version = made.version;
        for (const value of ['Pending', 'Settled']) {
          const substance = substanceOf(version) as Extract<
            ReturnType<typeof substanceOf>,
            { kind: 'component' }
          >;
          const next = await recordVersion(trx, {
            artifactId: version.artifactId,
            openedFrom: version.id,
            author: ada,
            substance: { ...substance, values: { [stage]: value } } as never,
          });
          if (next.answer !== 'recorded') throw new Error(next.answer);
          version = next.version;
        }
        // At the tenant, so she reads the field too.
        await grant(trx, {
          roleId: (await findRole(trx, 'Reader'))!.id,
          subject: { principal: ada },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ada,
        });
        return { ada, artifact: made.version.artifactId };
      });

      const report = await migrate(db.migratorUrl);
      expect(report.tenants[id]).toEqual([
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
        '0142_webhook_delivery_ids',
        '0143_publication_generated',
        '0144_embedding_lag',
        '0145_bibliography_entries',
        '0146_citation_styles',
        '0147_publication_citations',
        '0148_default_layout_bibliography',
        '0149_reference_sources',
        '0150_entry_status',
        '0151_citation_proposals',
        '0152_reference_extensions',
        '0153_terms',
        '0154_publication_terms',
        '0155_imports',
        '0156_import_review',
        '0157_import_structure',
        '0158_import_again',
        '0159_translation',
        '0160_publish_in_language',
        '0161_default_layout_languages',
        '0162_untranslated_note',
        '0163_translation_jobs',
        '0164_translation_returns',
        '0165_machine_drafts',
        '0166_interface_language',
        '0167_default_theme_naskh',
        '0168_html_output',
        '0169_default_layout_index',
        '0170_translation_policy_history',
        '0171_publication_locale_data',
        '0172_bridge',
        '0173_bridge_unlisted',
        '0174_ct_studio',
        '0175_entry_superseded',
        '0176_vocabularies',
        '0177_publication_vocabularies',
        '0178_vocabulary_query_runs',
        '0179_licences',
        '0180_asset_rights',
      ]);
      const migrated = await service.withTenant(tenant, (trx) => historyOf(trx, artifact));
      expect(String(migrated[0]?.fields_vector)).toMatch(/'pend'.*'settl'|'settl'.*'pend'/u);
      await service.withTenant(tenant, (trx) => rebuildHistory(trx, artifact));
      expect(await service.withTenant(tenant, (trx) => historyOf(trx, artifact))).toEqual(migrated);
      for (const query of ['stage:pending', 'stage:settled']) {
        const found = await service.withTenant(tenant, (trx) =>
          searchWords(trx, ada, query, { scope: 'all' }),
        );
        expect({ query, items: resultsOf(found).items }).toMatchObject({
          query,
          items: [{ artifactId: artifact }],
        });
      }
    } finally {
      await service.close();
    }
  });
});
