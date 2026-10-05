import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { everyKind } from './testing/every-kind.js';

/** The constraints 0047 rewrites. */
const REWRITTEN = [
  ['artifact', 'artifact_kind_check'],
  ['artifact', 'artifact_space_by_kind'],
  ['artifact_version', 'artifact_version_component_author'],
] as const;

/** The tables 0047 makes. */
const MADE = ['dataset', 'dataset_name', 'binding_resolution'] as const;

describe('migration 0047, over an environment made before it', () => {
  let db: TestDatabase;
  let before: string;
  let service: TenantDatabase;
  let upgraded: Tenant;
  let fresh: Tenant;
  let counts: Record<string, number>;

  const countRows = async (schema: string) => {
    const out: Record<string, number> = {};
    for (const table of ['artifact', 'artifact_version', 'search_entry']) {
      const rows = await queryAs(db.adminUrl, `select count(*)::int as n from ${schema}.${table}`);
      out[table] = rows.rows[0].n as number;
    }
    return out;
  };

  /** Every constraint 0047 rewrites, and every constraint and index on the tables it makes. */
  const constraints = async (schema: string) => {
    const out: Record<string, string> = {};
    for (const [table, name] of REWRITTEN) {
      const rows = await queryAs(
        db.adminUrl,
        `select pg_get_constraintdef(c.oid) as def from pg_constraint c
           join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = $1 and t.relname = $2 and c.conname = $3`,
        [schema, table, name],
      );
      out[name] = (rows.rows[0]?.def as string).replaceAll(`${schema}.`, '');
    }
    for (const table of MADE) {
      const rows = await queryAs(
        db.adminUrl,
        `select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
           join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = $1 and t.relname = $2 order by c.conname`,
        [schema, table],
      );
      for (const row of rows.rows) {
        out[row.conname as string] = (row.def as string).replaceAll(`${schema}.`, '');
      }
      const indexes = await queryAs(
        db.adminUrl,
        `select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = $2
          order by indexname`,
        [schema, table],
      );
      for (const row of indexes.rows) {
        out[row.indexname as string] = (row.indexdef as string).replaceAll(`${schema}.`, '');
      }
    }
    return out;
  };

  /** The runtime role's privileges on the tables 0047 makes, by table and by column. */
  const privileges = async (schema: string) => {
    const tables = await queryAs(
      db.adminUrl,
      `select table_name, privilege_type from information_schema.table_privileges
        where table_schema = $1 and grantee = $1 and table_name = any($2)
        order by table_name, privilege_type`,
      [schema, [...MADE]],
    );
    const columns = await queryAs(
      db.adminUrl,
      `select table_name, column_name, privilege_type from information_schema.column_privileges
        where table_schema = $1 and grantee = $1 and table_name = any($2)
          and privilege_type <> 'SELECT'
        order by table_name, column_name, privilege_type`,
      [schema, [...MADE]],
    );
    return { tables: tables.rows, columns: columns.rows };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0046 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0047-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 47;
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
    // One of every kind there was before 0047, so each rewritten constraint is checked against them.
    await service.withTenant(upgraded, async (trx) => {
      const author = (
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
      const spaceId = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await everyKind(trx, {
        author,
        spaceId,
        word: 'before',
        role: upgraded.schema,
        before0047: true,
      });
    });
    counts = await countRows(upgraded.schema);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('migrates every environment made before it, keeping every row, to what a fresh environment is', async () => {
    expect((await migrate(db.migratorUrl)).tenants[upgraded.id]).toEqual([
      '0047_datasets',
      '0048_bound_values',
      '0049_binding_confirm',
      '0050_publication_bindings',
    ]);
    // Every row still there, and what 0048 seeds beside them: the value catalogue, its 0.1 and the
    // default theme's 0.6 (B1).
    expect(await countRows(upgraded.schema)).toEqual({
      ...counts,
      artifact: counts.artifact! + 1,
      artifact_version: counts.artifact_version! + 2,
    });

    fresh = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    const upgradedConstraints = await constraints(upgraded.schema);
    expect(Object.values(upgradedConstraints).every((def) => typeof def === 'string')).toBe(true);
    expect(upgradedConstraints).toEqual(await constraints(fresh.schema));
    for (const [, name] of REWRITTEN) {
      expect(upgradedConstraints[name], name).toContain("'dataset'");
    }
    expect(upgradedConstraints.binding_resolution_latest).toContain(
      '(document_id, node_id, binding_id, id DESC)',
    );

    // Each table read by the runtime role, and written by what a row says alone - never its number or
    // its time - and nothing changed or removed.
    const upgradedPrivileges = await privileges(upgraded.schema);
    expect(upgradedPrivileges).toEqual(await privileges(fresh.schema));
    expect(upgradedPrivileges.tables).toEqual([
      { table_name: 'binding_resolution', privilege_type: 'SELECT' },
      { table_name: 'dataset', privilege_type: 'SELECT' },
      { table_name: 'dataset_name', privilege_type: 'SELECT' },
    ]);
    const inserted = (table: string) =>
      upgradedPrivileges.columns
        .filter((row) => row.table_name === table)
        .map((row) => `${row.column_name as string} ${row.privilege_type as string}`);
    expect(inserted('dataset')).toEqual([
      'artifact_id INSERT',
      'artifact_kind INSERT',
      'identity_key INSERT',
      'parameters_digest INSERT',
      'query_definition INSERT',
      'query_definition_kind INSERT',
    ]);
    expect(inserted('dataset_name')).toEqual([
      'dataset_id INSERT',
      'dataset_kind INSERT',
      'name INSERT',
      'named_by INSERT',
    ]);
    expect(inserted('binding_resolution')).toEqual([
      'act INSERT',
      'binding_digest INSERT',
      'binding_id INSERT',
      'dataset_id INSERT',
      'dataset_kind INSERT',
      'dataset_version INSERT',
      'document_id INSERT',
      'document_kind INSERT',
      'node_id INSERT',
      'replaces INSERT',
      'resolved_by INSERT',
    ]);
  });
});
