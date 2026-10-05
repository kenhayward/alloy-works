import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { limitCeilings } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** The constraints 0046 rewrites. */
const REWRITTEN = [
  ['artifact', 'artifact_kind_check'],
  ['artifact', 'artifact_space_by_kind'],
  ['artifact_version', 'artifact_version_component_author'],
  ['role', 'role_permissions_closed'],
  ['api_token', 'api_token_scopes_closed'],
  ['search_entry', 'search_entry_kind_check'],
] as const;

describe('migration 0046, over an environment made before it', () => {
  let db: TestDatabase;
  let before: string;
  let service: TenantDatabase;
  let upgraded: Tenant;
  let fresh: Tenant;
  let counts: Record<string, number>;

  const countRows = async (schema: string) => {
    const out: Record<string, number> = {};
    for (const table of ['artifact', 'artifact_version', 'role', 'api_token', 'search_entry']) {
      const rows = await queryAs(db.adminUrl, `select count(*)::int as n from ${schema}.${table}`);
      out[table] = rows.rows[0].n as number;
    }
    return out;
  };

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
    return out;
  };

  /** The runtime role's privileges on data_policy, by table and by column. */
  const privileges = async (schema: string) => {
    const tables = await queryAs(
      db.adminUrl,
      `select privilege_type from information_schema.table_privileges
        where table_schema = $1 and grantee = $1 and table_name = 'data_policy'
        order by privilege_type`,
      [schema],
    );
    const columns = await queryAs(
      db.adminUrl,
      `select column_name, privilege_type from information_schema.column_privileges
        where table_schema = $1 and grantee = $1 and table_name = 'data_policy'
          and privilege_type <> 'SELECT'
        order by column_name, privilege_type`,
      [schema],
    );
    return { tables: tables.rows, columns: columns.rows };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0045 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0046-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 46;
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
    // A role holding use_connection and a token scoped to it, made before 0046.
    await service.withTenant(upgraded, async (trx) => {
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
      await sql`insert into role (name, permissions) values ('Connection user', array['read', 'use_connection'])`.execute(
        trx,
      );
      await sql`insert into api_token (principal_id, name, token_hash, scopes, expires_at)
                values (${ada}, 'Scoped', ${randomBytes(32).toString('hex')}, array['use_connection'], now() + interval '1 day')`.execute(
        trx,
      );
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
      '0046_query_definitions',
      '0047_datasets',
      '0048_bound_values',
      '0049_publication_bindings',
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
    for (const name of [
      'artifact_kind_check',
      'artifact_space_by_kind',
      'artifact_version_component_author',
      'search_entry_kind_check',
    ]) {
      expect(upgradedConstraints[name], name).toContain("'queryDefinition'");
    }
    for (const name of ['role_permissions_closed', 'api_token_scopes_closed']) {
      expect(upgradedConstraints[name], name).toContain("'write_sql'");
    }

    // The tenant's lowered limits: one row, none lowered, which the runtime role reads and changes
    // column by column, and never adds to or takes from.
    for (const tenant of [upgraded, fresh]) {
      const rows = await queryAs(
        db.adminUrl,
        `select rows, bytes, seconds from ${tenant.schema}.data_policy`,
      );
      expect(rows.rows).toEqual([{ rows: null, bytes: null, seconds: null }]);
    }
    const upgradedPrivileges = await privileges(upgraded.schema);
    expect(upgradedPrivileges).toEqual(await privileges(fresh.schema));
    expect(upgradedPrivileges.tables).toEqual([{ privilege_type: 'SELECT' }]);
    expect(upgradedPrivileges.columns).toEqual([
      { column_name: 'bytes', privilege_type: 'UPDATE' },
      { column_name: 'rows', privilege_type: 'UPDATE' },
      { column_name: 'seconds', privilege_type: 'UPDATE' },
    ]);
  });

  it('holds each lowered limit from 1 to its ceiling, and keeps the one row', async () => {
    const set = (column: 'rows' | 'bytes' | 'seconds', value: number | null) =>
      service.withTenant(upgraded, (trx) =>
        sql`update data_policy set ${sql.ref(column)} = ${value}`.execute(trx),
      );
    for (const column of ['rows', 'bytes', 'seconds'] as const) {
      await set(column, limitCeilings[column]);
      await set(column, 1);
      await set(column, null);
      for (const bad of [0, limitCeilings[column] + 1]) {
        await expect(set(column, bad), `${column} ${bad}`).rejects.toThrow(/data_policy/);
      }
    }
    await expect(
      service.withTenant(upgraded, (trx) =>
        sql`insert into data_policy default values`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(upgraded, (trx) => sql`delete from data_policy`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
