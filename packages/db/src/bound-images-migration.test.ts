import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultLimits, type ConnectionSettings, type Provenance } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection } from './connections.js';
import { recordDatasetVersion } from './datasets.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createQueryDefinition } from './queryDefinitions.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Gates',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'gates',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
};

describe('migration 0052, which widens dataset_take to an image', () => {
  let db: TestDatabase;
  let before: string;
  let service: TenantDatabase;
  let upgraded: Tenant;
  let version: { id: string; artifactId: string };

  /** `dataset_take`'s constraints, as a schema holds them. */
  const constraints = async (schema: string) =>
    (
      await queryAs(
        db.adminUrl,
        `select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
           join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = $1 and t.relname = 'dataset_take' order by c.conname`,
        [schema],
      )
    ).rows.map((row) => [row.conname, (row.def as string).replaceAll(`${schema}.`, '')]);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0052-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 52;
      },
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    upgraded = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    service = createTenantDatabase(db.serviceUrl);
    version = await service.withTenant(upgraded, async (trx) => {
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
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const connection = await createConnection(trx, { author: ada, spaceId: general, settings });
      if (connection.answer !== 'created') throw new Error(connection.answer);
      const columns = [{ name: 'site', from: { column: 'site' }, type: { base: 'text' } }] as const;
      const query = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: {
          schemaVersion: 1,
          title: 'Sites',
          description: '',
          connection: connection.connection.id,
          parameters: [],
          fetch: { kind: 'sql', text: 'select site from sample.site' },
          columns: [...columns],
          key: ['site'],
          order: 'multiset',
          empty: 'valid',
          limits: { ...defaultLimits },
          retired: false,
        },
      });
      if (query.answer !== 'created') throw new Error(query.answer);
      const provenance: Provenance = {
        schemaVersion: 1,
        queryDefinition: { artifact: query.definition.id, version: query.definition.version.id },
        connection: {
          artifact: connection.connection.id,
          version: connection.connection.version.id,
        },
        parameters: {},
        ran: { sql: 'select site from sample.site' },
        identity: { kind: 'service' },
        at: '2026-10-06T09:00:00.000Z',
        durationMs: 3,
        rowCount: 1,
        columns: [...columns],
        canonical: 1,
        checksum: 'a'.repeat(64),
        images: {},
      };
      const recorded = await recordDatasetVersion(trx, { provenance, author: ada });
      // Two takes held before 0052: one `take_invalid`, which an image take answered then, and one
      // `value_none`, which nothing in B6 changes.
      for (const [digest, outcome] of [
        ['1'.repeat(64), { failure: 'take_invalid', column: 'photo' }],
        ['2'.repeat(64), { failure: 'value_none' }],
      ] as const) {
        await sql`insert into dataset_take (dataset_version, artifact_id, take_digest, outcome)
          values (${recorded.version.id}, ${recorded.version.artifactId}, ${digest},
                  ${JSON.stringify(outcome)}::jsonb)`.execute(trx);
      }
      return { id: recorded.version.id, artifactId: recorded.version.artifactId };
    });
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('deletes every take_invalid row, keeps every other, and leaves dataset_take as a fresh environment has it', async () => {
    expect((await migrate(db.migratorUrl)).tenants[upgraded.id]).toEqual([
      '0052_bound_images',
      '0053_dataset_image_index',
      '0054_connection_test_privilege',
      '0055_bound_tables',
      '0056_table_note_word',
      '0057_document_parameters',
      '0058_query_roles',
      '0059_space_archive',
      '0060_audit',
    ]);
    const kept = await queryAs(
      db.adminUrl,
      `select take_digest, outcome from ${upgraded.schema}.dataset_take where dataset_version = $1`,
      [version.id],
    );
    expect(kept.rows).toEqual([
      { take_digest: '2'.repeat(64), outcome: { failure: 'value_none' } },
    ]);
    const fresh = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    expect(await constraints(upgraded.schema)).toEqual(await constraints(fresh.schema));
  });
});
