import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createComponent } from './creation.js';
import { createTenant, provisionTenant } from './provision.js';
import {} from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  beforeTheLogDatabase,
} from './testing/database.js';

describe('migration 0016, which makes a document an artifact', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0015 and none after, so a tenant can stand where every environment
    // stood - whatever has been added since 0016.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0016-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 16;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('widens the two artifact checks and the author check on an environment already at 0015', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const schema = tenant.schema;

    // An environment already carrying a component, authored as every component is: the widened author
    // check is validated against it when 0016 adds it back.
    const service = beforeTheLogDatabase(db.serviceUrl);
    const component = await service
      .withTenant(tenant, async (trx) => {
        const ada = await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const general = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        return createComponent(trx, {
          spaceId: general.id,
          title: 'Install the printer',
          language: 'en-GB',
          direction: 'ltr',
          author: ada.id,
        });
      })
      .finally(() => service.close());
    if (component.answer !== 'created')
      throw new Error(`Expected a component, got ${component.answer}`);

    await expect(
      queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
    ).rejects.toThrow(/artifact_kind_check/);

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual([
      '0016_documents',
      '0017_publishing',
      '0018_layouts',
      '0019_default_layout_lists',
      '0020_assets',
      '0021_default_layout_figures',
      '0022_publication_assets',
      '0023_default_layout_relative_words',
      '0024_themes',
      '0025_table_and_image_styles',
      '0026_word',
      '0027_word_layout_and_outputs',
      '0028_templates',
      '0029_document_template',
      '0030_definition_names',
      '0031_search',
      '0032_listing_snapshot',
      '0033_idempotency',
      '0034_default_theme_choices',
      '0035_previews',
      '0036_preview_sweep',
      '0037_iteration_retention',
      '0038_api_tokens',
      '0039_groups',
      '0040_publication_check',
      '0041_publication_check_given_up',
      '0042_sealed_sign_in_secret',
      '0043_default_theme_caption_placement',
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
    ]);

    // The component and its version are as they were.
    const { rows: held } = await queryAs(
      db.adminUrl,
      `select a.kind, a.space_id is not null as in_a_space, v.id, v.author_id is not null as authored
       from ${schema}.artifact a join ${schema}.artifact_version v on v.artifact_id = a.id
       where a.id = $1`,
      [component.version.artifactId],
    );
    expect(held).toEqual([
      { kind: 'component', in_a_space: true, id: component.version.id, authored: true },
    ]);

    // A document is content, so it lives in exactly one space.
    await expect(
      queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
    ).rejects.toThrow(/artifact_space_by_kind/);
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.artifact (kind, space_id)
       values ('document', (select id from ${schema}.space where name = 'General')) returning id, kind`,
    );
    expect(rows[0].kind).toBe('document');

    await expect(
      queryAs(
        db.adminUrl,
        `insert into ${schema}.artifact_version
           (artifact_id, kind, revision_no, version_no, author_id, schema_version, content,
            content_hash, metadata_values, not_carried, version_digest)
         values ($1, 'document', 0, 1, null, 1, '{"schemaVersion":1}'::jsonb,
                 repeat('a', 64), '{}'::jsonb, '[]'::jsonb, repeat('b', 64))`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/artifact_version_component_author/);
  });

  // The path every new environment takes, and the one an upgrade does not exercise: every migration of
  // a tenant runs in one transaction, so 0016 alters artifact_version while 0015's insert of the starter
  // component type still has a deferred check queued against it.
  it('applies with every other migration in the one transaction a new environment is made in', async () => {
    const id = db.newTenantId();
    const { schema } = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Fresh' },
      hostnames: [`${id}.alloy.test`],
    });

    const { rows: applied } = await queryAs(
      db.adminUrl,
      `select version from ${schema}.schema_migration order by version`,
    );
    expect(applied.map((row) => row.version)).toContain('0016_documents');
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.artifact (kind, space_id)
       values ('document', (select id from ${schema}.space where name = 'General')) returning kind`,
    );
    expect(rows).toEqual([{ kind: 'document' }]);
  });

  // 0017's starter role, on an environment that already made a role of the same name: its own stays,
  // holding what it held, and no second one arrives beside it.
  it('keeps a Publisher role an environment made itself when 0017 adds the starter one', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Own roles' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    await queryAs(
      db.adminUrl,
      `insert into ${tenant.schema}.role (name, permissions) values ('Publisher', array['read'])`,
    );

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual([
      '0016_documents',
      '0017_publishing',
      '0018_layouts',
      '0019_default_layout_lists',
      '0020_assets',
      '0021_default_layout_figures',
      '0022_publication_assets',
      '0023_default_layout_relative_words',
      '0024_themes',
      '0025_table_and_image_styles',
      '0026_word',
      '0027_word_layout_and_outputs',
      '0028_templates',
      '0029_document_template',
      '0030_definition_names',
      '0031_search',
      '0032_listing_snapshot',
      '0033_idempotency',
      '0034_default_theme_choices',
      '0035_previews',
      '0036_preview_sweep',
      '0037_iteration_retention',
      '0038_api_tokens',
      '0039_groups',
      '0040_publication_check',
      '0041_publication_check_given_up',
      '0042_sealed_sign_in_secret',
      '0043_default_theme_caption_placement',
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
    ]);

    const { rows } = await queryAs(
      db.adminUrl,
      `select permissions from ${tenant.schema}.role where name = 'Publisher'`,
    );
    expect(rows).toEqual([{ permissions: ['read'] }]);
  });
});
