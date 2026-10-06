import {
  DefinitionRefused,
  canonicaliseVersion,
  defaultLimits,
  limitCeilings,
  type ConnectionSettings,
  type PostgresSettings,
  type QueryDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection, recordConnectionVersion, type StoredConnection } from './connections.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  createQueryDefinition,
  dataPolicy,
  definitionsNaming,
  listReadableQueryDefinitions,
  readQueryDefinition,
  recordQueryDefinitionVersion,
  setDataPolicy,
  type StoredQueryDefinition,
} from './queryDefinitions.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';
import { createArtifact, latestVersion, recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';

const settings = (over: Partial<PostgresSettings> = {}): PostgresSettings => ({
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
  ...over,
});

const definition = (connection: string, over: Partial<QueryDefinition> = {}): QueryDefinition => ({
  schemaVersion: 1,
  title: 'Readings by site',
  description: 'Each reading at a site, oldest first.',
  connection,
  parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
  fetch: {
    kind: 'sql',
    text: 'select id, taken from sample.reading where site = {{site}} order by id',
  },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'taken', from: { column: 'taken' }, type: { base: 'instant', fraction: 3 } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { ...defaultLimits },
  retired: false,
  ...over,
});

describe('a query definition', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  let connection: StoredConnection;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const newConnection = (over: Partial<PostgresSettings> = {}, spaceId = general) =>
    service.withTenant(production, async (trx) => {
      const answer = await createConnection(trx, {
        author: ada,
        spaceId,
        settings: settings(over),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.connection;
    });

  const made = (over: Partial<QueryDefinition> = {}, spaceId = general) =>
    service.withTenant(production, async (trx) => {
      const answer = await createQueryDefinition(trx, {
        author: ada,
        spaceId,
        definition: definition(connection.id, over),
      });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.definition;
    });

  const version = (
    current: StoredQueryDefinition,
    over: Partial<QueryDefinition>,
    openedFrom = current.version.id,
  ) =>
    service.withTenant(production, (trx) =>
      recordQueryDefinitionVersion(trx, {
        author: ada,
        id: current.id,
        openedFrom,
        definition: { ...current.definition, ...over },
      }),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada reads General and Quality; Grace reads Quality alone.
      const reader = await findRole(trx, 'Reader');
      for (const [principal, space] of [
        [ada, general],
        [ada, quality],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: reader!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
    connection = await newConnection();
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it("DAT-009 makes a query definition in one space of the tenant's own schema, as an artifact whose every change is a version, naming exactly one connection", async () => {
    const first = await made();
    expect(first.definition).toEqual(definition(connection.id));
    expect(first.space).toEqual({ id: general, name: 'General' });
    expect(first.connection).toEqual({ id: connection.id, name: 'Readings', retired: false });
    expect(first.version).toMatchObject({
      revision: 0,
      version: 1,
      author: ada,
      kind: 'queryDefinition',
    });

    // An artifact of its own kind, in one space, in this tenant's schema and in no other.
    const rows = await queryAs(
      db.adminUrl,
      `select kind, space_id from ${production.schema}.artifact where id = $1`,
      [first.id],
    );
    expect(rows.rows).toEqual([{ kind: 'queryDefinition', space_id: general }]);
    const elsewhere = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${development.schema}.artifact where id = $1`,
      [first.id],
    );
    expect(elsewhere.rows).toEqual([{ n: 0 }]);
    expect(
      await service.withTenant(development, (trx) => readQueryDefinition(trx, first.id)),
    ).toBeUndefined();
    expect(
      await service.withTenant(production, (trx) => readQueryDefinition(trx, first.id)),
    ).toEqual(first);

    // Exactly one connection: never two, never none.
    for (const connections of [[connection.id, connection.id], undefined]) {
      const refused = await service.withTenant(production, (trx) =>
        createQueryDefinition(trx, {
          author: ada,
          spaceId: general,
          definition: { ...definition(connection.id), connection: connections },
        }),
      );
      expect(refused).toMatchObject({
        answer: 'definition.refused',
        problems: [{ rule: 'definition_invalid', path: 'connection' }],
      });
    }
    // And a connection, never another kind's artifact in its place.
    const component = await service.withTenant(production, async (trx) => {
      const answer = await createComponent(trx, {
        spaceId: general,
        title: 'Not a connection either',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.version.artifactId;
    });
    expect(
      await service.withTenant(production, (trx) =>
        createQueryDefinition(trx, {
          author: ada,
          spaceId: general,
          definition: definition(component),
        }),
      ),
    ).toMatchObject({
      answer: 'definition.refused',
      problems: [{ rule: 'definition_invalid', path: 'connection' }],
    });

    // Its every change is a version: a version once cut is never changed or removed.
    const second = await version(first, { title: 'Readings by site, oldest first' });
    if (second.answer !== 'recorded') throw new Error(second.answer);
    expect([second.definition.version.revision, second.definition.version.version]).toEqual([0, 2]);
    for (const statement of [
      sql`update artifact_version set content = content where id = ${first.version.id}`,
      sql`delete from artifact_version where id = ${first.version.id}`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('VER-057 versions a query definition by the chain every artifact uses: an author, the schema version, both digests and the version it was opened from', async () => {
    const first = await made({ title: 'Readings at a site' });
    // Nothing changed is no version, and not an error.
    expect((await version(first, {})).answer).toBe('version.unchanged');
    const second = await version(first, { empty: 'invalid' });
    if (second.answer !== 'recorded') throw new Error(second.answer);
    const stored = second.definition.version;
    expect(stored).toMatchObject({ author: ada, schemaVersion: 1, revision: 0, version: 2 });
    // Both digests, recomputed from the row as stored.
    expect(versionDigests(substanceOf(stored))).toEqual({
      contentHash: stored.contentHash,
      versionDigest: stored.versionDigest,
    });
    // A change made from a version that is no longer the latest is refused, naming the latest.
    const stale = await version(
      first,
      { empty: 'valid', title: 'Readings, stale' },
      first.version.id,
    );
    expect(stale).toMatchObject({
      answer: 'version.precondition',
      current: { version: { id: stored.id } },
    });
  });

  it('gives one digest for any order of its members, and refuses a text differing only in normalisation rather than answer it unchanged', async () => {
    const one = definition(connection.id);
    const reordered = Object.fromEntries(Object.entries(one).reverse()) as QueryDefinition;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(one));
    expect(canonicaliseVersion({ kind: 'queryDefinition', content: reordered })).toBe(
      canonicaliseVersion({ kind: 'queryDefinition', content: one }),
    );
    const composed = await made({ title: `Caf${String.fromCodePoint(0xe9)} readings` });
    const decomposed = await version(composed, {
      title: `Cafe${String.fromCodePoint(0x301)} readings`,
    });
    expect(decomposed).toMatchObject({
      answer: 'definition.refused',
      problems: [{ rule: 'definition_invalid', path: 'title' }],
    });
  });

  it('refuses, through createArtifact and recordVersion themselves, a definition naming anything but a connection of the tenant in service', async () => {
    const component = await service.withTenant(production, async (trx) => {
      const answer = await createComponent(trx, {
        spaceId: general,
        title: 'Not a connection',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.version.artifactId;
    });
    const retired = await newConnection({ name: 'Retired' });
    await service.withTenant(production, (trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: retired.id,
        openedFrom: retired.version.id,
        settings: { ...retired.settings, retired: true },
      }),
    );
    const unknown = '00000000-0000-4000-8000-00000000dead';
    for (const [what, id] of [
      ['a component', component],
      ['an unknown id', unknown],
      ['a retired connection', retired.id],
    ] as const) {
      await expect(
        service.withTenant(production, (trx) =>
          createArtifact(trx, {
            author: ada,
            spaceId: general,
            substance: { kind: 'queryDefinition', content: definition(id) },
          }),
        ),
        what,
      ).rejects.toThrow(DefinitionRefused);
      const answer = await service.withTenant(production, (trx) =>
        createQueryDefinition(trx, { author: ada, spaceId: general, definition: definition(id) }),
      );
      expect(answer, what).toMatchObject({
        answer: 'definition.refused',
        problems: [{ rule: 'definition_invalid', path: 'connection' }],
      });
    }
    // And a later version pointing at any of them, whatever writes it.
    const first = await made({ title: 'Pointed elsewhere' });
    for (const id of [component, unknown, retired.id]) {
      await expect(
        service.withTenant(production, (trx) =>
          recordVersion(trx, {
            artifactId: first.id,
            openedFrom: first.version.id,
            author: ada,
            substance: {
              kind: 'queryDefinition',
              content: { ...first.definition, connection: id },
            },
          }),
        ),
      ).rejects.toThrow(DefinitionRefused);
    }
    // A definition is made in service: retiring it is a later version.
    await expect(
      service.withTenant(production, (trx) =>
        createArtifact(trx, {
          author: ada,
          spaceId: general,
          substance: {
            kind: 'queryDefinition',
            content: definition(connection.id, { retired: true }),
          },
        }),
      ),
    ).rejects.toThrow(DefinitionRefused);
    // A definition's content is read back by its shape alone.
    const stored = await service.withTenant(production, (trx) => latestVersion(trx, first.id));
    expect(substanceOf(stored!)).toEqual({ kind: 'queryDefinition', content: first.definition });
  });

  it("checks every definition createArtifact and recordVersion write, not only those the store's own writers hand them", async () => {
    const decomposed = `Cafe${String.fromCodePoint(0x301)} readings`;
    const unordered = { key: [], order: [{ column: 'id', direction: 'ascending' as const }] };
    for (const over of [{ title: decomposed }, unordered]) {
      await expect(
        service.withTenant(production, (trx) =>
          createArtifact(trx, {
            author: ada,
            spaceId: general,
            substance: { kind: 'queryDefinition', content: definition(connection.id, over) },
          }),
        ),
      ).rejects.toThrow(DefinitionRefused);
    }
    const first = await made({ title: 'Checked on every path' });
    await expect(
      service.withTenant(production, (trx) =>
        recordVersion(trx, {
          artifactId: first.id,
          openedFrom: first.version.id,
          author: ada,
          substance: { kind: 'queryDefinition', content: { ...first.definition, ...unordered } },
        }),
      ),
    ).rejects.toThrow(DefinitionRefused);
  });

  it('is listed to who may read it, by space and by connection, with its title, connection and whether it is retired', async () => {
    const other = await newConnection({ name: 'Warehouse' }, quality);
    const inQuality = await service.withTenant(production, async (trx) => {
      const answer = await createQueryDefinition(trx, {
        author: ada,
        spaceId: quality,
        definition: definition(other.id, { title: 'Stock by site' }),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.definition;
    });
    const listed = (principal: string, filter = {}) =>
      service.withTenant(production, (trx) =>
        listReadableQueryDefinitions(trx, principal, { limit: 100 }, filter),
      );
    const byGrace = await listed(grace);
    expect(byGrace?.items.map((item) => item.id)).toEqual([inQuality.id]);
    expect(byGrace?.items[0]).toMatchObject({
      title: 'Stock by site',
      connection: { id: other.id, name: 'Warehouse' },
      retired: false,
      space: { id: quality, name: 'Quality' },
    });
    const byAda = await listed(ada, { connection: other.id });
    expect(byAda?.items.map((item) => item.id)).toEqual([inQuality.id]);
    const inGeneral = await listed(ada, { spaces: [general] });
    expect(inGeneral?.items.length).toBeGreaterThan(0);
    expect(inGeneral?.items.every((item) => item.space.id === general)).toBe(true);
    expect(inGeneral?.facets.spaces.map((facet) => facet.value).sort()).toEqual(
      [general, quality].sort(),
    );
  });

  it('answers the definitions naming a connection from their latest versions, those the caller may read by title and the rest counted', async () => {
    const named = await newConnection({ name: 'Named' });
    const readable = await service.withTenant(production, async (trx) => {
      const answer = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: definition(named.id, { title: 'In General' }),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.definition;
    });
    const hidden = await service.withTenant(production, async (trx) => {
      const answer = await createQueryDefinition(trx, {
        author: ada,
        spaceId: quality,
        definition: definition(named.id, { title: 'In Quality' }),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.definition;
    });
    // One that named it once and names another now is not counted.
    const moved = await service.withTenant(production, async (trx) => {
      const answer = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: definition(named.id, { title: 'Moved' }),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.definition;
    });
    expect((await version(moved, { connection: connection.id })).answer).toBe('recorded');
    const retiredOne = await version(hidden, { retired: true });
    expect(retiredOne.answer).toBe('recorded');

    const naming = (principal: string, options = {}) =>
      service.withTenant(production, (trx) => definitionsNaming(trx, principal, named.id, options));
    expect(await naming(grace)).toEqual({
      readable: [{ id: hidden.id, title: 'In Quality', retired: true }],
      others: 1,
    });
    expect(await naming(ada)).toEqual({
      readable: [
        { id: readable.id, title: 'In General', retired: false },
        { id: hidden.id, title: 'In Quality', retired: true },
      ],
      others: 0,
    });
    // Those still in service alone, as retiring the connection asks.
    expect(await naming(grace, { inService: true })).toEqual({ readable: [], others: 1 });
  });

  it("holds the tenant's lowered limits, none lowered at first, each from 1 to its ceiling", async () => {
    expect(await service.withTenant(production, (trx) => dataPolicy(trx))).toEqual({
      rows: null,
      bytes: null,
      seconds: null,
    });
    await service.withTenant(production, (trx) =>
      setDataPolicy(trx, { rows: 500, bytes: null, seconds: 10 }),
    );
    expect(await service.withTenant(production, (trx) => dataPolicy(trx))).toEqual({
      rows: 500,
      bytes: null,
      seconds: 10,
    });
    for (const bad of [0, limitCeilings.rows + 1, 1.5]) {
      await expect(
        service.withTenant(production, (trx) =>
          setDataPolicy(trx, { rows: bad, bytes: null, seconds: null }),
        ),
      ).rejects.toThrow();
    }
    expect(await service.withTenant(development, (trx) => dataPolicy(trx))).toEqual({
      rows: null,
      bytes: null,
      seconds: null,
    });
  });
});
