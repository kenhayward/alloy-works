import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CATALOGUE_KINDS,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  DEFAULT_THEME_VERSION,
  DEFAULT_VALUE_FORMATS,
  defaultNumberingScheme,
  FIFTH_DEFAULT_CATALOGUES_BY_VERSION,
  FIFTH_DEFAULT_CATALOGUE_VERSIONS,
  FIFTH_DEFAULT_THEME,
  FIFTH_DEFAULT_THEME_VERSION,
  formatsFor,
  SECOND_DEFAULT_CATALOGUES,
  SECOND_DEFAULT_CATALOGUES_BY_VERSION,
  SECOND_DEFAULT_CATALOGUE_VERSIONS,
  SECOND_DEFAULT_THEME,
  SECOND_DEFAULT_THEME_VERSION,
  SIXTH_DEFAULT_CATALOGUES,
  SIXTH_DEFAULT_CATALOGUES_BY_VERSION,
  SIXTH_DEFAULT_THEME,
  SIXTH_DEFAULT_THEME_VERSION,
  THIRD_DEFAULT_THEME,
  THIRD_DEFAULT_THEME_VERSION,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_CATALOGUE_VERSIONS,
  FIRST_DEFAULT_CATALOGUES_BY_VERSION,
  FIRST_DEFAULT_THEME,
  FOURTH_DEFAULT_CATALOGUES,
  FOURTH_DEFAULT_CATALOGUES_BY_VERSION,
  FOURTH_DEFAULT_CATALOGUE_VERSIONS,
  FOURTH_DEFAULT_THEME,
  FOURTH_DEFAULT_THEME_VERSION,
  readTheme,
  type Catalogue1,
  type Catalogue2,
  type CatalogueKind,
  type PublishFailure,
  type ResolvedTheme,
  type Theme,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { defaultLayout } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import {
  failPublicationRequest,
  publicationInputs,
  recordPublication,
  requestPublication,
} from './publishing.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  beforeTheLogDatabase,
} from './testing/database.js';
import { requestBefore0029 } from './testing/request-before-0029.js';
import {
  addCatalogueVersion,
  addThemeVersion,
  DEFAULT_CATALOGUE_IDS,
  DEFAULT_THEME_ID,
  DEFAULT_VALUE_CATALOGUE_ID,
  defaultTheme,
  themeAt,
} from './themes.js';
import type { StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';

/**
 * The theme `publicationInputs` hands the job for a request - the version the request recorded, read
 * with the catalogue versions it names - read as `publicationInputs` reads it, in an environment
 * migrated only to 0026: `publicationInputs` reads the request's kind too, which 0035 added.
 */
async function themeHandedAt0026(trx: TenantTransaction, requestId: string) {
  const { theme_version_id } = await trx
    .selectFrom('publication_request')
    .select('theme_version_id')
    .where('id', '=', requestId)
    .executeTakeFirstOrThrow();
  return { versionId: theme_version_id!, theme: await themeAt(trx, theme_version_id!) };
}

/** A theme and the catalogues it names, as the domain reads them from its own data. */
function read(theme: Theme, catalogues: ReadonlyMap<string, unknown>): ResolvedTheme {
  const outcome = readTheme(theme, catalogues);
  if (!outcome.ok) throw new Error(outcome.refusals.map((each) => each.message).join('; '));
  return outcome.theme;
}
const FAILED: PublishFailure = {
  stage: 'compose',
  code: 'engine_failed',
  node: null,
  block: null,
  detail: null,
};

describe('migration 0024, which gives every environment its default theme', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let beforeLayouts: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0023 and none after, so a tenant can stand where every environment
    // stood before themes - whatever has been added since 0024.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0024-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 24;
      },
    });
    // And up to 0017, where every environment stood before layouts.
    beforeLayouts = await mkdtemp(join(tmpdir(), 'aw-before-0018-'));
    await cp(new URL('../migrations/', import.meta.url), beforeLayouts, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 18;
      },
    });
    service = beforeTheLogDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await rm(beforeLayouts, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing at 0023, as every environment stood before this migration. */
  const beforeThemes = async (name: string): Promise<Tenant & { id: string }> => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    return { ...tenant, id };
  };

  const afterThemes = (name: string) =>
    createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name },
      hostnames: [`${name.toLowerCase().replace(/[^a-z]+/g, '-')}.acme.alloy.test`],
    });

  const personAndDocument = async (trx: TenantTransaction) => {
    const ada = await trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const made = await createDocument(trx, {
      spaceId: general.id,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada.id,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return { ada: ada.id, version: made.version };
  };

  /** What a worker records for a request made under a layout, over an output the store need not hold. */
  const recording = (tenant: Tenant, requestId: string) => ({
    requestId,
    pipelineVersion: '2',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    outputs: [
      {
        format: 'pdf' as const,
        engineVersion: '0.15.1',
        templateVersion: 2,
        key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
        sha256: 'c'.repeat(64),
        bytes: 1000,
      },
    ],
  });

  /** A request inserted as the runtime role may insert one at 0023: under the declared layout. */
  const requestAt0023 = async (
    trx: TenantTransaction,
    requester: string,
    version: StoredVersion,
  ) => {
    const layout = await defaultLayout(trx);
    return sql<{ id: string }>`
      insert into publication_request
        (document_id, document_version_id, formats, requested_by, layout_id, layout_version_id)
      values (${version.artifactId}, ${version.id}, array['pdf'], ${requester}, ${layout.artifactId},
        ${layout.versionId})
      returning id`
      .execute(trx)
      .then((result) => result.rows[0]!.id);
  };

  /**
   * A publication written row by row as the runtime role, the way `recordPublication` writes one, with
   * the theme columns named only where given - so it runs on a tenant at 0023, where they do not exist,
   * and can be rigged on one after it - and its output's producer and report only where `produced`
   * says the tenant is past 0027, which added them. Marks the request done, and is checked when its
   * transaction commits.
   */
  const publicationRows = async (
    trx: TenantTransaction,
    tenant: Tenant,
    request: string,
    theme?: { readonly id: string | null; readonly version: string | null },
    produced = false,
  ) => {
    const row = await sql<{
      document_id: string;
      document_version_id: string;
      requested_by: string;
      requested_at: Date;
      layout_id: string;
      layout_version_id: string;
      space_id: string;
    }>`select r.document_id, r.document_version_id, r.requested_by, r.requested_at, r.layout_id,
         r.layout_version_id, a.space_id
       from publication_request r join artifact a on a.id = r.document_id
       where r.id = ${request}`
      .execute(trx)
      .then((result) => result.rows[0]!);
    const artifact = await sql<{ id: string }>`
      insert into artifact (kind, space_id) values ('publication', ${row.space_id}) returning id`
      .execute(trx)
      .then((result) => result.rows[0]!.id);
    const made = recording(tenant, request);
    const [columns, values] = theme
      ? [sql`theme_id, theme_version_id,`, sql`${theme.id}, ${theme.version},`]
      : [sql``, sql``];
    await sql`insert into publication (${columns} layout_id, layout_version_id, id, request_id,
                document_id, document_version_id, publisher, published_at, approval, formats,
                engine, engine_version, template, template_version, pipeline_version, fonts,
                data_sha256, numbering)
              values (${values}
                ${row.layout_id}, ${row.layout_version_id}, ${artifact}, ${request},
                ${row.document_id}, ${row.document_version_id}, ${row.requested_by},
                ${row.requested_at}, 'none', array['pdf'], 'typst', ${made.outputs[0]!.engineVersion},
                'publication', 2, ${made.pipelineVersion}, ${JSON.stringify(made.fonts)},
                ${made.dataSha256}, ${JSON.stringify(made.numbering)})`.execute(trx);
    await sql`insert into publication_input (publication_id, version_id, node)
              values (${artifact}, ${row.document_version_id}, null)`.execute(trx);
    const [outputColumns, outputValues] = produced
      ? [sql`, producer, producer_version, report`, sql`, 'typst', '2', '[]'`]
      : [sql``, sql``];
    await sql`insert into publication_output (publication_id, format, object_key, sha256, bytes,
                standard ${outputColumns})
              values (${artifact}, 'pdf', ${made.outputs[0]!.key}, ${made.outputs[0]!.sha256}, 1000,
                'ua-1' ${outputValues})`.execute(trx);
    await sql`update publication_request set state = 'done', finished_at = now()
              where id = ${request}`.execute(trx);
    return artifact;
  };

  const themesOf = (tenant: Tenant) =>
    queryAs(
      db.adminUrl,
      `select 'request' as row, id, state, theme_id, theme_version_id
         from ${tenant.schema}.publication_request
       union all
       select 'publication', request_id, null, theme_id, theme_version_id
         from ${tenant.schema}.publication
       order by 1, 2`,
    ).then((result) => result.rows);

  const byRowAndId = (a: { row: string; id: string }, b: { row: string; id: string }) =>
    a.row + a.id < b.row + b.id ? -1 : 1;

  it('gives each request still queued the default theme, leaves each answered one without, and lets every queued one finish', async () => {
    const tenant = await beforeThemes('Before themes');
    const made = await service.withTenant(tenant, async (trx) => {
      const { ada, version } = await personAndDocument(trx);
      const toFail = await requestAt0023(trx, ada, version);
      const toPublish = await requestAt0023(trx, ada, version);
      const failed = await requestAt0023(trx, ada, version);
      await sql`update publication_request
                set state = 'failed', failures = ${JSON.stringify([FAILED])}, finished_at = now()
                where id = ${failed}`.execute(trx);
      const done = await requestAt0023(trx, ada, version);
      await publicationRows(trx, tenant, done);
      return { toFail, toPublish, failed, done };
    });

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
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
    ]);

    // The one trigger held off during the migration stands enabled again, as does every other.
    const { rows: triggers } = await queryAs(
      db.adminUrl,
      `select c.relname, t.tgname, t.tgenabled
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and not t.tgisinternal and c.relname = 'publication_request'
        order by 1, 2`,
      [tenant.schema],
    );
    expect(triggers).toEqual(
      [
        'publication_request_finish_once',
        'publication_request_made_under_a_layout',
        'publication_request_made_under_a_theme',
        'publication_request_swept_only',
      ].map((tgname) => ({ relname: 'publication_request', tgname, tgenabled: 'O' })),
    );

    // The two still queued are given the declared theme at the version it stood at when 0024 ran, its
    // 0.1 - 0025 and 0026, after it, give the theme a 0.2 and a 0.3, which a request made before them
    // does not move to; the
    // answered two, and the publication one of them made, keep none.
    const declared = await service.withTenant(tenant, async (trx) => {
      const first = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', DEFAULT_THEME_ID)
        .where('revision_no', '=', 0)
        .where('version_no', '=', 1)
        .executeTakeFirstOrThrow();
      return { versionId: first.id, theme: await themeAt(trx, first.id) };
    });
    const given = { theme_id: DEFAULT_THEME_ID, theme_version_id: declared.versionId };
    const none = { theme_id: null, theme_version_id: null };
    expect(await themesOf(tenant)).toEqual(
      [
        { row: 'publication', id: made.done, state: null, ...none },
        { row: 'request', id: made.toFail, state: 'queued', ...given },
        { row: 'request', id: made.toPublish, state: 'queued', ...given },
        { row: 'request', id: made.failed, state: 'failed', ...none },
        { row: 'request', id: made.done, state: 'done', ...none },
      ].sort(byRowAndId),
    );

    // The job can finish each, both ways, as the runtime role: handed the theme it was given, and
    // recording it on the publication it makes.
    await service.withTenant(tenant, (trx) => failPublicationRequest(trx, made.toFail, [FAILED]));
    const inputs = await service.withTenant(tenant, (trx) =>
      publicationInputs(trx, made.toPublish),
    );
    expect(inputs!.theme).toEqual({ versionId: declared.versionId, theme: declared.theme });
    const publication = await service.withTenant(tenant, (trx) =>
      recordPublication(trx, recording(tenant, made.toPublish)),
    );
    expect(publication).toBeDefined();
    expect(await themesOf(tenant)).toEqual(
      [
        { row: 'publication', id: made.done, state: null, ...none },
        { row: 'publication', id: made.toPublish, state: null, ...given },
        { row: 'request', id: made.toFail, state: 'failed', ...given },
        { row: 'request', id: made.toPublish, state: 'done', ...given },
        { row: 'request', id: made.failed, state: 'failed', ...none },
        { row: 'request', id: made.done, state: 'done', ...none },
      ].sort(byRowAndId),
    );
  });

  it('leaves a request made before layouts, still queued, without a theme: template 1 reads none', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${beforeLayouts}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Before layouts' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${beforeLayouts}/`) });
    const tenant = { ...provisioned, id };
    // Inserted as the runtime role could at 0017: by what was asked alone, under no layout.
    const request = await service.withTenant(tenant, async (trx) => {
      const { ada, version } = await personAndDocument(trx);
      return sql<{ id: string }>`
        insert into publication_request (document_id, document_version_id, formats, requested_by)
        values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}) returning id`
        .execute(trx)
        .then((result) => result.rows[0]!.id);
    });

    expect((await migrate(db.migratorUrl)).tenants[id]).toContain('0024_themes');
    const none = { theme_id: null, theme_version_id: null };
    expect(await themesOf(tenant)).toEqual([
      { row: 'request', id: request, state: 'queued', ...none },
    ]);

    // The job is handed neither a layout nor a theme, and its publication, under template 1, claims
    // neither.
    const inputs = await service.withTenant(tenant, (trx) => publicationInputs(trx, request));
    expect(inputs).toMatchObject({ layout: null, theme: null });
    await service.withTenant(tenant, (trx) =>
      recordPublication(trx, {
        ...recording(tenant, request),
        pipelineVersion: '1',
        outputs: [{ ...recording(tenant, request).outputs[0]!, templateVersion: 1 }],
      }),
    );
    expect(await themesOf(tenant)).toEqual([
      { row: 'publication', id: request, state: null, ...none },
      { row: 'request', id: request, state: 'done', ...none },
    ]);
  });

  it('refuses, as the runtime role, a request made under no theme or half of one, and a publication under another theme or none', async () => {
    const tenant = await afterThemes('Refusals');
    const { ada, version, declared, layout } = await service.withTenant(tenant, async (trx) => ({
      ...(await personAndDocument(trx)),
      declared: await defaultTheme(trx),
      layout: await defaultLayout(trx),
    }));

    await expect(
      service.withTenant(tenant, (trx) => requestAt0023(trx, ada, version)),
    ).rejects.toThrow(/a request is made under a theme version/);
    await expect(
      service.withTenant(tenant, (trx) =>
        sql`insert into publication_request
              (document_id, document_version_id, formats, requested_by, layout_id,
               layout_version_id, theme_version_id)
            values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, ${layout.artifactId},
              ${layout.versionId}, ${declared.versionId})`.execute(trx),
      ),
    ).rejects.toThrow(/publication_request_theme_both/);

    const request = await service.withTenant(tenant, async (trx) => {
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

    // Under the theme's 0.2, recorded in the same transaction, or under none: each is refused when
    // the transaction commits, which takes the 0.2 with it.
    await expect(
      service.withTenant(tenant, async (trx) => {
        const next = await addThemeVersion(trx, {
          artifactId: DEFAULT_THEME_ID,
          openedFrom: declared.versionId,
          author: ada,
          theme: { ...declared.content, paper: '#fafafa' },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        await publicationRows(
          trx,
          tenant,
          request,
          { id: DEFAULT_THEME_ID, version: next.version.id },
          true,
        );
      }),
    ).rejects.toThrow(/recorded whole/);
    await expect(
      service.withTenant(tenant, (trx) =>
        publicationRows(trx, tenant, request, { id: null, version: null }, true),
      ),
    ).rejects.toThrow(/recorded whole/);
    await expect(
      service.withTenant(tenant, (trx) =>
        publicationRows(trx, tenant, request, { id: DEFAULT_THEME_ID, version: null }, true),
      ),
    ).rejects.toThrow(/publication_theme/);

    // The request is untouched, and publishes under its theme as it was made.
    await service.withTenant(tenant, (trx) => recordPublication(trx, recording(tenant, request)));
    expect(await themesOf(tenant)).toEqual([
      {
        row: 'publication',
        id: request,
        state: null,
        theme_id: DEFAULT_THEME_ID,
        theme_version_id: declared.versionId,
      },
      {
        row: 'request',
        id: request,
        state: 'done',
        theme_id: DEFAULT_THEME_ID,
        theme_version_id: declared.versionId,
      },
    ]);
  });

  it('gives the runtime role no way to change the theme a request or a publication was made under', async () => {
    const tenant = await afterThemes('Unchanged');
    const { queued, done } = await service.withTenant(tenant, async (trx) => {
      const { ada, version } = await personAndDocument(trx);
      const ask = async () => {
        const answer = await requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats: ['pdf'],
          requester: ada,
        });
        if (answer.answer !== 'requested') throw new Error(answer.answer);
        return answer.request.id;
      };
      const done = await ask();
      await recordPublication(trx, recording(tenant, done));
      return { queued: await ask(), done };
    });
    const unchanged = await themesOf(tenant);

    for (const statement of [
      sql`update publication_request set theme_version_id = null, theme_id = null
          where id = ${queued}`,
      sql`update publication_request set theme_id = ${DEFAULT_THEME_ID} where id = ${done}`,
      sql`update publication set theme_version_id = null, theme_id = null
          where request_id = ${done}`,
    ]) {
      await expect(service.withTenant(tenant, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
    // Nor does finishing a request carry a change to its theme, whatever role writes it.
    await expect(
      queryAs(
        db.adminUrl,
        `update ${tenant.schema}.publication_request
            set state = 'failed', failures = $2, finished_at = now(),
                theme_id = null, theme_version_id = null
          where id = $1`,
        [queued, JSON.stringify([FAILED])],
      ),
    ).rejects.toThrow(/a request is finished once/);
    expect(await themesOf(tenant)).toEqual(unchanged);
  });
});

describe('migration 0025, which gives the default theme its table and image styles', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let through: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0024 and none after, so a tenant stands where every environment
    // stood with the default theme's 0.1.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0025-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 25;
      },
    });
    // And every one up to 0025 itself, so what 0025 leaves is read before anything after it runs.
    through = await mkdtemp(join(tmpdir(), 'aw-through-0025-'));
    await cp(new URL('../migrations/', import.meta.url), through, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) <= 25;
      },
    });
    service = beforeTheLogDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await rm(through, { recursive: true, force: true });
    await db?.drop();
  });

  /** Every migration up to and including 0025. */
  const to0025 = () => migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${through}/`) });

  /** A tenant standing at 0024, with Ada in it, as every environment stood before this migration. */
  const atFirstTheme = async (name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  /** Every version of one artifact, in the chain's order. */
  const chainOf = (tenant: Tenant, artifactId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'revision_no', 'version_no', 'author_id'])
        .where('artifact_id', '=', artifactId)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  /** The theme's 0.1, as 0024 seeded it, read. */
  const firstTheme = () => read(FIRST_DEFAULT_THEME, FIRST_DEFAULT_CATALOGUES_BY_VERSION);

  /** The catalogues the theme's 0.2 gives a version of their own. */
  const revised = ['paragraph', 'table', 'image'] as const;

  it("gives an environment still at the product's 0.1 the new catalogues and the theme naming them: a request waiting keeps 0.1, and one made after records 0.2", async () => {
    const { tenant, ada } = await atFirstTheme('Still 0.1');
    const { version, waiting, first } = await service.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      // Written as `requestPublication` wrote it: this environment has not reached 0029.
      const requested = await requestBefore0029(trx, {
        documentId: made.version.artifactId,
        version: made.version.id,
        requester: ada,
      });
      return {
        version: made.version,
        waiting: requested,
        first: (await defaultTheme(trx)).versionId,
      };
    });

    expect((await to0025()).tenants[tenant.id]).toEqual(['0025_table_and_image_styles']);

    // The theme is at 0.2, under its fixed identifier, unauthored, on top of 0.1; each revised
    // catalogue at its 0.2 on top of its 0.1; and the other three as they were.
    expect(await chainOf(tenant, DEFAULT_THEME_ID)).toEqual([
      { id: first, revision_no: 0, version_no: 1, author_id: null },
      { id: SECOND_DEFAULT_THEME_VERSION, revision_no: 0, version_no: 2, author_id: null },
    ]);
    for (const kind of CATALOGUE_KINDS) {
      const ids = (await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind])).map((each) => each.id);
      expect(ids, kind).toEqual(
        (revised as readonly CatalogueKind[]).includes(kind)
          ? [FIRST_DEFAULT_CATALOGUE_VERSIONS[kind], SECOND_DEFAULT_CATALOGUE_VERSIONS[kind]]
          : [FIRST_DEFAULT_CATALOGUE_VERSIONS[kind]],
      );
    }
    const now = read(SECOND_DEFAULT_THEME, SECOND_DEFAULT_CATALOGUES_BY_VERSION);
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual({
      artifactId: DEFAULT_THEME_ID,
      versionId: SECOND_DEFAULT_THEME_VERSION,
      number: '0.2',
      content: SECOND_DEFAULT_THEME,
      theme: now,
      catalogues: SECOND_DEFAULT_CATALOGUES_BY_VERSION,
    });

    // `theme_default` names the theme, not a version of it: the request waiting was made under 0.1
    // and is handed 0.1, and a request made now records the latest, 0.2, and is handed that.
    const { made, handed } = await service.withTenant(tenant, async (trx) => {
      // Written as `requestPublication` wrote it: this environment has not reached 0029.
      const requested = await requestBefore0029(trx, {
        documentId: version.artifactId,
        version: version.id,
        requester: ada,
      });
      return {
        made: requested,
        handed: {
          waiting: await themeHandedAt0026(trx, waiting),
          made: await themeHandedAt0026(trx, requested),
        },
      };
    });
    expect(handed).toEqual({
      waiting: { versionId: first, theme: firstTheme() },
      made: { versionId: SECOND_DEFAULT_THEME_VERSION, theme: now },
    });
    const { rows } = await queryAs(
      db.adminUrl,
      `select id, theme_id, theme_version_id from ${tenant.schema}.publication_request
        where id in ($1, $2)`,
      [waiting, made],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: waiting, theme_id: DEFAULT_THEME_ID, theme_version_id: first },
        { id: made, theme_id: DEFAULT_THEME_ID, theme_version_id: SECOND_DEFAULT_THEME_VERSION },
      ]),
    );
  });

  for (const kind of revised) {
    it(`leaves a ${kind} catalogue version an environment recorded after 0.1, and gives the theme no 0.2 over it`, async () => {
      const { tenant, ada } = await atFirstTheme(`Own ${kind}`);
      // The environment's own 0.2 of the catalogue, its first style renamed, recorded through today's
      // writer, which writes it at catalogue/2.
      const catalogue = FIRST_DEFAULT_CATALOGUES[kind] as Catalogue1;
      const own = {
        ...catalogue,
        styles: catalogue.styles.map((style, index) =>
          index === 0 ? { ...style, name: 'Our own' } : style,
        ),
      } as Catalogue1;
      const recorded = await service.withTenant(tenant, (trx) =>
        addCatalogueVersion(trx, {
          artifactId: DEFAULT_CATALOGUE_IDS[kind],
          openedFrom: FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
          author: ada,
          catalogue: own,
        }),
      );
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      const first = await service.withTenant(tenant, (trx) => defaultTheme(trx));

      expect((await to0025()).tenants[tenant.id]).toEqual(['0025_table_and_image_styles']);

      // The catalogue is left at the environment's own 0.2, with nothing of the product's on top.
      expect(await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind])).toEqual([
        {
          id: FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
          revision_no: 0,
          version_no: 1,
          author_id: null,
        },
        { id: recorded.version.id, revision_no: 0, version_no: 2, author_id: ada },
      ]);
      // The other two revised catalogues are still the product's own, and are given their 0.2.
      for (const other of revised.filter((each) => each !== kind)) {
        const ids = (await chainOf(tenant, DEFAULT_CATALOGUE_IDS[other])).map((each) => each.id);
        expect(ids, other).toEqual([
          FIRST_DEFAULT_CATALOGUE_VERSIONS[other],
          SECOND_DEFAULT_CATALOGUE_VERSIONS[other],
        ]);
      }
      // And the theme is not: its 0.2 names this catalogue's 0.2, which this environment does not
      // hold, so it stays at 0.1, naming the catalogues it named.
      expect((await chainOf(tenant, DEFAULT_THEME_ID)).map((each) => each.id)).toEqual([
        first.versionId,
      ]);
      expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual({
        artifactId: DEFAULT_THEME_ID,
        versionId: first.versionId,
        number: '0.1',
        content: FIRST_DEFAULT_THEME,
        theme: firstTheme(),
        catalogues: FIRST_DEFAULT_CATALOGUES_BY_VERSION,
      });
    });
  }

  it('leaves a theme version an environment recorded after 0.1 as the one it declares', async () => {
    const { tenant, ada } = await atFirstTheme('Own theme');
    const own: Theme = { ...FIRST_DEFAULT_THEME, name: 'Our own', paper: '#fafafa' };
    const recorded = await service.withTenant(tenant, async (trx) =>
      addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: (await defaultTheme(trx)).versionId,
        author: ada,
        theme: own,
      }),
    );
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

    expect((await to0025()).tenants[tenant.id]).toEqual(['0025_table_and_image_styles']);

    // The theme is left at the environment's own 0.2, with nothing of the product's on top, and
    // still names the catalogues 0.1 named.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).map((each) => each.id)).toEqual([
      expect.any(String),
      recorded.version.id,
    ]);
    const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
    expect(declared).toMatchObject({ versionId: recorded.version.id, number: '0.2', content: own });
    expect(declared.theme.paper).toBe('#fafafa');
    expect(declared.theme.catalogues).toEqual(FIRST_DEFAULT_CATALOGUE_VERSIONS);
  });
});

describe("migration 0026, which gives the default theme's maths face its Word face", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let atFirst: string;
  let atSecond: string;
  let through: string;

  /** A copy of the migrations holding every tenant migration below `below` and none after. */
  const migrationsBelow = async (below: number) => {
    const dir = await mkdtemp(join(tmpdir(), `aw-before-${String(below).padStart(4, '0')}-`));
    await cp(new URL('../migrations/', import.meta.url), dir, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < below;
      },
    });
    return dir;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Where every environment stood with the default theme's 0.2, and where one stood at its 0.1.
    atSecond = await migrationsBelow(26);
    atFirst = await migrationsBelow(25);
    // And every one up to 0026 itself, so what 0026 leaves is read before 0034 gives the theme 0.4.
    through = await migrationsBelow(27);
    service = beforeTheLogDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(atSecond, { recursive: true, force: true });
    await rm(atFirst, { recursive: true, force: true });
    await rm(through, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing where `dir`'s migrations leave one, with Ada in it. */
  const standingAt = async (dir: string, name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${dir}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${dir}/`) });
    const tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  /** The theme's versions, in the chain's order. */
  const themeChain = (tenant: Tenant) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'revision_no', 'version_no', 'author_id'])
        .where('artifact_id', '=', DEFAULT_THEME_ID)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  const second = () => read(SECOND_DEFAULT_THEME, SECOND_DEFAULT_CATALOGUES_BY_VERSION);

  it("gives an environment still at the product's 0.2 the theme's 0.3: a request waiting keeps 0.2, and one made after records 0.3", async () => {
    const { tenant, ada } = await standingAt(atSecond, 'Still 0.2');
    const { version, waiting } = await service.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      // Written as `requestPublication` wrote it: this environment has not reached 0029.
      const requested = await requestBefore0029(trx, {
        documentId: made.version.artifactId,
        version: made.version.id,
        requester: ada,
      });
      return { version: made.version, waiting: requested };
    });

    expect(
      (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${through}/`) })).tenants[
        tenant.id
      ],
    ).toEqual(['0026_word']);

    // The theme is at 0.3, under its fixed identifier, unauthored, on top of 0.2; and it binds the
    // catalogues 0.2 bound, which are as they were.
    const chain = await themeChain(tenant);
    expect(chain.slice(1)).toEqual([
      { id: SECOND_DEFAULT_THEME_VERSION, revision_no: 0, version_no: 2, author_id: null },
      { id: THIRD_DEFAULT_THEME_VERSION, revision_no: 0, version_no: 3, author_id: null },
    ]);
    const now = read(THIRD_DEFAULT_THEME, SECOND_DEFAULT_CATALOGUES_BY_VERSION);
    expect(now.maths).toMatchObject({
      embedding: { pdf: true, word: false },
      wordFamily: 'Cambria Math',
    });
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual({
      artifactId: DEFAULT_THEME_ID,
      versionId: THIRD_DEFAULT_THEME_VERSION,
      number: '0.3',
      content: THIRD_DEFAULT_THEME,
      theme: now,
      catalogues: SECOND_DEFAULT_CATALOGUES_BY_VERSION,
    });

    // The request waiting was made under 0.2 and is handed 0.2; a request made now records 0.3.
    const handed = await service.withTenant(tenant, async (trx) => {
      // Written as `requestPublication` wrote it: this environment has not reached 0029.
      const made = await requestBefore0029(trx, {
        documentId: version.artifactId,
        version: version.id,
        requester: ada,
      });
      return {
        waiting: await themeHandedAt0026(trx, waiting),
        made: await themeHandedAt0026(trx, made),
      };
    });
    expect(handed).toEqual({
      waiting: { versionId: SECOND_DEFAULT_THEME_VERSION, theme: second() },
      made: { versionId: THIRD_DEFAULT_THEME_VERSION, theme: now },
    });
  });

  it('leaves a theme version an environment recorded after 0.2 as the one it declares', async () => {
    const { tenant, ada } = await standingAt(atSecond, 'Own theme after 0.2');
    const own: Theme = { ...SECOND_DEFAULT_THEME, name: 'Our own', paper: '#fafafa' };
    const recorded = await service.withTenant(tenant, async (trx) =>
      addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: (await defaultTheme(trx)).versionId,
        author: ada,
        theme: own,
      }),
    );
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
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
    ]);

    expect((await themeChain(tenant)).map((each) => each.id)).toEqual([
      expect.any(String),
      SECOND_DEFAULT_THEME_VERSION,
      recorded.version.id,
    ]);
    const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
    expect(declared).toMatchObject({ versionId: recorded.version.id, number: '0.3', content: own });
    // Its maths face is still 0.2's, which Word may embed.
    expect(declared.theme.maths.embedding).toEqual({ pdf: true, word: true });
  });

  it('gives an environment whose theme 0025 left at 0.1 nothing, since 0.3 is 0.2 with one change', async () => {
    const { tenant, ada } = await standingAt(atFirst, 'Own catalogue at 0.1');
    // Its own table catalogue, recorded before 0025, so 0025 gave the theme no 0.2.
    const catalogue = FIRST_DEFAULT_CATALOGUES.table as Catalogue1;
    const recorded = await service.withTenant(tenant, (trx) =>
      addCatalogueVersion(trx, {
        artifactId: DEFAULT_CATALOGUE_IDS.table,
        openedFrom: FIRST_DEFAULT_CATALOGUE_VERSIONS.table,
        author: ada,
        catalogue: {
          ...catalogue,
          styles: catalogue.styles.map((style) => ({ ...style, name: 'Our own' })),
        } as Catalogue1,
      }),
    );
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
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
    ]);

    const chain = await themeChain(tenant);
    expect(chain).toHaveLength(1);
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toMatchObject({
      versionId: chain[0]!.id,
      number: '0.1',
      content: FIRST_DEFAULT_THEME,
    });
  });
});

describe('migration 0034, which gives the default theme styles an author may choose', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let atThird: string;
  let upToFourth: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0033 and none after, so a tenant stands where every environment
    // stood with the default theme's 0.3.
    atThird = await mkdtemp(join(tmpdir(), 'aw-before-0034-'));
    await cp(new URL('../migrations/', import.meta.url), atThird, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 34;
      },
    });
    // And every one before 0043, which gives the theme its 0.5 (W14.5), so what 0034 leaves is read
    // before anything moves it on.
    upToFourth = await mkdtemp(join(tmpdir(), 'aw-before-0043-'));
    await cp(new URL('../migrations/', import.meta.url), upToFourth, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 43;
      },
    });
    service = beforeTheLogDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(atThird, { recursive: true, force: true });
    await rm(upToFourth, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing at 0033, with Ada in it, as every environment stood before this migration. */
  const atThirdTheme = async (name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${atThird}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${atThird}/`) });
    const tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  /** Every version of one artifact, in the chain's order. */
  const chainOf = (tenant: Tenant, artifactId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'revision_no', 'version_no', 'author_id'])
        .where('artifact_id', '=', artifactId)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  /** The catalogues the theme's 0.4 gives a version of their own. */
  const revised = ['paragraph', 'table', 'image'] as const;

  const third = () => read(THIRD_DEFAULT_THEME, SECOND_DEFAULT_CATALOGUES_BY_VERSION);

  /** What an environment still at the product's 0.3 declares. */
  const declaredThird = () => ({
    artifactId: DEFAULT_THEME_ID,
    versionId: THIRD_DEFAULT_THEME_VERSION,
    number: '0.3',
    content: THIRD_DEFAULT_THEME,
    theme: third(),
    catalogues: SECOND_DEFAULT_CATALOGUES_BY_VERSION,
  });

  it("gives an environment still at the product's 0.3 the new catalogue versions and the theme's 0.4 naming them: a request waiting keeps 0.3, and one made after records 0.4", async () => {
    const { tenant, ada } = await atThirdTheme('Still 0.3');
    const ask = (trx: TenantTransaction, version: StoredVersion) =>
      requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      }).then((answer) => {
        if (answer.answer !== 'requested') throw new Error(answer.answer);
        return answer.request.id;
      });
    const { version, waiting } = await service.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { version: made.version, waiting: await ask(trx, made.version) };
    });
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual(declaredThird());

    expect(
      (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${upToFourth}/`) })).tenants[
        tenant.id
      ],
    ).toEqual([
      '0034_default_theme_choices',
      '0035_previews',
      '0036_preview_sweep',
      '0037_iteration_retention',
      '0038_api_tokens',
      '0039_groups',
      '0040_publication_check',
      '0041_publication_check_given_up',
      '0042_sealed_sign_in_secret',
    ]);

    // The theme is at 0.4, under its fixed identifier, unauthored, on top of 0.3; each revised
    // catalogue at its third version on top of 0.2's; and the other three as they were.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(2)).toEqual([
      { id: THIRD_DEFAULT_THEME_VERSION, revision_no: 0, version_no: 3, author_id: null },
      { id: FOURTH_DEFAULT_THEME_VERSION, revision_no: 0, version_no: 4, author_id: null },
    ]);
    for (const kind of CATALOGUE_KINDS) {
      const chain = await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind]);
      expect(
        chain.map((each) => each.id),
        kind,
      ).toEqual(
        (revised as readonly CatalogueKind[]).includes(kind)
          ? [
              FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
              SECOND_DEFAULT_CATALOGUE_VERSIONS[kind],
              FOURTH_DEFAULT_CATALOGUE_VERSIONS[kind],
            ]
          : [FIRST_DEFAULT_CATALOGUE_VERSIONS[kind]],
      );
      expect(chain.at(-1), kind).toMatchObject({ revision_no: 0, author_id: null });
    }
    const now = read(FOURTH_DEFAULT_THEME, FOURTH_DEFAULT_CATALOGUES_BY_VERSION);
    expect([...now.paragraphStyles.keys()]).toEqual(
      expect.arrayContaining(['lead', 'centred', 'small-print']),
    );
    expect([...now.tableStyles.keys()]).toEqual(['table', 'banded']);
    expect([...now.imageStyles.keys()]).toEqual(['figure', 'inline', 'half-width']);
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual({
      artifactId: DEFAULT_THEME_ID,
      versionId: FOURTH_DEFAULT_THEME_VERSION,
      number: '0.4',
      content: FOURTH_DEFAULT_THEME,
      theme: now,
      catalogues: FOURTH_DEFAULT_CATALOGUES_BY_VERSION,
    });

    // `theme_default` names the theme, not a version of it: the request waiting was made under 0.3
    // and is handed 0.3, and a request made now records the latest, 0.4, and is handed that.
    const handed = await service.withTenant(tenant, async (trx) => {
      const made = await ask(trx, version);
      return {
        waiting: (await publicationInputs(trx, waiting))!.theme,
        made: (await publicationInputs(trx, made))!.theme,
      };
    });
    expect(handed).toEqual({
      waiting: { versionId: THIRD_DEFAULT_THEME_VERSION, theme: third() },
      made: { versionId: FOURTH_DEFAULT_THEME_VERSION, theme: now },
    });
  });

  for (const kind of revised) {
    it(`leaves a ${kind} catalogue version an environment recorded after 0.2, and gives the theme no 0.4 over it`, async () => {
      const { tenant, ada } = await atThirdTheme(`Own ${kind} after 0.2`);
      // The environment's own third version of the catalogue, its first style renamed.
      const catalogue = SECOND_DEFAULT_CATALOGUES[kind];
      const own = {
        ...catalogue,
        styles: catalogue.styles.map((style, index) =>
          index === 0 ? { ...style, name: 'Our own' } : style,
        ),
      } as Catalogue2;
      const recorded = await service.withTenant(tenant, (trx) =>
        addCatalogueVersion(trx, {
          artifactId: DEFAULT_CATALOGUE_IDS[kind],
          openedFrom: SECOND_DEFAULT_CATALOGUE_VERSIONS[kind],
          author: ada,
          catalogue: own,
        }),
      );
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

      expect(
        (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${upToFourth}/`) })).tenants[
          tenant.id
        ],
      ).toEqual([
        '0034_default_theme_choices',
        '0035_previews',
        '0036_preview_sweep',
        '0037_iteration_retention',
        '0038_api_tokens',
        '0039_groups',
        '0040_publication_check',
        '0041_publication_check_given_up',
        '0042_sealed_sign_in_secret',
      ]);

      // The catalogue is left at the environment's own version, with nothing of the product's on top.
      expect((await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind])).map((each) => each.id)).toEqual([
        FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
        SECOND_DEFAULT_CATALOGUE_VERSIONS[kind],
        recorded.version.id,
      ]);
      // The other two revised catalogues are still the product's own, and are given their third.
      for (const other of revised.filter((each) => each !== kind)) {
        const ids = (await chainOf(tenant, DEFAULT_CATALOGUE_IDS[other])).map((each) => each.id);
        expect(ids, other).toEqual([
          FIRST_DEFAULT_CATALOGUE_VERSIONS[other],
          SECOND_DEFAULT_CATALOGUE_VERSIONS[other],
          FOURTH_DEFAULT_CATALOGUE_VERSIONS[other],
        ]);
      }
      // And the theme is not: its 0.4 names this catalogue's third version, which this environment
      // does not hold, so it stays at 0.3, naming the catalogues it named.
      expect((await chainOf(tenant, DEFAULT_THEME_ID)).at(-1)!.id).toBe(
        THIRD_DEFAULT_THEME_VERSION,
      );
      expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual(declaredThird());
    });
  }

  it('leaves a theme version an environment recorded after 0.3 as the one it declares', async () => {
    const { tenant, ada } = await atThirdTheme('Own theme after 0.3');
    const own: Theme = { ...THIRD_DEFAULT_THEME, name: 'Our own', paper: '#fafafa' };
    const recorded = await service.withTenant(tenant, async (trx) =>
      addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: (await defaultTheme(trx)).versionId,
        author: ada,
        theme: own,
      }),
    );
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

    expect(
      (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${upToFourth}/`) })).tenants[
        tenant.id
      ],
    ).toEqual([
      '0034_default_theme_choices',
      '0035_previews',
      '0036_preview_sweep',
      '0037_iteration_retention',
      '0038_api_tokens',
      '0039_groups',
      '0040_publication_check',
      '0041_publication_check_given_up',
      '0042_sealed_sign_in_secret',
    ]);

    // The theme is left at the environment's own 0.4, with nothing of the product's on top, and still
    // names the catalogues 0.3 named.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(2).map((each) => each.id)).toEqual([
      THIRD_DEFAULT_THEME_VERSION,
      recorded.version.id,
    ]);
    const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
    expect(declared).toMatchObject({ versionId: recorded.version.id, number: '0.4', content: own });
    expect(declared.theme.catalogues).toEqual(SECOND_DEFAULT_CATALOGUE_VERSIONS);
  });
});

describe('migration 0043, which says where the default theme places each caption', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let atFourth: string;
  let upToFifth: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration before 0043 and none after, so a tenant stands where every environment
    // stood with the default theme's 0.4.
    atFourth = await mkdtemp(join(tmpdir(), 'aw-before-0043-'));
    await cp(new URL('../migrations/', import.meta.url), atFourth, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 43;
      },
    });
    // And every one before 0048, which gives the theme its 0.6 (B1), so what 0043 leaves is read
    // before anything moves it on.
    upToFifth = await mkdtemp(join(tmpdir(), 'aw-before-0048-'));
    await cp(new URL('../migrations/', import.meta.url), upToFifth, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 48;
      },
    });
    service = beforeTheLogDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(atFourth, { recursive: true, force: true });
    await rm(upToFifth, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing before 0043, with Ada in it, as every environment stood before this migration. */
  const atFourthTheme = async (name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${atFourth}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${atFourth}/`) });
    const tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  /** Every version of one artifact, in the chain's order. */
  const chainOf = (tenant: Tenant, artifactId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'revision_no', 'version_no', 'author_id', 'schema_version'])
        .where('artifact_id', '=', artifactId)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  /** The catalogues the theme's 0.5 gives a version of their own. */
  const placed = ['table', 'image'] as const;

  const fourth = () => read(FOURTH_DEFAULT_THEME, FOURTH_DEFAULT_CATALOGUES_BY_VERSION);

  /** What an environment still at the product's 0.4 declares. */
  const declaredFourth = () => ({
    artifactId: DEFAULT_THEME_ID,
    versionId: FOURTH_DEFAULT_THEME_VERSION,
    number: '0.4',
    content: FOURTH_DEFAULT_THEME,
    theme: fourth(),
    catalogues: FOURTH_DEFAULT_CATALOGUES_BY_VERSION,
  });

  it("gives an environment still at the product's 0.4 the table and image catalogues at catalogue/3 and the theme's 0.5 naming them, which reads as 0.4 did: a request waiting keeps 0.4, and one made after records 0.5", async () => {
    const { tenant, ada } = await atFourthTheme('Still 0.4');
    const ask = (trx: TenantTransaction, version: StoredVersion) =>
      requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      }).then((answer) => {
        if (answer.answer !== 'requested') throw new Error(answer.answer);
        return answer.request.id;
      });
    const { version, waiting } = await service.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { version: made.version, waiting: await ask(trx, made.version) };
    });
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual(declaredFourth());

    expect(
      (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${upToFifth}/`) })).tenants[
        tenant.id
      ],
    ).toEqual([
      '0043_default_theme_caption_placement',
      '0044_connections',
      '0045_connection_credential_target',
      '0046_query_definitions',
      '0047_datasets',
    ]);

    // The theme is at 0.5, under its fixed identifier, unauthored, on top of 0.4; the table and image
    // catalogues at their fourth versions, at catalogue/3, on top of 0.4's; the other four as they were.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(3)).toEqual([
      {
        id: FOURTH_DEFAULT_THEME_VERSION,
        revision_no: 0,
        version_no: 4,
        author_id: null,
        schema_version: 1,
      },
      {
        id: FIFTH_DEFAULT_THEME_VERSION,
        revision_no: 0,
        version_no: 5,
        author_id: null,
        schema_version: 1,
      },
    ]);
    for (const kind of CATALOGUE_KINDS) {
      const chain = await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind]);
      const moved = (placed as readonly CatalogueKind[]).includes(kind);
      expect(chain.at(-1), kind).toMatchObject({
        id: FIFTH_DEFAULT_CATALOGUE_VERSIONS[kind],
        revision_no: 0,
        author_id: null,
        ...(moved ? { version_no: 4, schema_version: 3 } : {}),
      });
      if (moved) expect(chain.at(-2)!.id, kind).toBe(FOURTH_DEFAULT_CATALOGUE_VERSIONS[kind]);
    }
    const now = read(FIFTH_DEFAULT_THEME, FIFTH_DEFAULT_CATALOGUES_BY_VERSION);
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual({
      artifactId: DEFAULT_THEME_ID,
      versionId: FIFTH_DEFAULT_THEME_VERSION,
      number: '0.5',
      content: FIFTH_DEFAULT_THEME,
      theme: now,
      catalogues: FIFTH_DEFAULT_CATALOGUES_BY_VERSION,
    });
    // Set as 0.4 was: every style alike, a table's caption above and a figure's below.
    expect({ ...now, catalogues: null }).toEqual({ ...fourth(), catalogues: null });
    expect([...now.tableStyles.values()].map((style) => style.caption)).toEqual(['above', 'above']);
    expect(
      [...now.imageStyles.values()].map((style) =>
        style.placement === 'inline' ? null : style.caption,
      ),
    ).toEqual(['below', null, 'below']);

    // `theme_default` names the theme, not a version of it: the request waiting was made under 0.4
    // and is handed 0.4, and a request made now records the latest, 0.5, and is handed that.
    const handed = await service.withTenant(tenant, async (trx) => {
      const made = await ask(trx, version);
      return {
        waiting: (await publicationInputs(trx, waiting))!.theme,
        made: (await publicationInputs(trx, made))!.theme,
      };
    });
    expect(handed).toEqual({
      waiting: { versionId: FOURTH_DEFAULT_THEME_VERSION, theme: fourth() },
      made: { versionId: FIFTH_DEFAULT_THEME_VERSION, theme: now },
    });
  });

  for (const kind of placed) {
    it(`leaves a ${kind} catalogue version an environment recorded after 0.4, and gives the theme no 0.5 over it`, async () => {
      const { tenant, ada } = await atFourthTheme(`Own ${kind} after 0.4`);
      // The environment's own fourth version of the catalogue, its first style renamed, given at
      // catalogue/2 as 0.4's rows are, and written as the reader reads it.
      const catalogue = FOURTH_DEFAULT_CATALOGUES[kind];
      const own = {
        ...catalogue,
        styles: catalogue.styles.map((style, index) =>
          index === 0 ? { ...style, name: 'Our own' } : style,
        ),
      } as Catalogue2;
      const recorded = await service.withTenant(tenant, (trx) =>
        addCatalogueVersion(trx, {
          artifactId: DEFAULT_CATALOGUE_IDS[kind],
          openedFrom: FOURTH_DEFAULT_CATALOGUE_VERSIONS[kind],
          author: ada,
          catalogue: own,
        }),
      );
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

      expect(
        (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${upToFifth}/`) })).tenants[
          tenant.id
        ],
      ).toEqual([
        '0043_default_theme_caption_placement',
        '0044_connections',
        '0045_connection_credential_target',
        '0046_query_definitions',
        '0047_datasets',
      ]);

      // The catalogue is left at the environment's own version, with nothing of the product's on top.
      expect((await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind])).map((each) => each.id)).toEqual([
        FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
        SECOND_DEFAULT_CATALOGUE_VERSIONS[kind],
        FOURTH_DEFAULT_CATALOGUE_VERSIONS[kind],
        recorded.version.id,
      ]);
      // The other is still the product's own, and is given its fourth.
      for (const other of placed.filter((each) => each !== kind)) {
        const ids = (await chainOf(tenant, DEFAULT_CATALOGUE_IDS[other])).map((each) => each.id);
        expect(ids.at(-1), other).toBe(FIFTH_DEFAULT_CATALOGUE_VERSIONS[other]);
      }
      // And the theme is not: its 0.5 names this catalogue's fourth version, which this environment
      // does not hold, so it stays at 0.4, naming the catalogues it named.
      expect((await chainOf(tenant, DEFAULT_THEME_ID)).at(-1)!.id).toBe(
        FOURTH_DEFAULT_THEME_VERSION,
      );
      expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual(
        declaredFourth(),
      );
    });
  }

  it('leaves a theme version an environment recorded after 0.4 as the one it declares', async () => {
    const { tenant, ada } = await atFourthTheme('Own theme after 0.4');
    const own: Theme = { ...FOURTH_DEFAULT_THEME, name: 'Our own', paper: '#fafafa' };
    const recorded = await service.withTenant(tenant, async (trx) =>
      addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: (await defaultTheme(trx)).versionId,
        author: ada,
        theme: own,
      }),
    );
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

    expect(
      (await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${upToFifth}/`) })).tenants[
        tenant.id
      ],
    ).toEqual([
      '0043_default_theme_caption_placement',
      '0044_connections',
      '0045_connection_credential_target',
      '0046_query_definitions',
      '0047_datasets',
    ]);

    // The theme is left at the environment's own 0.5, with nothing of the product's on top, and still
    // names the catalogues 0.4 named, which read with their captions where they always stood.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(3).map((each) => each.id)).toEqual([
      FOURTH_DEFAULT_THEME_VERSION,
      recorded.version.id,
    ]);
    const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
    expect(declared).toMatchObject({ versionId: recorded.version.id, number: '0.5', content: own });
    expect(declared.theme.catalogues).toEqual(FOURTH_DEFAULT_CATALOGUE_VERSIONS);
    expect(declared.theme.tableStyles.get('table')!.caption).toBe('above');
  });
});

describe('migration 0048, which gives the default theme its value catalogue', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let atFifth: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration before 0048 and none after, so a tenant stands where every environment
    // stood with the default theme's 0.5.
    atFifth = await mkdtemp(join(tmpdir(), 'aw-before-0048-'));
    await cp(new URL('../migrations/', import.meta.url), atFifth, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 48;
      },
    });
    service = beforeTheLogDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(atFifth, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing before 0048, with Ada in it, as every environment stood before this migration. */
  const atFifthTheme = async (name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${atFifth}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${atFifth}/`) });
    const tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  /** Every version of one artifact, in the chain's order. */
  const chainOf = (tenant: Tenant, artifactId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'revision_no', 'version_no', 'author_id', 'schema_version'])
        .where('artifact_id', '=', artifactId)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  const fifth = () => read(FIFTH_DEFAULT_THEME, FIFTH_DEFAULT_CATALOGUES_BY_VERSION);

  it("gives an environment still at the product's 0.5 the value catalogue and the theme's 0.6 naming it, reading style for style as 0.5 did with the default formats: a request waiting keeps 0.5, and one made after records 0.6", async () => {
    const { tenant, ada } = await atFifthTheme('Still 0.5');
    const ask = (trx: TenantTransaction, version: StoredVersion) =>
      requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      }).then((answer) => {
        if (answer.answer !== 'requested') throw new Error(answer.answer);
        return answer.request.id;
      });
    const { version, waiting } = await service.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { version: made.version, waiting: await ask(trx, made.version) };
    });
    expect((await service.withTenant(tenant, (trx) => defaultTheme(trx))).versionId).toBe(
      FIFTH_DEFAULT_THEME_VERSION,
    );

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
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
    ]);

    // The theme is at 0.6, under its fixed identifier, unauthored, on top of 0.5; the value catalogue
    // an artifact of its own in no space, its 0.1 at catalogue/3; the six catalogues as they were.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(4)).toEqual([
      {
        id: FIFTH_DEFAULT_THEME_VERSION,
        revision_no: 0,
        version_no: 5,
        author_id: null,
        schema_version: 1,
      },
      {
        id: SIXTH_DEFAULT_THEME_VERSION,
        revision_no: 0,
        version_no: 6,
        author_id: null,
        schema_version: 1,
      },
      // And 0055's 0.7 on top (TB1), naming the table catalogue's fifth version.
      {
        id: DEFAULT_THEME_VERSION,
        revision_no: 0,
        version_no: 7,
        author_id: null,
        schema_version: 1,
      },
    ]);
    expect(await chainOf(tenant, DEFAULT_VALUE_CATALOGUE_ID)).toEqual([
      {
        id: DEFAULT_CATALOGUE_VERSIONS.value,
        revision_no: 0,
        version_no: 1,
        author_id: null,
        schema_version: 3,
      },
    ]);
    for (const kind of CATALOGUE_KINDS) {
      const chain = await chainOf(tenant, DEFAULT_CATALOGUE_IDS[kind]);
      expect(chain.at(-1)!.id, kind).toBe(
        kind === 'table'
          ? DEFAULT_CATALOGUE_VERSIONS.table
          : FIFTH_DEFAULT_CATALOGUE_VERSIONS[kind],
      );
    }
    const sixth = read(SIXTH_DEFAULT_THEME, SIXTH_DEFAULT_CATALOGUES_BY_VERSION);
    const now = read(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
    expect(await service.withTenant(tenant, (trx) => defaultTheme(trx))).toEqual({
      artifactId: DEFAULT_THEME_ID,
      versionId: DEFAULT_THEME_VERSION,
      number: '0.7',
      content: DEFAULT_THEME,
      theme: now,
      catalogues: DEFAULT_CATALOGUES_BY_VERSION,
    });
    // 0.6 is set as 0.5 was, style for style, with the value catalogue beside: the product's default
    // formats.
    expect({ ...sixth, valueCatalogue: null }).toEqual(fifth());
    expect(sixth.valueCatalogue).toEqual(SIXTH_DEFAULT_CATALOGUES.value);
    expect(formatsFor(sixth.valueCatalogue, 'en-GB')).toEqual(DEFAULT_VALUE_FORMATS);

    // The request waiting was made under 0.5 and is handed 0.5; one made now records the latest, 0.7.
    const handed = await service.withTenant(tenant, async (trx) => {
      const made = await ask(trx, version);
      return {
        waiting: (await publicationInputs(trx, waiting))!.theme,
        made: (await publicationInputs(trx, made))!.theme,
      };
    });
    expect(handed).toEqual({
      waiting: { versionId: FIFTH_DEFAULT_THEME_VERSION, theme: fifth() },
      made: { versionId: DEFAULT_THEME_VERSION, theme: now },
    });
  });

  it('leaves a theme version an environment recorded after 0.5 as the one it declares, read with the default formats', async () => {
    const { tenant, ada } = await atFifthTheme('Own theme after 0.5');
    const own: Theme = { ...FIFTH_DEFAULT_THEME, name: 'Our own', paper: '#fafafa' };
    const recorded = await service.withTenant(tenant, async (trx) =>
      addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: (await defaultTheme(trx)).versionId,
        author: ada,
        theme: own,
      }),
    );
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
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
    ]);

    // The theme is left at the environment's own version, with nothing of the product's on top; the
    // value catalogue is held, and named by nothing until the environment's theme names it.
    expect((await chainOf(tenant, DEFAULT_THEME_ID)).slice(4).map((each) => each.id)).toEqual([
      FIFTH_DEFAULT_THEME_VERSION,
      recorded.version.id,
    ]);
    expect((await chainOf(tenant, DEFAULT_VALUE_CATALOGUE_ID)).map((each) => each.id)).toEqual([
      DEFAULT_CATALOGUE_VERSIONS.value,
    ]);
    const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
    expect(declared).toMatchObject({ versionId: recorded.version.id, number: '0.6', content: own });
    expect(declared.theme.valueCatalogue).toBeNull();
    expect(formatsFor(declared.theme.valueCatalogue, 'en-GB')).toEqual(DEFAULT_VALUE_FORMATS);
  });

  /** As the cluster's owner: a change no role of the product's could make, to stand for one made by hand. */
  const byHand = (tenant: Tenant, statement: string) =>
    queryAs(db.adminUrl, statement.replaceAll('$schema', `"${tenant.schema}"`));

  /** The theme's chain past 0.4, by identifier, after migrating to the end. */
  const migratedPastFourth = async (tenant: Tenant) => {
    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
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
    ]);
    return (await chainOf(tenant, DEFAULT_THEME_ID)).slice(4).map((each) => each.id);
  };

  it("gives no 0.6 over a 0.5 whose content is not the product's, though its identifier is", async () => {
    const { tenant } = await atFifthTheme('0.5 changed by hand');
    await byHand(
      tenant,
      `update $schema.artifact_version set content_hash = '${'0'.repeat(64)}'
        where id = '${FIFTH_DEFAULT_THEME_VERSION}'`,
    );
    expect(await migratedPastFourth(tenant)).toEqual([FIFTH_DEFAULT_THEME_VERSION]);
    // The value catalogue goes in all the same: it is named by nothing until a theme names it.
    expect((await chainOf(tenant, DEFAULT_VALUE_CATALOGUE_ID)).map((each) => each.id)).toEqual([
      DEFAULT_CATALOGUE_VERSIONS.value,
    ]);
  });

  it('gives no 0.6 over a 0.5 with an author, which the product never wrote', async () => {
    const { tenant, ada } = await atFifthTheme('0.5 with an author');
    await byHand(
      tenant,
      `update $schema.artifact_version set author_id = '${ada}'
        where id = '${FIFTH_DEFAULT_THEME_VERSION}'`,
    );
    expect(await migratedPastFourth(tenant)).toEqual([FIFTH_DEFAULT_THEME_VERSION]);
  });

  it('gives no 0.6 where the value catalogue already had a version, so its 0.1 did not go in', async () => {
    const { tenant } = await atFifthTheme('Value catalogue before 0048');
    // A version of the value catalogue's artifact, under another identifier: 0048 inserts its 0.1
    // only where the catalogue has none, and the theme's 0.6 must not name a version not there.
    await byHand(
      tenant,
      `insert into $schema.artifact (id, kind, space_id)
         values ('${DEFAULT_VALUE_CATALOGUE_ID}', 'catalogue', null);
       insert into $schema.artifact_version (
         id, artifact_id, kind, revision_no, version_no, author_id, note, schema_version, content,
         content_hash, metadata_values, not_carried, component_type_version_id, version_digest)
       select gen_random_uuid(), '${DEFAULT_VALUE_CATALOGUE_ID}', kind, 0, 1, author_id, note,
         schema_version, content, content_hash, metadata_values, not_carried,
         component_type_version_id, version_digest
       from $schema.artifact_version where id = '${FIFTH_DEFAULT_CATALOGUE_VERSIONS.table}'`,
    );
    expect(await migratedPastFourth(tenant)).toEqual([FIFTH_DEFAULT_THEME_VERSION]);
    const value = await chainOf(tenant, DEFAULT_VALUE_CATALOGUE_ID);
    expect(value.map((each) => each.id)).not.toContain(DEFAULT_CATALOGUE_VERSIONS.value);
  });

  it('leaves an environment upgraded to it alike a fresh one: the theme, the value catalogue and dataset_take', async () => {
    const { tenant: upgraded } = await atFifthTheme('Upgraded');
    await migrate(db.migratorUrl);
    const fresh = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Fresh' },
      hostnames: ['fresh.acme.alloy.test'],
    });
    const shape = async (tenant: Tenant) => ({
      // Past 0.1, whose identifier 0024 left to each environment.
      theme: (await chainOf(tenant, DEFAULT_THEME_ID)).slice(1),
      value: await chainOf(tenant, DEFAULT_VALUE_CATALOGUE_ID),
      declared: await service.withTenant(tenant, (trx) => defaultTheme(trx)),
      constraints: (
        await queryAs(
          db.adminUrl,
          `select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
             join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
            where n.nspname = $1 and t.relname = 'dataset_take' order by c.conname`,
          [tenant.schema],
        )
      ).rows.map((row) => [row.conname, (row.def as string).replaceAll(`${tenant.schema}.`, '')]),
      privileges: (
        await queryAs(
          db.adminUrl,
          `select privilege_type from information_schema.table_privileges
            where table_schema = $1 and grantee = $1 and table_name = 'dataset_take'
            order by privilege_type`,
          [tenant.schema],
        )
      ).rows.map((row) => row.privilege_type),
    });
    const before = await shape(upgraded);
    expect(before).toEqual(await shape(fresh));
    expect(before.privileges).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(before.declared.versionId).toBe(DEFAULT_THEME_VERSION);
  });
});
