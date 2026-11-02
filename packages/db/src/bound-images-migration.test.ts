import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultLimits, type ConnectionSettings, type Provenance } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { recordDatasetVersion } from './datasets.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createQueryDefinition } from './queryDefinitions.js';
import { createArtifact } from './versions.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  beforeTheLogDatabase,
} from './testing/database.js';

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
    service = beforeTheLogDatabase(db.serviceUrl);
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
      // Its version alone: the connection's own event needs the log, which 0060 brings.
      const made = await createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: { kind: 'connection', content: settings },
      });
      const connection = { connection: { id: made.artifactId, version: made } };
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
      '0173_bridge_unlisted',
      '0174_ct_studio',
      '0175_entry_superseded',
      '0176_vocabularies',
      '0177_publication_vocabularies',
      '0178_vocabulary_query_runs',
      '0179_licences',
      '0180_asset_rights',
      '0181_asset_ingest',
      '0182_model_capabilities',
      '0183_conversation_kept',
      '0184_asset_replacement',
      '0185_themes_of_their_own',
      '0186_model_run_limits',
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
