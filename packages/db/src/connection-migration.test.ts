import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { everyKind } from './testing/every-kind.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** The constraints 0044 rewrites. */
const REWRITTEN = [
  ['artifact', 'artifact_kind_check'],
  ['artifact', 'artifact_space_by_kind'],
  ['artifact_version', 'artifact_version_component_author'],
  ['role', 'role_permissions_closed'],
  ['api_token', 'api_token_scopes_closed'],
] as const;

describe('migration 0044, over an environment made before it', () => {
  let db: TestDatabase;
  let before: string;
  let service: TenantDatabase;
  let upgraded: Tenant;
  let fresh: Tenant;
  let counts: Record<string, number>;

  const countRows = async (schema: string) => {
    const out: Record<string, number> = {};
    for (const table of ['artifact', 'artifact_version', 'role', 'api_token', 'access_grant']) {
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
      // A function the check calls is named with its schema, which is each environment's own.
      out[name] = (rows.rows[0]?.def as string).replaceAll(`${schema}.`, '');
    }
    return out;
  };

  /** The runtime role's privileges on the two tables, table by table and column by column. */
  const privileges = async (schema: string) => {
    const tables = await queryAs(
      db.adminUrl,
      `select table_name, privilege_type from information_schema.table_privileges
        where table_schema = $1 and grantee = $1 and table_name in ('connection_credential', 'connection_test')
        order by table_name, privilege_type`,
      [schema],
    );
    const columns = await queryAs(
      db.adminUrl,
      `select table_name, column_name, privilege_type from information_schema.column_privileges
        where table_schema = $1 and grantee = $1 and table_name in ('connection_credential', 'connection_test')
        order by table_name, column_name, privilege_type`,
      [schema],
    );
    return { tables: tables.rows, columns: columns.rows };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0043 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0044-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 44;
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
    // A role, a scoped token and one artifact of every kind search finds, made before 0044.
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
      await sql`insert into role (name, permissions) values ('Keeper', array['read', 'administer', 'design'])`.execute(
        trx,
      );
      await sql`insert into api_token (principal_id, name, token_hash, scopes, expires_at)
                values (${ada}, 'Scoped', ${randomBytes(32).toString('hex')}, array['edit', 'manage_definitions'], now() + interval '1 day')`.execute(
        trx,
      );
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await everyKind(trx, {
        author: ada,
        spaceId: general,
        word: 'kept',
        role: upgraded.role,
        before0046: true,
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
      '0044_connections',
      '0045_connection_credential_target',
      '0046_query_definitions',
      '0047_datasets',
      '0048_bound_values',
      '0049_binding_confirm',
      '0050_publication_bindings',
      '0051_dataset_pending',
      '0052_bound_images',
      '0053_dataset_image_index',
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
    ]) {
      expect(upgradedConstraints[name], name).toContain("'connection'");
    }
    for (const name of ['role_permissions_closed', 'api_token_scopes_closed']) {
      expect(upgradedConstraints[name], name).toContain("'use_connection'");
    }

    const upgradedPrivileges = await privileges(upgraded.schema);
    expect(upgradedPrivileges).toEqual(await privileges(fresh.schema));
    // Select on both, insert on every column but the time and the row's own number, and nothing else.
    expect(upgradedPrivileges.tables).toEqual([
      { table_name: 'connection_credential', privilege_type: 'SELECT' },
      { table_name: 'connection_test', privilege_type: 'SELECT' },
    ]);
    const inserted = upgradedPrivileges.columns
      .filter((row) => row.privilege_type === 'INSERT')
      .map((row) => `${row.table_name}.${row.column_name}`);
    expect(inserted).toEqual([
      'connection_credential.connection_id',
      'connection_credential.connection_kind',
      'connection_credential.sealed',
      'connection_credential.set_by',
      'connection_credential.target_digest',
      'connection_test.connection_id',
      'connection_test.connection_kind',
      'connection_test.connection_version_id',
      'connection_test.credential_id',
      'connection_test.failure',
      'connection_test.findings',
      'connection_test.outcome',
      'connection_test.tested_by',
    ]);
    expect(
      upgradedPrivileges.columns.filter(
        (row) => row.privilege_type !== 'INSERT' && row.privilege_type !== 'SELECT',
      ),
    ).toEqual([]);
  });
});
