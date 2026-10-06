import { createHash } from 'node:crypto';

import {
  defaultLimits,
  takeDigestInput,
  type ConnectionSettings,
  type Provenance,
  type QueryDefinition,
  type TakeOutcome,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection, type StoredConnection } from './connections.js';
import { recordDatasetVersion } from './datasets.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createQueryDefinition, type StoredQueryDefinition } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import { recordTake, takeDigest, takesOf } from './takes.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/**
 * A take's outcome as derived data (the B1 plan, B1-H; stored-shape rows 5 to 7): written by
 * `recordTake` alone, keyed by the dataset version and the take's digest, deletable, and held to its
 * shape by the table as well as by its writer, so a direct insert cannot store what the writer would
 * refuse.
 */

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

const definition = (connection: string): QueryDefinition => ({
  schemaVersion: 1,
  title: 'Depth by site',
  description: '',
  connection,
  parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
  fetch: { kind: 'sql', text: 'select site, depth from sample.reading where site = {{site}}' },
  columns: [
    { name: 'site', from: { column: 'site' }, type: { base: 'text' } },
    { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 6, scale: 2 } },
  ],
  key: ['site'],
  order: 'multiset',
  empty: 'valid',
  limits: { ...defaultLimits },
  retired: false,
});

const DEPTH = { name: 'depth', type: { base: 'decimal', precision: 6, scale: 2 } } as const;
const PHOTO = {
  name: 'photo',
  type: { base: 'image', encoding: 'binary', description: { column: 'caption' } },
} as const;
const DECORATIVE_PHOTO = {
  name: 'photo',
  type: { base: 'image', encoding: 'binary', description: 'decorative' },
} as const;

