import {
  defaultLimits,
  OUTLINE_SCHEMA_VERSION,
  type ConnectionSettings,
  type ContentDocument,
  type Provenance,
  type QueryDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection, type StoredConnection } from './connections.js';
import { createComponent } from './creation.js';
import {
  componentsBinding,
  datasetFor,
  datasetIdentity,
  datasetName,
  documentsHolding,
  documentsResolving,
  lockBindings,
  lockDatasetQuestions,
  nameDataset,
  recordDatasetVersion,
  recordResolution,
  resolutionsOf,
} from './datasets.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  createQueryDefinition,
  recordQueryDefinitionVersion,
  type StoredQueryDefinition,
} from './queryDefinitions.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  datasetQuestionLockKey,
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
} from './testing/database.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';

const ISSUER = 'https://idp.example';

const settings: ConnectionSettings = {
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
};

const definition = (connection: string, over: Partial<QueryDefinition> = {}): QueryDefinition => ({
  schemaVersion: 1,
  title: 'Depth by site',
  description: '',
  connection,
  parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
  fetch: {
    kind: 'sql',
    text: 'select id, depth from sample.reading where site = {{site}} order by id',
  },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 6, scale: 2 } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { ...defaultLimits },
  retired: false,
  ...over,
});

const SQL_RAN = 'select id, depth from sample.reading where site = $1 order by id';

/** Twenty-six of the outline's letters: a node's identifier, made from one letter. */
const node = (letter: string) => letter.repeat(26);

