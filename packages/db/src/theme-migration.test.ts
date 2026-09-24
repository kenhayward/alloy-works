import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultNumberingScheme, type PublishFailure } from '@alloy-works/domain';
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
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { addThemeVersion, DEFAULT_THEME_ID, defaultTheme } from './themes.js';
import type { StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
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
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
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
    engineVersion: '0.15.1',
    templateVersion: 2,
    pipelineVersion: '2',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    output: {
      key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
      sha256: 'c'.repeat(64),
      bytes: 1000,
    },
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
   * and can be rigged on one after it. Marks the request done, and is checked when its transaction
   * commits.
   */
  const publicationRows = async (
    trx: TenantTransaction,
    tenant: Tenant,
    request: string,
    theme?: { readonly id: string | null; readonly version: string | null },
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
                ${row.requested_at}, 'none', array['pdf'], 'typst', ${made.engineVersion},
                'publication', 2, ${made.pipelineVersion}, ${JSON.stringify(made.fonts)},
                ${made.dataSha256}, ${JSON.stringify(made.numbering)})`.execute(trx);
    await sql`insert into publication_input (publication_id, version_id, node)
              values (${artifact}, ${row.document_version_id}, null)`.execute(trx);
    await sql`insert into publication_output (publication_id, format, object_key, sha256, bytes, standard)
              values (${artifact}, 'pdf', ${made.output.key}, ${made.output.sha256}, 1000, 'ua-1')`.execute(
      trx,
    );
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

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual(['0024_themes']);

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
      ].map((tgname) => ({ relname: 'publication_request', tgname, tgenabled: 'O' })),
    );

    // The two still queued are given the declared theme at its version; the answered two, and the
    // publication one of them made, keep none.
    const declared = await service.withTenant(tenant, (trx) => defaultTheme(trx));
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
        await publicationRows(trx, tenant, request, {
          id: DEFAULT_THEME_ID,
          version: next.version.id,
        });
      }),
    ).rejects.toThrow(/recorded whole/);
    await expect(
      service.withTenant(tenant, (trx) =>
        publicationRows(trx, tenant, request, { id: null, version: null }),
      ),
    ).rejects.toThrow(/recorded whole/);
    await expect(
      service.withTenant(tenant, (trx) =>
        publicationRows(trx, tenant, request, { id: DEFAULT_THEME_ID, version: null }),
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