describe('dataset_take', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let connection: StoredConnection;
  let query: StoredQueryDefinition;
  let runs = 0;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  /** A new dataset version: each run a question of its own, so each is a dataset's first version. */
  const datasetVersion = (columns: Provenance['columns'] = definition(connection.id).columns) => {
    runs += 1;
    const provenance: Provenance = {
      schemaVersion: 1,
      queryDefinition: { artifact: query.id, version: query.version.id },
      connection: { artifact: connection.id, version: connection.version.id },
      parameters: { site: `site ${runs}` },
      ran: { sql: 'select site, depth from sample.reading where site = $1' },
      identity: { kind: 'service' },
      at: '2026-10-04T09:15:00.000Z',
      durationMs: 12,
      rowCount: 1,
      columns,
      canonical: 1,
      checksum: 'a'.repeat(64),
      images: {},
    };
    return tenant((trx) => recordDatasetVersion(trx, { provenance, author: ada, images: [] })).then(
      (recorded) => recorded.version,
    );
  };

  const COLUMN: Parameters<typeof recordTake>[1]['take'] = { column: 'depth' };

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
      ada = (
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
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createConnection(trx, { author: ada, spaceId: general.id, settings });
      if (made.answer !== 'created') throw new Error(made.answer);
      connection = made.connection;
      const defined = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general.id,
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

  it("records a take's outcome by its dataset version and the hash of the take, and answers it", async () => {
    const version = await datasetVersion();
    const keyed = { key: { site: 'site 1' }, column: 'depth' } as const;
    const value: TakeOutcome = { value: '12.5', column: DEPTH };
    const many: TakeOutcome = { failure: 'value_many', count: 3 };
    const elsewhere = { key: { region: 'north' }, column: 'depth' } as const;
    const invalid: TakeOutcome = { failure: 'take_invalid', column: 'region' };
    await tenant(async (trx) => {
      await recordTake(trx, { version: version.id, take: COLUMN, outcome: value });
      await recordTake(trx, { version: version.id, take: keyed, outcome: many });
      await recordTake(trx, { version: version.id, take: elsewhere, outcome: invalid });
    });
    expect(takeDigest(COLUMN)).toBe(
      createHash('sha256').update(takeDigestInput(COLUMN), 'utf8').digest('hex'),
    );
    const answered = await tenant((trx) =>
      takesOf(trx, [
        { version: version.id, takeDigest: takeDigest(COLUMN) },
        { version: version.id, takeDigest: takeDigest(keyed) },
        { version: version.id, takeDigest: takeDigest({ column: 'site' }) },
        { version: version.id, takeDigest: takeDigest(elsewhere) },
      ]),
    );
    expect(answered).toEqual([
      { version: version.id, takeDigest: takeDigest(COLUMN), outcome: value },
      { version: version.id, takeDigest: takeDigest(keyed), outcome: many },
      { version: version.id, takeDigest: takeDigest(elsewhere), outcome: invalid },
    ]);
    expect(await tenant((trx) => takesOf(trx, []))).toEqual([]);
  });

  it('keeps the first outcome where a take is recorded again, since the outcome is a function of the two', async () => {
    const version = await datasetVersion();
    await tenant((trx) =>
      recordTake(trx, {
        version: version.id,
        take: COLUMN,
        outcome: { value: '1', column: DEPTH },
      }),
    );
    await tenant((trx) =>
      recordTake(trx, { version: version.id, take: COLUMN, outcome: { failure: 'value_none' } }),
    );
    const [held] = await tenant((trx) =>
      takesOf(trx, [{ version: version.id, takeDigest: takeDigest(COLUMN) }]),
    );
    expect(held!.outcome).toEqual({ value: '1', column: DEPTH });
  });

  it('refuses, writing nothing, an outcome not of its shape, a value not canonical in its column, or a column the version does not declare as given', async () => {
    const version = await datasetVersion();
    const refused: unknown[] = [
      { failure: 'value_many' },
      { failure: 'value_none', count: 2 },
      { failure: 'result_unreadable' },
      { unavailable: true },
      { value: 12.5, column: DEPTH },
      { value: '12.50', column: DEPTH },
      { value: '12.5', column: { ...DEPTH, from: { column: 'depth' } } },
      { value: '12.5', column: { name: 'width', type: DEPTH.type } },
      { value: '12.5', column: { name: 'depth', type: { base: 'text' } } },
      // What takeValue never answers: a text of spaces alone, and take_invalid without its column.
      { value: ' ', column: { name: 'site', type: { base: 'text' } } },
      { failure: 'take_invalid' },
      { failure: 'value_none', column: 'depth' },
    ];
    for (const outcome of refused) {
      await expect(
        tenant((trx) =>
          recordTake(trx, { version: version.id, take: COLUMN, outcome: outcome as TakeOutcome }),
        ),
        JSON.stringify(outcome),
      ).rejects.toThrow();
    }
    // Nor a version that is not a dataset's.
    await expect(
      tenant((trx) =>
        recordTake(trx, {
          version: query.version.id,
          take: COLUMN,
          outcome: { failure: 'value_none' },
        }),
      ),
    ).rejects.toThrow();
    expect(
      await tenant((trx) =>
        takesOf(trx, [{ version: version.id, takeDigest: takeDigest(COLUMN) }]),
      ),
    ).toEqual([]);
  });

  it('refuses by its constraints each loose outcome and digest a direct insert would store', async () => {
    const version = await datasetVersion();
    const insert = (digest: string, outcome: unknown) =>
      tenant((trx) =>
        sql`insert into dataset_take (dataset_version, artifact_id, take_digest, outcome)
            values (${version.id}, ${version.artifactId}, ${digest}, ${JSON.stringify(outcome)}::jsonb)`.execute(
          trx,
        ),
      );
    const loose: unknown[] = [
      {},
      { value: '1' },
      { value: null, column: DEPTH },
      { value: 1, column: DEPTH },
      { value: '1', column: DEPTH, failure: 'value_none' },
      { value: '1', column: { name: 'depth' } },
      { value: '1', column: { ...DEPTH, from: { column: 'depth' } } },
      { failure: 'nothing' },
      { failure: 'value_none', count: 2 },
      { failure: 'value_many' },
      { failure: 'value_many', count: 1 },
      { failure: 'value_many', count: 2.5 },
      { failure: 'value_many', count: '3' },
      { failure: 'value_null', reason: 'x' },
      { failure: 'value_many', count: 1e300 },
      { failure: 'value_many', count: 9007199254740992 },
      // A column named exactly for take_invalid, by a name of at least one character.
      { failure: 'take_invalid' },
      { failure: 'take_invalid', column: '' },
      { failure: 'take_invalid', column: 7 },
      { failure: 'value_none', column: 'depth' },
      // A value's column: a name of at least one character, a type of a base a value can have.
      { value: '1', column: { name: '', type: DEPTH.type } },
      { value: '1', column: { name: 'depth', type: {} } },
      { value: '1', column: { name: 'depth', type: { base: 'image' } } },
      { value: '1', column: { name: 'depth', type: { base: 7 } } },
      // An image (0052): exactly its hash, a description and an image column, nothing else.
      { description: 'The gate', column: PHOTO },
      { image: 'AB'.repeat(32), description: 'The gate', column: PHOTO },
      { image: 'ab'.repeat(31), description: 'The gate', column: PHOTO },
      { image: 'ab'.repeat(32), column: PHOTO },
      { image: 'ab'.repeat(32), description: '', column: PHOTO },
      { image: 'ab'.repeat(32), description: 7, column: PHOTO },
      { image: 'ab'.repeat(32), description: 'The gate', column: DEPTH },
      { image: 'ab'.repeat(32), description: 'The gate', column: { name: 'photo' } },
      { image: 'ab'.repeat(32), description: 'The gate', column: PHOTO, value: 'x' },
      { image: 'ab'.repeat(32), description: 'The gate', column: PHOTO, failure: 'value_none' },
      // A missing description names its column, as take_invalid names the one it lacks.
      { failure: 'image_description_missing' },
      { failure: 'image_description_missing', column: '' },
      [],
      'value_none',
    ];
    for (const [at, outcome] of loose.entries()) {
      await expect(
        insert(at.toString(16).padStart(64, '0'), outcome),
        JSON.stringify(outcome),
      ).rejects.toThrow(/dataset_take_outcome/);
    }
    await expect(insert('A'.repeat(64), { failure: 'value_none' })).rejects.toThrow(
      /dataset_take_take_digest/,
    );
    // And what the writer would write, the table takes.
    await insert('f'.repeat(64), { failure: 'value_many', count: 2 });
    await insert('d'.repeat(64), { failure: 'take_invalid', column: 'region' });
    await insert('e'.repeat(64), {
      value: true,
      column: { name: 'open', type: { base: 'boolean' } },
    });
    await insert('c'.repeat(64), {
      image: 'ab'.repeat(32),
      description: 'The gate',
      column: PHOTO,
    });
    await insert('b'.repeat(64), { failure: 'image_description_missing', column: 'caption' });
  });

  it("DAT-097 records an image take's hash and description against the image column its version declares, or its description missing, and refuses an image with no hash", async () => {
    const version = await datasetVersion([
      ...definition(connection.id).columns,
      { name: 'photo', from: { column: 'photo' }, type: PHOTO.type },
      { name: 'caption', from: { column: 'caption' }, type: { base: 'text' } },
    ]);
    const take = { key: { site: 'north' }, column: 'photo' };
    const image: TakeOutcome = { image: 'ab'.repeat(32), description: 'The gate', column: PHOTO };
    await tenant((trx) => recordTake(trx, { version: version.id, take, outcome: image }));
    const missing = { key: { site: 'south' }, column: 'photo' };
    await tenant((trx) =>
      recordTake(trx, {
        version: version.id,
        take: missing,
        outcome: { failure: 'image_description_missing', column: 'caption' },
      }),
    );
    expect(
      await tenant((trx) =>
        takesOf(trx, [
          { version: version.id, takeDigest: takeDigest(take) },
          { version: version.id, takeDigest: takeDigest(missing) },
        ]),
      ),
    ).toEqual([
      { version: version.id, takeDigest: takeDigest(take), outcome: image },
      {
        version: version.id,
        takeDigest: takeDigest(missing),
        outcome: { failure: 'image_description_missing', column: 'caption' },
      },
    ]);
    // No hash, a column the version does not declare so, or a description its type does not give.
    for (const outcome of [
      { description: 'The gate', column: PHOTO },
      { image: 'ab'.repeat(32), description: 'The gate', column: { ...PHOTO, name: 'logo' } },
      {
        image: 'ab'.repeat(32),
        description: 'The gate',
        column: { name: 'photo', type: { ...PHOTO.type, description: { column: 'site' } } },
      },
      { image: 'ab'.repeat(32), description: 'decorative', column: DECORATIVE_PHOTO },
    ]) {
      await expect(
        tenant((trx) =>
          recordTake(trx, {
            version: version.id,
            take: { column: 'photo' },
            outcome: outcome as TakeOutcome,
          }),
        ),
        JSON.stringify(outcome),
      ).rejects.toThrow();
    }
    // And the table refuses an image with no hash, as a direct insert would store it.
    await expect(
      tenant((trx) =>
        sql`insert into dataset_take (dataset_version, artifact_id, take_digest, outcome)
            values (${version.id}, ${version.artifactId}, ${'9'.repeat(64)},
                    ${JSON.stringify({ description: 'The gate', column: PHOTO })}::jsonb)`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/dataset_take_outcome/);
  });

  it('gives the runtime role select, insert and delete, and no update or truncate', async () => {
    const version = await datasetVersion();
    await tenant((trx) =>
      recordTake(trx, { version: version.id, take: COLUMN, outcome: { failure: 'value_none' } }),
    );
    for (const statement of [
      sql`update dataset_take set outcome = '{"failure":"value_null"}' where dataset_version = ${version.id}`,
      sql`truncate dataset_take`,
    ]) {
      await expect(tenant((trx) => statement.execute(trx))).rejects.toThrow(/permission denied/);
    }
    // Derived, so deletable: every row gone loses nothing a take cannot recompute.
    await tenant((trx) =>
      sql`delete from dataset_take where dataset_version = ${version.id}`.execute(trx),
    );
    expect(
      await tenant((trx) =>
        takesOf(trx, [{ version: version.id, takeDigest: takeDigest(COLUMN) }]),
      ),
    ).toEqual([]);
  });

  it('is deleted with its dataset version', async () => {
    const version = await datasetVersion();
    await tenant((trx) =>
      recordTake(trx, { version: version.id, take: COLUMN, outcome: { failure: 'value_none' } }),
    );
    await queryAs(db.adminUrl, `delete from ${production.schema}.artifact_version where id = $1`, [
      version.id,
    ]);
    const left = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${production.schema}.dataset_take where dataset_version = $1`,
      [version.id],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