describe('datasets and resolutions', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  let connection: StoredConnection;
  let query: StoredQueryDefinition;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const provenance = (over: Partial<Provenance> = {}): Provenance => ({
    schemaVersion: 1,
    queryDefinition: { artifact: query.id, version: query.version.id },
    connection: { artifact: connection.id, version: connection.version.id },
    parameters: { site: 'north' },
    ran: { sql: SQL_RAN },
    identity: { kind: 'service' },
    at: '2026-10-03T09:15:00.000Z',
    durationMs: 12,
    rowCount: 2,
    columns: definition(connection.id).columns,
    canonical: 1,
    checksum: 'a'.repeat(64),
    images: {},
    ...over,
  });

  const recorded = (over: Partial<Provenance> = {}) =>
    tenant((trx) => recordDatasetVersion(trx, { provenance: provenance(over), author: ada }));

  /** A component in a space, its latest version holding these paragraphs' inlines. */
  const componentHolding = async (spaceId: string, inlines: unknown[], title = 'Depths') =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const content = made.version.content as ContentDocument;
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          ...(substanceOf(made.version) as Extract<
            ReturnType<typeof substanceOf>,
            { kind: 'component' }
          >),
          content: {
            ...content,
            content: [{ type: 'paragraph', id: 'b1', style: 'body', content: inlines }],
          } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const binding = (over: Record<string, unknown> = {}) => ({
    type: 'binding',
    id: 'k1',
    query: query.id,
    parameters: { site: { literal: 'north' } },
    mode: 'checked',
    take: { key: { id: '1' }, column: 'depth' },
    ...over,
  });

  /** A document in a space referencing a component at a node. */
  const documentReferencing = (spaceId: string, component: string, at: string, title = 'Report') =>
    tenant((trx) =>
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
            nodes: [
              {
                type: 'reference',
                id: at,
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                component,
                mode: { kind: 'latest' },
                children: [],
              },
            ],
          },
        } as never,
      }),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await tenant(async (trx) => {
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
      const made = await createConnection(trx, { author: ada, spaceId: general, settings });
      if (made.answer !== 'created') throw new Error(made.answer);
      connection = made.connection;
      const defined = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: definition(connection.id),
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      query = defined.definition;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('DAT-092 records each stored result as an immutable version of a dataset, apart from the bindings using it, which may be named', async () => {
    const first = await recorded({ parameters: { site: 'immutable' } });
    expect(first.reused).toBe(false);
    expect(first.version).toMatchObject({ kind: 'dataset', revision: 0, version: 1, author: ada });
    expect(first.dataset.id).toBe(first.version.artifactId);
    // A dataset is an artifact of its own, apart from any component or document, in its definition's
    // space.
    const rows = await queryAs(
      db.adminUrl,
      `select kind, space_id from ${production.schema}.artifact where id = $1`,
      [first.dataset.id],
    );
    expect(rows.rows).toEqual([{ kind: 'dataset', space_id: general }]);
    // Its version is immutable: the runtime role changes and removes none.
    await expect(
      tenant((trx) =>
        sql`update artifact_version set content = '{}' where id = ${first.version.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenant((trx) =>
        sql`delete from artifact_version where id = ${first.version.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    // A different result is a second version of the same dataset; the first stands as it was.
    const second = await recorded({ parameters: { site: 'immutable' }, checksum: 'b'.repeat(64) });
    expect(second.dataset.id).toBe(first.dataset.id);
    expect(second.version.id).not.toBe(first.version.id);
    expect(second.version).toMatchObject({ revision: 0, version: 2 });
    expect((await tenant((trx) => readVersion(trx, first.version.id)))!.content).toEqual(
      first.version.content,
    );

    // It may be named: each name a row, the latest the name, none changed or removed.
    expect(await tenant((trx) => datasetName(trx, first.dataset.id))).toBeNull();
    const named = await tenant((trx) =>
      nameDataset(trx, { dataset: first.dataset.id, name: 'Northern depths', by: ada }),
    );
    expect(named).toMatchObject({ answer: 'named', name: 'Northern depths', namedBy: ada });
    await tenant((trx) =>
      nameDataset(trx, { dataset: first.dataset.id, name: 'Depths, north', by: grace }),
    );
    expect(await tenant((trx) => datasetName(trx, first.dataset.id))).toMatchObject({
      name: 'Depths, north',
      namedBy: grace,
    });
    await expect(
      tenant((trx) => sql`update dataset_name set name = 'Other'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(tenant((trx) => sql`delete from dataset_name`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );

    // A binding references exactly one dataset version, in the document that resolved it.
    const component = await componentHolding(general, [binding()]);
    const document = await documentReferencing(general, component.artifactId, node('a'));
    const resolution = await tenant((trx) =>
      recordResolution(trx, {
        document: document.artifactId,
        node: node('a'),
        binding: 'k1',
        digest: 'c'.repeat(64),
        version: first.version.id,
        replaces: null,
        act: 'resolve',
        by: ada,
      }),
    );
    expect(resolution).toMatchObject({ dataset: first.dataset.id, version: first.version.id });
  });

  it("DAT-085 records with each dataset version its provenance: the definition and connection with their versions, the parameters, the identity, the SQL that ran, the time, the row count, the canonical form's version and the result's checksum", async () => {
    const written = provenance({
      parameters: { site: 'provenance' },
      rowCount: 7,
      durationMs: 31,
      at: '2026-10-03T10:00:00.250Z',
      checksum: 'd'.repeat(64),
    });
    const { version } = await tenant((trx) =>
      recordDatasetVersion(trx, { provenance: written, author: ada }),
    );
    const read = (await tenant((trx) => readVersion(trx, version.id)))!;
    expect(read.content).toEqual(written);
    const content = read.content as Provenance;
    expect(content.queryDefinition).toEqual({ artifact: query.id, version: query.version.id });
    expect(content.connection).toEqual({ artifact: connection.id, version: connection.version.id });
    expect(content.parameters).toEqual({ site: 'provenance' });
    expect(content.identity).toEqual({ kind: 'service' });
    expect(content.ran).toEqual({ sql: SQL_RAN });
    expect(content.at).toBe('2026-10-03T10:00:00.250Z');
    expect(content.rowCount).toBe(7);
    expect(content.canonical).toBe(1);
    expect(content.checksum).toBe('d'.repeat(64));
    // A record that is not a provenance record is refused on every path a version is written by.
    await expect(
      tenant((trx) =>
        recordDatasetVersion(trx, {
          provenance: { ...written, checksum: 'not a checksum' } as Provenance,
          author: ada,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      tenant((trx) =>
        createArtifact(trx, {
          author: ada,
          spaceId: general,
          substance: { kind: 'dataset', content: { ...written, ran: { sql: '' } } },
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a provenance naming a definition or connection version that is not that artifact's", async () => {
    for (const over of [
      { queryDefinition: { artifact: query.id, version: connection.version.id } },
      { connection: { artifact: connection.id, version: query.version.id } },
      { queryDefinition: { artifact: connection.id, version: connection.version.id } },
      {
        queryDefinition: {
          artifact: query.id,
          version: '00000000-0000-4000-8000-0000000000f1',
        },
      },
    ]) {
      await expect(
        recorded({ parameters: { site: 'refused' }, ...over }),
        JSON.stringify(over),
      ).rejects.toThrow(/provenance/);
    }
  });

  it('refuses a provenance naming a connection that is not the one its definition version names', async () => {
    const other = await tenant(async (trx) => {
      const made = await createConnection(trx, {
        author: ada,
        spaceId: general,
        settings: { ...settings, name: 'Elsewhere' },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.connection;
    });
    await expect(
      recorded({
        parameters: { site: 'elsewhere' },
        connection: { artifact: other.id, version: other.version.id },
      }),
    ).rejects.toThrow(/provenance/);
  });

  it('holds one dataset for each question: one definition, the same parameters, the same identity', async () => {
    const north = await recorded({ parameters: { site: 'question' } });
    const again = await recorded({ parameters: { site: 'question' }, checksum: 'e'.repeat(64) });
    const south = await recorded({ parameters: { site: 'question-south' } });
    expect(again.dataset.id).toBe(north.dataset.id);
    expect(south.dataset.id).not.toBe(north.dataset.id);
    const identity = datasetIdentity({
      definition: query.id,
      parameters: { site: 'question' },
      identity: { kind: 'service' },
    });
    expect(identity.parametersDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(await tenant((trx) => datasetFor(trx, identity))).toMatchObject({
      id: north.dataset.id,
      definition: query.id,
      identityKey: 'service',
      spaceId: general,
    });
    expect(
      await tenant((trx) =>
        datasetFor(
          trx,
          datasetIdentity({
            definition: query.id,
            parameters: { site: 'never asked' },
            identity: { kind: 'service' },
          }),
        ),
      ),
    ).toBeUndefined();
    // The table holds the identity unique, whatever writes it.
    await expect(
      tenant(async (trx) => {
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'dataset', space_id: general })
          .returning('id')
          .executeTakeFirstOrThrow();
        await sql`insert into dataset (artifact_id, query_definition, parameters_digest, identity_key)
                  values (${artifact.id}, ${query.id}, ${identity.parametersDigest}, 'service')`.execute(
          trx,
        );
      }),
    ).rejects.toThrow(/dataset_query_definition_parameters_digest_identity_key_key/);
    // And an identity key of a form it does not know.
    await expect(
      tenant(async (trx) => {
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'dataset', space_id: general })
          .returning('id')
          .executeTakeFirstOrThrow();
        await sql`insert into dataset (artifact_id, query_definition, parameters_digest, identity_key)
                  values (${artifact.id}, ${query.id}, ${'f'.repeat(64)}, 'somebody')`.execute(trx);
      }),
    ).rejects.toThrow(/dataset_identity_key/);
  });

  it('reuses the latest version only where the checksum, the definition version and the SQL that ran are all unchanged', async () => {
    const site = { site: 'reuse' };
    const first = await recorded({ parameters: site, checksum: '1'.repeat(64) });
    const same = await recorded({
      parameters: site,
      checksum: '1'.repeat(64),
      at: '2026-10-03T11:00:00.000Z',
      durationMs: 99,
    });
    expect(same).toMatchObject({ reused: true });
    expect(same.version.id).toBe(first.version.id);

    // Another SQL ran: a new version, though the rows are the same.
    const otherSql = await recorded({
      parameters: site,
      checksum: '1'.repeat(64),
      ran: { sql: `${SQL_RAN} ` },
    });
    expect(otherSql.reused).toBe(false);
    expect(otherSql.version.id).not.toBe(first.version.id);

    // Another definition version ran: a new version, though the rows and the SQL are the same.
    const cut = await tenant((trx) =>
      recordQueryDefinitionVersion(trx, {
        author: ada,
        id: query.id,
        openedFrom: query.version.id,
        definition: { ...query.definition, description: 'Each depth at a site.' },
      }),
    );
    if (cut.answer !== 'recorded') throw new Error(cut.answer);
    const otherDefinition = await recorded({
      parameters: site,
      checksum: '1'.repeat(64),
      ran: { sql: `${SQL_RAN} ` },
      queryDefinition: { artifact: query.id, version: cut.definition.version.id },
    });
    expect(otherDefinition.reused).toBe(false);
    expect(otherDefinition.version.id).not.toBe(otherSql.version.id);

    // Another result: a new version.
    const otherRows = await recorded({
      parameters: site,
      checksum: '2'.repeat(64),
      ran: { sql: `${SQL_RAN} ` },
      queryDefinition: { artifact: query.id, version: cut.definition.version.id },
    });
    expect(otherRows.reused).toBe(false);
    expect(otherRows.version.id).not.toBe(otherDefinition.version.id);
    query = cut.definition;
  });

  it('keeps every resolution, and refuses one replacing a version of another dataset', async () => {
    const one = await recorded({ parameters: { site: 'resolution-one' } });
    const later = await recorded({
      parameters: { site: 'resolution-one' },
      checksum: '3'.repeat(64),
    });
    const other = await recorded({ parameters: { site: 'resolution-other' } });
    const component = await componentHolding(general, [binding()]);
    const document = await documentReferencing(general, component.artifactId, node('b'));
    const resolve = (version: string, replaces: string | null, act: 'resolve' | 'accept') =>
      tenant((trx) =>
        recordResolution(trx, {
          document: document.artifactId,
          node: node('b'),
          binding: 'k1',
          digest: 'c'.repeat(64),
          version,
          replaces,
          act,
          by: ada,
        }),
      );
    await resolve(one.version.id, null, 'resolve');
    await expect(resolve(later.version.id, other.version.id, 'accept')).rejects.toThrow(
      /binding_resolution_replaces_fkey|foreign key/,
    );
    // An acceptance names what it replaces.
    await expect(resolve(later.version.id, null, 'accept')).rejects.toThrow(
      /binding_resolution_accept_replaces/,
    );
    const accepted = await resolve(later.version.id, one.version.id, 'accept');
    expect(accepted).toMatchObject({ act: 'accept', replaces: one.version.id });
    // A version of a document, not a dataset, is refused.
    await expect(resolve(document.id, null, 'resolve')).rejects.toThrow(/dataset version/);
    await expect(
      tenant((trx) => sql`update binding_resolution set act = 'resolve'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(tenant((trx) => sql`delete from binding_resolution`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('records a confirm only where it replaces the version it holds', async () => {
    const one = await recorded({ parameters: { site: 'confirm-one' } });
    const later = await recorded({ parameters: { site: 'confirm-one' }, checksum: '4'.repeat(64) });
    const component = await componentHolding(general, [binding()]);
    const document = await documentReferencing(general, component.artifactId, node('c'));
    const record = (version: string, replaces: string | null, act: 'resolve' | 'confirm') =>
      tenant((trx) =>
        recordResolution(trx, {
          document: document.artifactId,
          node: node('c'),
          binding: 'k1',
          digest: 'd'.repeat(64),
          version,
          replaces,
          act,
          by: ada,
        }),
      );
    await record(one.version.id, null, 'resolve');
    await expect(record(later.version.id, one.version.id, 'confirm')).rejects.toThrow(
      /binding_resolution_confirm_holds/,
    );
    await expect(record(one.version.id, null, 'confirm')).rejects.toThrow(
      /binding_resolution_accept_replaces/,
    );
    expect(await record(one.version.id, one.version.id, 'confirm')).toMatchObject({
      act: 'confirm',
      version: one.version.id,
      replaces: one.version.id,
    });
    const held = await tenant((trx) => resolutionsOf(trx, document.artifactId, new Map()));
    expect(held.map((each) => each.act)).toEqual(['confirm']);
  });

  it('answers the documents holding a value for a binding of a component, naming those the caller may read', async () => {
    const result = await recorded({ parameters: { site: 'holders' } });
    const component = await componentHolding(general, [binding()], 'Held depths');
    const resolveIn = async (space: string, at: string, title: string, id = 'k1') => {
      const document = await documentReferencing(space, component.artifactId, at, title);
      await tenant((trx) =>
        recordResolution(trx, {
          document: document.artifactId,
          node: at,
          binding: id,
          digest: '9'.repeat(64),
          version: result.version.id,
          replaces: null,
          act: 'resolve',
          by: ada,
        }),
      );
      return document;
    };
    await resolveIn(general, node('g'), 'General holder');
    const inQuality = await resolveIn(quality, node('h'), 'Quality holder');
    // Another binding's resolution, and a document placing the component holding nothing, are not.
    await resolveIn(quality, node('i'), 'Another binding', 'k2');
    await documentReferencing(quality, component.artifactId, node('j'), 'Never resolved');
    expect(await tenant((trx) => documentsHolding(trx, grace, component.artifactId, 'k1'))).toEqual(
      { readable: [{ id: inQuality.artifactId, title: 'Quality holder' }], others: 1 },
    );
    const forAda = await tenant((trx) => documentsHolding(trx, ada, component.artifactId, 'k1'));
    expect(forAda.readable.map((each) => each.title)).toEqual(['General holder', 'Quality holder']);
    expect(forAda.others).toBe(0);
  });

  it('answers what each binding holds in a document, the latest resolution, and a newer result waiting', async () => {
    const held = await recorded({ parameters: { site: 'held' }, checksum: '4'.repeat(64) });
    const component = await componentHolding(general, [
      binding(),
      binding({ id: 'k2', parameters: { site: { literal: 'held' } } }),
    ]);
    const document = await documentReferencing(general, component.artifactId, node('c'));
    const resolve = (bindingId: string, version: string, replaces: string | null) =>
      tenant((trx) =>
        recordResolution(trx, {
          document: document.artifactId,
          node: node('c'),
          binding: bindingId,
          digest: '5'.repeat(64),
          version,
          replaces,
          act: replaces === null ? 'resolve' : 'accept',
          by: ada,
        }),
      );
    await resolve('k1', held.version.id, null);
    await resolve('k2', held.version.id, null);
    const asked = new Map([
      [`${node('c')} k1`, query.version.id],
      [`${node('c')} k2`, query.version.id],
    ]);
    expect(await tenant((trx) => resolutionsOf(trx, document.artifactId, asked))).toEqual([
      expect.objectContaining({
        node: node('c'),
        binding: 'k1',
        digest: '5'.repeat(64),
        act: 'resolve',
        held: expect.objectContaining({
          dataset: held.dataset.id,
          version: held.version.id,
          provenance: held.version.content,
        }),
        waiting: null,
      }),
      expect.objectContaining({ binding: 'k2', waiting: null }),
    ]);

    // The same result found again is not a revision; a different one, recorded after, is.
    await recorded({ parameters: { site: 'held' }, checksum: '4'.repeat(64) });
    expect(
      (await tenant((trx) => resolutionsOf(trx, document.artifactId, asked)))[0]!.waiting,
    ).toBeNull();
    // Nor is the same result from other SQL: a version of its own (D3-F), and no revision.
    const sameRows = await recorded({
      parameters: { site: 'held' },
      checksum: '4'.repeat(64),
      ran: { sql: `${SQL_RAN} ` },
    });
    expect(sameRows.reused).toBe(false);
    expect(
      (await tenant((trx) => resolutionsOf(trx, document.artifactId, asked)))[0]!.waiting,
    ).toBeNull();
    const newer = await recorded({ parameters: { site: 'held' }, checksum: '6'.repeat(64) });
    const [k1, k2] = await tenant((trx) => resolutionsOf(trx, document.artifactId, asked));
    expect(k1!.waiting).toEqual({ version: newer.version.id, provenance: newer.version.content });
    expect(k2!.waiting).toMatchObject({ version: newer.version.id });

    // Accepting it moves that binding alone; the latest row is what it holds.
    await resolve('k1', newer.version.id, held.version.id);
    const [afterK1, afterK2] = await tenant((trx) =>
      resolutionsOf(trx, document.artifactId, asked),
    );
    expect(afterK1).toMatchObject({
      act: 'accept',
      replaces: held.version.id,
      held: { version: newer.version.id },
      waiting: null,
    });
    expect(afterK2).toMatchObject({ held: { version: held.version.id } });
    expect(afterK2!.waiting).toMatchObject({ version: newer.version.id });
  });

  it('DAT-070 offers a floating binding a newer definition version returning the same rows, and a binding nothing of a definition version it does not ask', async () => {
    const site = { site: 'asked' };
    const first = query.version.id;
    const held = await recorded({ parameters: site, checksum: '7'.repeat(64) });
    const component = await componentHolding(general, [
      binding({ parameters: { site: { literal: 'asked' } } }),
      binding({ id: 'k2', parameters: { site: { literal: 'asked' } }, version: first }),
    ]);
    const document = await documentReferencing(general, component.artifactId, node('d'));
    for (const id of ['k1', 'k2']) {
      await tenant((trx) =>
        recordResolution(trx, {
          document: document.artifactId,
          node: node('d'),
          binding: id,
          digest: '8'.repeat(64),
          version: held.version.id,
          replaces: null,
          act: 'resolve',
          by: ada,
        }),
      );
    }
    const cut = await tenant((trx) =>
      recordQueryDefinitionVersion(trx, {
        author: ada,
        id: query.id,
        openedFrom: first,
        definition: { ...query.definition, description: 'Each depth, asked again.' },
      }),
    );
    if (cut.answer !== 'recorded') throw new Error(cut.answer);
    const second = cut.definition.version.id;
    // k1 floats, so asks the latest; k2 is pinned to the first.
    const asked = new Map([
      [`${node('d')} k1`, second],
      [`${node('d')} k2`, first],
    ]);
    const now = async () => {
      const [k1, k2] = await tenant((trx) => resolutionsOf(trx, document.artifactId, asked));
      return { k1: k1!.waiting?.version ?? null, k2: k2!.waiting?.version ?? null };
    };

    // The newer definition version returns the same rows: a revision for k1, nothing for k2.
    const sameRows = await recorded({
      parameters: site,
      checksum: '7'.repeat(64),
      queryDefinition: { artifact: query.id, version: second },
    });
    expect(await now()).toEqual({ k1: sameRows.version.id, k2: null });

    // A later result of the first version, different rows: k2's revision, and never k1's.
    const older = await recorded({ parameters: site, checksum: '9'.repeat(64) });
    expect(await now()).toEqual({ k1: sameRows.version.id, k2: older.version.id });

    // A binding the map does not name waits on nothing.
    const [unasked] = await tenant((trx) =>
      resolutionsOf(trx, document.artifactId, new Map([[`${node('d')} k2`, first]])),
    );
    expect(unasked!.waiting).toBeNull();
    query = cut.definition;
  });

  it('refuses a dataset name that is empty, too long, padded, holds a control character or is not in NFC', async () => {
    const dataset = (await recorded({ parameters: { site: 'names' } })).dataset.id;
    for (const name of [
      '',
      ' ',
      'x'.repeat(201),
      ' Depths',
      'Depths ',
      `Dep${String.fromCharCode(9)}ths`,
      `Cafe${String.fromCharCode(0x301)}`,
    ]) {
      expect(
        await tenant((trx) => nameDataset(trx, { dataset, name, by: ada })),
        JSON.stringify(name),
      ).toEqual({ answer: 'name.invalid' });
    }
    expect(
      await tenant((trx) => nameDataset(trx, { dataset, name: 'x'.repeat(200), by: ada })),
    ).toMatchObject({ answer: 'named' });
    expect(
      await tenant((trx) =>
        nameDataset(trx, { dataset: query.id, name: 'Not a dataset', by: ada }),
      ),
    ).toEqual({ answer: 'dataset.missing' });
    // The table holds the rule too, whatever writes it.
    await expect(
      tenant((trx) =>
        sql`insert into dataset_name (dataset_id, name, named_by) values (${dataset}, ' Padded', ${ada})`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/dataset_name_name/);
  });

  it('answers the components whose latest versions bind a definition, and the documents resolving it, naming those the caller may read', async () => {
    const own = await tenant(async (trx) => {
      const defined = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: definition(connection.id, { title: 'Where used' }),
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      return defined.definition;
    });
    const naming = (over: Record<string, unknown> = {}) => binding({ query: own.id, ...over });
    const inGeneral = await componentHolding(general, [naming()], 'General depths');
    const inQuality = await componentHolding(quality, [naming()], 'Quality depths');
    // A component whose key value happens to spell the definition's identifier names nothing.
    await componentHolding(
      general,
      [binding({ take: { key: { query: own.id }, column: 'depth' } })],
      'Lookalike',
    );
    // A component that bound it at an earlier version and no longer does is not counted.
    const earlier = await componentHolding(general, [naming()], 'Earlier');
    await tenant(async (trx) => {
      const content = earlier.content as ContentDocument;
      const next = await recordVersion(trx, {
        artifactId: earlier.artifactId,
        openedFrom: earlier.id,
        author: ada,
        substance: {
          ...(substanceOf(earlier) as Extract<
            ReturnType<typeof substanceOf>,
            { kind: 'component' }
          >),
          content: {
            ...content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: 'Unbound.', marks: [] }],
              },
            ],
          } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
    });

    const forAda = await tenant((trx) => componentsBinding(trx, ada, own.id));
    expect(forAda.readable.map((each) => each.title).sort()).toEqual([
      'General depths',
      'Quality depths',
    ]);
    expect(forAda.others).toBe(0);
    const forGrace = await tenant((trx) => componentsBinding(trx, grace, own.id));
    expect(forGrace).toEqual({
      readable: [{ id: inQuality.artifactId, title: 'Quality depths' }],
      others: 1,
    });
    expect(inGeneral.artifactId).not.toBe(inQuality.artifactId);

    // The documents resolving it, for the definition and for its connection.
    const result = await tenant((trx) =>
      recordDatasetVersion(trx, {
        provenance: provenance({
          queryDefinition: { artifact: own.id, version: own.version.id },
          parameters: { site: 'where used' },
        }),
        author: ada,
      }),
    );
    for (const [space, component, at, title] of [
      [general, inGeneral.artifactId, node('d'), 'General report'],
      [quality, inQuality.artifactId, node('e'), 'Quality report'],
    ] as const) {
      const document = await documentReferencing(space, component, at, title);
      await tenant((trx) =>
        recordResolution(trx, {
          document: document.artifactId,
          node: at,
          binding: 'k1',
          digest: '7'.repeat(64),
          version: result.version.id,
          replaces: null,
          act: 'resolve',
          by: ada,
        }),
      );
    }
    // A document whose binding held a result of the definition, and now holds another definition's,
    // is not counted: what a binding holds is its latest resolution.
    const moved = await documentReferencing(
      quality,
      inQuality.artifactId,
      node('f'),
      'Moved report',
    );
    const elsewhere = await recorded({ parameters: { site: 'moved away' } });
    for (const version of [result.version.id, elsewhere.version.id]) {
      await tenant((trx) =>
        recordResolution(trx, {
          document: moved.artifactId,
          node: node('f'),
          binding: 'k1',
          digest: '8'.repeat(64),
          version,
          replaces: null,
          act: 'resolve',
          by: ada,
        }),
      );
    }
    const byDefinition = await tenant((trx) =>
      documentsResolving(trx, grace, { definition: own.id }),
    );
    expect(byDefinition).toEqual({
      readable: [expect.objectContaining({ title: 'Quality report' })],
      others: 1,
    });
    const byConnection = await tenant((trx) =>
      documentsResolving(trx, ada, { connection: connection.id }),
    );
    expect(byConnection.readable.map((each) => each.title)).toEqual(
      expect.arrayContaining(['General report', 'Quality report']),
    );
    expect(byConnection.others).toBe(0);
    expect(
      await tenant((trx) =>
        documentsResolving(trx, ada, { connection: '00000000-0000-4000-8000-0000000000f2' }),
      ),
    ).toEqual({ readable: [], others: 0 });
  });

  /** Advisory locks in this database: granted, and waited for. */
  const advisoryLocks = async () =>
    (
      await queryAs(
        db.adminUrl,
        `select count(*) filter (where granted)::int as granted,
                count(*) filter (where not granted)::int as waiting
           from pg_locks
          where locktype = 'advisory'
            and database = (select oid from pg_database where datname = current_database())`,
      )
    ).rows[0] as { granted: number; waiting: number };

  /** Holds what `take` locks in a transaction of a tenant's own until released. */
  const holding = async (on: Tenant, take: (trx: TenantTransaction) => Promise<void>) => {
    let release!: () => void;
    let held!: () => void;
    const taken = new Promise<void>((done) => (held = done));
    const finished = service.withTenant(on, async (trx) => {
      await take(trx);
      held();
      await new Promise<void>((done) => (release = done));
    });
    await taken;
    return async () => {
      release();
      await finished;
    };
  };

  /** Waits until some act waits on an advisory lock, and answers what is granted meanwhile. */
  const whileWaiting = async () => {
    for (let tries = 0; tries < 200; tries += 1) {
      const locks = await advisoryLocks();
      if (locks.waiting > 0) return locks;
      await new Promise((settle) => setTimeout(settle, 10));
    }
    throw new Error('Nothing came to wait on an advisory lock');
  };

  it('takes the lock on a binding in its own tenant: another tenant naming the same identifiers never waits on it', async () => {
    const other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    const document = '00000000-0000-4000-8000-00000000a001';
    const at = [{ node: node('a'), binding: 'k1' }];
    const release = await holding(production, (trx) => lockBindings(trx, document, at));
    try {
      await service.withTenant(other, async (trx) => {
        await sql`set local lock_timeout = '2s'`.execute(trx);
        await lockBindings(trx, document, at);
      });
    } finally {
      await release();
    }
  });

  it('takes several locks on questions in one order, whatever order they are asked in', async () => {
    // Enough questions that Postgres de-duplicates them by hashing, whose order is not the keys' own:
    // two questions are de-duplicated by sorting, which would put them in order with or without asking.
    const asked = Array.from({ length: 40 }, (_, at) =>
      provenance({ parameters: { site: `site-${at}` } }),
    );
    const hashOf = async (each: Provenance) => {
      const key = datasetQuestionLockKey(
        production.schema,
        datasetIdentity({
          definition: each.queryDefinition.artifact,
          parameters: each.parameters,
          identity: each.identity,
        }),
      );
      const { rows } = await queryAs(db.adminUrl, `select hashtextextended($1, 0)::text as h`, [
        key,
      ]);
      return BigInt((rows[0] as { h: string }).h);
    };
    const hashes = await Promise.all(asked.map(hashOf));
    const sorted = [...hashes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // Somebody holds the question in the middle of the order; an act asking all of them waits for it
    // holding exactly those before it, whichever order it asks in, so two acts asking the same
    // questions never each hold what the other waits for.
    const middle = sorted[20]!;
    const before = sorted.slice(0, 20).map(String).sort();
    const shuffled = asked.map((each, at) => ({ each, at: (at * 17) % 40 }));
    shuffled.sort((a, b) => a.at - b.at);
    // Another backend holding one advisory lock while it waits on another, as a concurrent test's
    // act may, holds locks that are not the act's: only the act waiting on the middle question counts.
    const releaseOther = await holding(production, async (trx) => {
      await sql`select pg_advisory_xact_lock(377001)`.execute(trx);
    });
    const otherWaits = tenant(async (trx) => {
      await sql`select pg_advisory_xact_lock(377002)`.execute(trx);
      await sql`select pg_advisory_xact_lock(377001)`.execute(trx);
    });
    await whileWaiting();
    /** The advisory locks granted to whichever backend waits on the middle question. */
    const heldByTheAct = async () => {
      for (let tries = 0; tries < 200; tries += 1) {
        const { rows } = await queryAs(
          db.adminUrl,
          `select ((held.classid::bigint << 32) | held.objid::bigint)::text as h
             from pg_locks held
             join pg_locks waits on waits.pid = held.pid
            where held.locktype = 'advisory' and held.granted
              and held.database = (select oid from pg_database where datname = current_database())
              and waits.locktype = 'advisory' and not waits.granted
              and waits.database = held.database
              and ((waits.classid::bigint << 32) | waits.objid::bigint) = $1::bigint`,
          [middle.toString()],
        );
        if (rows.length > 0) return (rows as { h: string }[]).map((row) => row.h).sort();
        await new Promise((settle) => setTimeout(settle, 10));
      }
      throw new Error('Nothing came to wait on the middle question');
    };
    try {
      for (const order of [asked, [...asked].reverse(), shuffled.map(({ each }) => each)]) {
        const release = await holding(production, (trx) =>
          lockDatasetQuestions(trx, [asked[hashes.indexOf(middle)]!]),
        );
        const act = tenant((trx) => lockDatasetQuestions(trx, order));
        const held = await heldByTheAct();
        await release();
        await act;
        expect(held).toEqual(before);
      }
    } finally {
      await releaseOther();
      await otherWaits;
    }
  });

  it('keeps a dataset version in no search', async () => {
    const { dataset } = await recorded({ parameters: { site: 'search' } });
    const rows = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${production.schema}.search_entry where artifact_id = $1`,
      [dataset.id],
    );
    expect(rows.rows).toEqual([{ n: 0 }]);
    const latest: StoredVersion | undefined = await tenant((trx) => latestVersion(trx, dataset.id));
    expect(latest?.kind).toBe('dataset');
  });
});
