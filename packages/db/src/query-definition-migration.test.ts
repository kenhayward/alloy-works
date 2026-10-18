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
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

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
    service = testTenantDatabase(db.serviceUrl);
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
      '0049_binding_confirm',
      '0050_publication_bindings',
      '0051_dataset_pending',
      '0052_bound_images',
      '0053_dataset_image_index',
      '0054_connection_test_privilege',
      '0055_bound_tables',
      '0056_table_note_word',
      '0057_document_parameters',
      '0058_query_roles',
      '0059_space_archive',
      '0060_audit',
      '0061_audit_hardening',
      '0062_search_contains',
      '0063_unsaved_discarded',
      '0064_column_widths',
      '0065_audit_read',
      '0066_audit_export',
      '0067_live',
      '0068_presence',
      '0069_lock_periods',
      '0070_lock_taking',
      '0071_presence_key',
      '0072_baselines',
      '0073_baseline_publications',
      '0074_baseline_requests_whole',
      '0075_changes_since',
      '0076_threads_and_inbox',
      '0077_suggestions',
      '0078_binding_revisions',
      '0079_review_rounds',
      '0080_attention',
      '0081_attention_requests',
      '0082_restored_from',
      '0083_archival',
      '0084_legal_holds',
      '0085_deletion',
      '0086_retention_keeps',
      '0087_erasure',
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
    ]);
    // Every row still there, and what 0048 seeds beside them: the value catalogue, its 0.1 and the
    // default theme's 0.6 (B1); and what 0055 seeds: the table catalogue's fifth version, the default
    // theme's 0.7 and the default layout's 0.8 (TB1); and what 0056 seeds, its 0.9 (TB3); and 0058's
    // two query roles; and 0064's table catalogue's sixth version and the theme's 0.8 (TG3).
    expect(await countRows(upgraded.schema)).toEqual({
      ...counts,
      // And 0124's default prompt library at its 0.1 (the G4 plan, G4-G).
      artifact: counts.artifact! + 2,
      artifact_version: counts.artifact_version! + 9,
      // And 0114's shared reader (the R17 plan, R17-B).
      role: counts.role! + 3,
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
      // 0115's runs at once (the R18 plan, R18-A).
      { column_name: 'concurrent_runs', privilege_type: 'UPDATE' },
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
