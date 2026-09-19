import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  defaultLayout as productDefaultLayout,
  defaultNumberingScheme,
  type Layout,
  type PublishFailure,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { DEFAULT_LAYOUT_ID, defaultLayout } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { failPublicationRequest, recordPublication, requestPublication } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';
import type { StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const FAILED: PublishFailure = {
  stage: 'compose',
  code: 'engine_failed',
  node: null,
  block: null,
  detail: null,
};

describe('migration 0018, which gives every environment its default layout', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0017 and none after, so a tenant can stand where every environment
    // stood before layouts - whatever has been added since 0018.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0018-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 18;
      },
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing at 0017, as every environment stood before this migration. */
  const atPublishing = async (name: string): Promise<Tenant & { id: string }> => {
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
    return { ada: ada.id, space: general.id, version: made.version };
  };

  /** What a worker records for a request under template 1, over an output the store need not hold. */
  const recording = (tenant: Tenant, requestId: string) => ({
    requestId,
    engineVersion: '0.15.1',
    templateVersion: 1,
    pipelineVersion: '1',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    output: {
      key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
      sha256: 'c'.repeat(64),
      bytes: 1000,
    },
  });

  /**
   * A publication written row by row as the runtime role, the way `recordPublication` writes one,
   * with the layout columns named only where given - so it runs on a tenant at 0017, where they do
   * not exist, and can be rigged on one after it.
   */
  const publicationRows = async (
    trx: TenantTransaction,
    tenant: Tenant,
    request: string,
    options: { readonly templateVersion?: number; readonly done?: boolean } = {},
  ) => {
    const row = await sql<{
      document_id: string;
      document_version_id: string;
      requested_by: string;
      requested_at: Date;
      space_id: string;
    }>`select r.document_id, r.document_version_id, r.requested_by, r.requested_at, a.space_id
       from publication_request r join artifact a on a.id = r.document_id
       where r.id = ${request}`
      .execute(trx)
      .then((result) => result.rows[0]!);
    const artifact = await sql<{ id: string }>`
      insert into artifact (kind, space_id) values ('publication', ${row.space_id}) returning id`
      .execute(trx)
      .then((result) => result.rows[0]!.id);
    const made = recording(tenant, request);
    await sql`insert into publication (id, request_id, document_id, document_version_id, publisher,
                published_at, approval, formats, engine, engine_version, template, template_version,
                pipeline_version, fonts, data_sha256, numbering)
              values (${artifact}, ${request}, ${row.document_id}, ${row.document_version_id},
                ${row.requested_by}, ${row.requested_at}, 'none', array['pdf'], 'typst',
                ${made.engineVersion}, 'publication', ${options.templateVersion ?? 1},
                ${made.pipelineVersion}, ${JSON.stringify(made.fonts)}, ${made.dataSha256},
                ${JSON.stringify(made.numbering)})`.execute(trx);
    await sql`insert into publication_input (publication_id, version_id, node)
              values (${artifact}, ${row.document_version_id}, null)`.execute(trx);
    await sql`insert into publication_output (publication_id, format, object_key, sha256, bytes, standard)
              values (${artifact}, 'pdf', ${made.output.key}, ${made.output.sha256}, 1000, 'ua-1')`.execute(
      trx,
    );
    if (options.done ?? true) {
      await sql`update publication_request set state = 'done', finished_at = now()
                where id = ${request}`.execute(trx);
    }
    return artifact;
  };

  /** A request inserted as the runtime role may insert one at 0017: by what was asked alone. */
  const requestAt0017 = (trx: TenantTransaction, requester: string, version: StoredVersion) =>
    sql<{ id: string }>`
      insert into publication_request (document_id, document_version_id, formats, requested_by)
      values (${version.artifactId}, ${version.id}, array['pdf'], ${requester}) returning id`
      .execute(trx)
      .then((result) => result.rows[0]!.id);

  const layoutsOf = (tenant: Tenant) =>
    queryAs(
      db.adminUrl,
      `select 'request' as row, id, state, layout_id, layout_version_id
         from ${tenant.schema}.publication_request
       union all
       select 'publication', request_id, null, layout_id, layout_version_id
         from ${tenant.schema}.publication
       order by 1, 2`,
    ).then((result) => result.rows);

  it('leaves every request and publication made before layouts without one, and lets a queued one finish', async () => {
    const tenant = await atPublishing('Before layouts');
    const made = await service.withTenant(tenant, async (trx) => {
      const { ada, version } = await personAndDocument(trx);
      const toFail = await requestAt0017(trx, ada, version);
      const toPublish = await requestAt0017(trx, ada, version);
      const failed = await requestAt0017(trx, ada, version);
      await sql`update publication_request
                set state = 'failed', failures = ${JSON.stringify([FAILED])}, finished_at = now()
                where id = ${failed}`.execute(trx);
      const done = await requestAt0017(trx, ada, version);
      await publicationRows(trx, tenant, done);
      return { toFail, toPublish, failed, done };
    });

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual(['0018_layouts']);

    // No trigger was held off, and every one stands enabled.
    const { rows: triggers } = await queryAs(
      db.adminUrl,
      `select c.relname, t.tgname, t.tgenabled
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and not t.tgisinternal and c.relname like 'publication%'
        order by 1, 2`,
      [tenant.schema],
    );
    expect(triggers).toEqual([
      {
        relname: 'publication',
        tgname: 'publication_recorded_whole',
        tgenabled: 'O',
      },
      {
        relname: 'publication_input',
        tgname: 'publication_input_while_queued',
        tgenabled: 'O',
      },
      {
        relname: 'publication_output',
        tgname: 'publication_output_while_queued',
        tgenabled: 'O',
      },
      {
        relname: 'publication_request',
        tgname: 'publication_request_finish_once',
        tgenabled: 'O',
      },
      {
        relname: 'publication_request',
        tgname: 'publication_request_made_under_a_layout',
        tgenabled: 'O',
      },
      {
        relname: 'publication_request_occurrence',
        tgname: 'publication_request_occurrence_while_queued',
        tgenabled: 'O',
      },
    ]);

    // Nothing was backfilled: every request and the publication stand as they were made.
    expect(await layoutsOf(tenant)).toEqual(
      [
        { row: 'publication', id: made.done, state: null },
        { row: 'request', id: made.toFail, state: 'queued' },
        { row: 'request', id: made.toPublish, state: 'queued' },
        { row: 'request', id: made.failed, state: 'failed' },
        { row: 'request', id: made.done, state: 'done' },
      ]
        .map((each) => ({ ...each, layout_id: null, layout_version_id: null }))
        .sort((a, b) => (a.row + a.id < b.row + b.id ? -1 : 1)),
    );

    // The job can still finish a request queued before layouts, both ways, as the runtime role.
    await service.withTenant(tenant, (trx) => failPublicationRequest(trx, made.toFail, [FAILED]));
    const publication = await service.withTenant(tenant, (trx) =>
      recordPublication(trx, recording(tenant, made.toPublish)),
    );
    expect(publication).toBeDefined();

    const { rows } = await queryAs(
      db.adminUrl,
      `select r.id, r.state, p.template_version, p.layout_id, p.layout_version_id
         from ${tenant.schema}.publication_request r
         left join ${tenant.schema}.publication p on p.request_id = r.id
        where r.id in ($1, $2) order by r.state`,
      [made.toPublish, made.toFail],
    );
    expect(rows).toEqual([
      {
        id: made.toPublish,
        state: 'done',
        template_version: 1,
        layout_id: null,
        layout_version_id: null,
      },
      {
        id: made.toFail,
        state: 'failed',
        template_version: null,
        layout_id: null,
        layout_version_id: null,
      },
    ]);
  });

  it('makes a request under the default layout version, and records its publication under the same', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'After layouts' },
      hostnames: ['after.acme.alloy.test'],
    });
    const { declared, request, publication } = await service.withTenant(tenant, async (trx) => {
      const { ada, version } = await personAndDocument(trx);
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return {
        declared: await defaultLayout(trx),
        request: answer.request.id,
        publication: await recordPublication(trx, recording(tenant, answer.request.id)),
      };
    });
    const under = { layout_id: DEFAULT_LAYOUT_ID, layout_version_id: declared.versionId };
    expect(await layoutsOf(tenant)).toEqual([
      { row: 'publication', id: request, state: null, ...under },
      { row: 'request', id: request, state: 'done', ...under },
    ]);
    expect(publication).toBeDefined();
  });

  it('gives the runtime role no way to change the layout a request or a publication was made under', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Unchanged' },
      hostnames: ['unchanged.acme.alloy.test'],
    });
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
    const before = await layoutsOf(tenant);

    for (const statement of [
      sql`update publication_request set layout_version_id = null, layout_id = null
          where id = ${queued}`,
      sql`update publication_request set layout_id = ${DEFAULT_LAYOUT_ID} where id = ${done}`,
      sql`update publication set layout_version_id = null, layout_id = null
          where request_id = ${done}`,
    ]) {
      await expect(service.withTenant(tenant, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
    // Nor does finishing a request carry a change to its layout, whatever role writes it.
    await expect(
      queryAs(
        db.adminUrl,
        `update ${tenant.schema}.publication_request
            set state = 'failed', failures = $2, finished_at = now(),
                layout_id = null, layout_version_id = null
          where id = $1`,
        [queued, JSON.stringify([FAILED])],
      ),
    ).rejects.toThrow(/a request is finished once/);
    expect(await layoutsOf(tenant)).toEqual(before);
  });

  it('refuses, as the runtime role, a new request with no layout and a template-2 publication with none', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Refusals' },
      hostnames: ['refusals.acme.alloy.test'],
    });
    const { ada, version, declared } = await service.withTenant(tenant, async (trx) => ({
      ...(await personAndDocument(trx)),
      declared: await defaultLayout(trx),
    }));

    await expect(
      service.withTenant(tenant, (trx) => requestAt0017(trx, ada, version)),
    ).rejects.toThrow(/a request is made under a layout version/);
    await expect(
      service.withTenant(tenant, (trx) =>
        sql`insert into publication_request
              (document_id, document_version_id, formats, requested_by, layout_version_id)
            values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, ${declared.versionId})`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/publication_request_layout_both/);

    const request = await service.withTenant(tenant, (trx) =>
      sql<{ id: string }>`
        insert into publication_request
          (document_id, document_version_id, formats, requested_by, layout_id, layout_version_id)
        values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, ${declared.artifactId},
          ${declared.versionId})
        returning id`
        .execute(trx)
        .then((result) => result.rows[0]!.id),
    );
    // Under template 2 a publication is made under a layout, so one without is refused at once.
    await expect(
      service.withTenant(tenant, (trx) =>
        publicationRows(trx, tenant, request, { templateVersion: 2 }),
      ),
    ).rejects.toThrow(/publication_layout/);
    // Under template 1 it may carry none, but only where its request carries none: a publication never
    // drops the layout its request was made under. Refused when its transaction commits.
    await expect(
      service.withTenant(tenant, (trx) => publicationRows(trx, tenant, request)),
    ).rejects.toThrow(/recorded whole/);

    // The request is untouched, and publishes under its layout as it was made.
    const publication = await service.withTenant(tenant, (trx) =>
      recordPublication(trx, recording(tenant, request)),
    );
    const { rows } = await queryAs(
      db.adminUrl,
      `select layout_version_id from ${tenant.schema}.publication where id = $1`,
      [publication],
    );
    expect(rows).toEqual([{ layout_version_id: declared.versionId }]);
  });

  it("keeps the layout an environment already holds under the default's identifier", async () => {
    const tenant = await atPublishing('Own layout');
    // Standing in for a store that already holds the artifact, as 0015's starter type allows for: the
    // kind check is widened by hand so the row can exist before 0018 runs, and 0018 widens it again.
    const own: Layout = {
      ...productDefaultLayout,
      words: { ...productDefaultLayout.words, contents: 'Table of contents' },
    };
    const digests = versionDigests({ kind: 'layout', content: own });
    await queryAs(
      db.adminUrl,
      `alter table ${tenant.schema}.artifact drop constraint artifact_kind_check;
       alter table ${tenant.schema}.artifact add constraint artifact_kind_check check (kind in
         ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout'));
       insert into ${tenant.schema}.artifact (id, kind, space_id)
         values ('${DEFAULT_LAYOUT_ID}', 'layout', null);
       insert into ${tenant.schema}.artifact_version (artifact_id, kind, revision_no, version_no,
         author_id, note, schema_version, content, content_hash, metadata_values, not_carried,
         component_type_version_id, version_digest)
       values ('${DEFAULT_LAYOUT_ID}', 'layout', 0, 1, null, null, 1,
         '${JSON.stringify(own)}'::jsonb, '${digests.contentHash}', '{}'::jsonb, '[]'::jsonb, null,
         '${digests.versionDigest}');`,
    );

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual(['0018_layouts']);

    const { declared, versions } = await service.withTenant(tenant, async (trx) => ({
      declared: await defaultLayout(trx),
      versions: await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', DEFAULT_LAYOUT_ID)
        .execute(),
    }));
    expect(versions).toHaveLength(1);
    expect(declared).toEqual({
      artifactId: DEFAULT_LAYOUT_ID,
      versionId: versions[0]!.id,
      number: '0.1',
      layout: own,
    });
  });
});
