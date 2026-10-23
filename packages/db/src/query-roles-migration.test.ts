import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createRole } from './roles.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';

/**
 * Migration 0058: the two query roles, Query builder and Query writer, in every environment. A role
 * already of either name keeps its row, as development's own Query builder does.
 */
describe('migration 0058, which starts every environment with Query builder and Query writer', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration before 0058 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0058-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 58;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing before 0058. */
  const beforeRoles = async (name: string): Promise<Tenant> => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    return { ...provisioned, id };
  };

  const queryRoles = (tenant: Tenant) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('role')
        .select(['id', 'name', 'permissions'])
        .where('name', 'in', ['Query builder', 'Query writer'])
        .orderBy('name')
        .execute(),
    );

  it('gives a fresh environment both, with exactly their permissions', async () => {
    await migrate(db.migratorUrl);
    const fresh = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Fresh' },
      hostnames: ['fresh.alloy.test'],
    });
    expect(
      (await queryRoles(fresh)).map(({ name, permissions }) => ({ name, permissions })),
    ).toEqual([
      { name: 'Query builder', permissions: ['read', 'use_connection'] },
      { name: 'Query writer', permissions: ['read', 'use_connection', 'write_sql'] },
    ]);
  });

  it("keeps the one row development's seed made, and a tenant's own role of either name as it is", async () => {
    // Development's seed made Query builder, and granted it to Grace, before 0058. Written as the
    // rows it made: today's seed records its grants on the audit log, which comes with 0060.
    const development = await beforeRoles('Development');
    await service.withTenant(development, async (trx) => {
      const made = await createRole(trx, 'Query builder', ['read', 'use_connection']);
      if (!('role' in made)) throw new Error(`Query builder was refused: ${made.refused}`);
      const grace = await trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'grace', display_name: 'Grace' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const general = await trx
        .selectFrom('space')
        .select('id')
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access_grant')
        .values({
          role_id: made.role.id,
          principal_id: grace.id,
          level: 'space',
          space_id: general.id,
          effect: 'allow',
          granted_by: grace.id,
        })
        .execute();
    });
    const seeded = await queryRoles(development);
    expect(seeded.map((role) => role.name)).toEqual(['Query builder']);

    // Another made its own Query writer, holding less.
    const own = await beforeRoles('Own');
    await service.withTenant(own, (trx) => createRole(trx, 'Query writer', ['read']));
    const made = await queryRoles(own);

    const applied = (await migrate(db.migratorUrl)).tenants;
    expect(applied[development.id]).toEqual([
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
    ]);
    expect(applied[own.id]).toEqual([
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
    ]);

    expect(await queryRoles(development)).toEqual([
      seeded[0],
      {
        id: expect.any(String),
        name: 'Query writer',
        permissions: ['read', 'use_connection', 'write_sql'],
      },
    ]);
    // Grace's grant still names the row she was granted.
    const granted = await service.withTenant(development, (trx) =>
      trx
        .selectFrom('access_grant')
        .select('role_id')
        .where('role_id', '=', seeded[0]!.id)
        .execute(),
    );
    expect(granted).toHaveLength(1);

    expect(await queryRoles(own)).toEqual([
      { id: expect.any(String), name: 'Query builder', permissions: ['read', 'use_connection'] },
      made[0],
    ]);
  });
});
