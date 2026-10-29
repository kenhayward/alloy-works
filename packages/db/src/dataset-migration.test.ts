import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  beforeTheLogDatabase,
} from './testing/database.js';
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
    service = beforeTheLogDatabase(db.serviceUrl);
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
    ]);
    // Every row still there, and what 0048 seeds beside them: the value catalogue, its 0.1 and the
    // default theme's 0.6 (B1); and what 0055 seeds: the table catalogue's fifth version, the default
    // theme's 0.7 and the default layout's 0.8 (TB1); and what 0056 seeds, its 0.9 (TB3).
    expect(await countRows(upgraded.schema)).toEqual({
      ...counts,
      // And 0124's default prompt library at its 0.1 (the G4 plan, G4-G); and 0146's three citation
      // styles, the citation catalogue's second version and the theme's 0.9 (the CI plan, CI-D).
      // And 0154's term catalogue (TMb).
      artifact: counts.artifact! + 6,
      // And 0148's default layout 0.10 (the CI plan, CId).
      // And 0154's term catalogue, default theme 0.10 and default layout 0.11 (TMb).
      // And 0161's default layout 0.12 (TRb).
      // And 0167's default theme 0.11 (UF-H).
      // And 0168's default layout 0.13 (HT-D).
      // And 0169's default layout 0.14 (IX-H).
      artifact_version: counts.artifact_version! + 22,
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
