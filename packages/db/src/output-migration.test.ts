import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultNumberingScheme } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { readPublication, recordPublication, requestPublication } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ISSUER = 'https://idp.example';

describe('migration 0027, which lets a publication hold one output per format', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0026 and none after, so a tenant stands where every environment
    // stood when a publication was one PDF.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0027-outputs-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 27;
      },
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing at 0026, as every environment stood before this migration. */
  const beforeWord = async (name: string): Promise<Tenant & { id: string }> => {
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

  /** Ada, and a document in General she may publish, at 0.1. */
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

  /** A PDF publication of a PDF request, requested today, at the given template version. */
  const requestFor = async (
    trx: TenantTransaction,
    ada: string,
    version: { artifactId: string; id: string },
  ) => {
    const answer = await requestPublication(trx, {
      documentId: version.artifactId,
      version: version.id,
      formats: ['pdf'],
      requester: ada,
    });
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    return answer.request.id;
  };

  /**
   * A publication written row by row as the runtime role, the way `recordPublication` wrote one at
   * 0026 - one PDF output with no producer or report, which the columns did not have - made by the
   * template version given.
   */
  const publicationAt0026 = async (
    trx: TenantTransaction,
    tenant: Tenant,
    request: string,
    template: number,
    fill: string,
  ) => {
    const row = await sql<{
      document_id: string;
      document_version_id: string;
      requested_by: string;
      requested_at: Date;
      layout_id: string;
      layout_version_id: string;
      theme_id: string;
      theme_version_id: string;
      space_id: string;
    }>`select r.document_id, r.document_version_id, r.requested_by, r.requested_at, r.layout_id,
         r.layout_version_id, r.theme_id, r.theme_version_id, a.space_id
       from publication_request r join artifact a on a.id = r.document_id
       where r.id = ${request}`
      .execute(trx)
      .then((result) => result.rows[0]!);
    const artifact = await sql<{ id: string }>`
      insert into artifact (kind, space_id) values ('publication', ${row.space_id}) returning id`
      .execute(trx)
      .then((result) => result.rows[0]!.id);
    await sql`insert into publication (id, request_id, document_id, document_version_id, publisher,
                published_at, approval, formats, engine, engine_version, template, template_version,
                pipeline_version, fonts, data_sha256, numbering, layout_id, layout_version_id,
                theme_id, theme_version_id)
              values (${artifact}, ${request}, ${row.document_id}, ${row.document_version_id},
                ${row.requested_by}, ${row.requested_at}, 'none', array['pdf'], 'typst', '0.15.1',
                'publication', ${template}, ${String(template)},
                ${JSON.stringify([{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }])},
                ${'b'.repeat(64)},
                ${JSON.stringify({ scheme: defaultNumberingScheme.id, entries: [] })},
                ${row.layout_id}, ${row.layout_version_id}, ${row.theme_id},
                ${row.theme_version_id})`.execute(trx);
    await sql`insert into publication_input (publication_id, version_id, node)
              values (${artifact}, ${row.document_version_id}, null)`.execute(trx);
    await sql`insert into publication_output (publication_id, format, object_key, sha256, bytes, standard)
              values (${artifact}, 'pdf', ${`${tenant.role}/sha256/${fill.repeat(64)}`},
                ${fill.repeat(64)}, 1000, 'ua-1')`.execute(trx);
    await sql`update publication_request set state = 'done', finished_at = now()
              where id = ${request}`.execute(trx);
    return artifact;
  };

  it("gives every output already made Typst as its producer, at its publication's template version, and an empty report", async () => {
    const tenant = await beforeWord('One PDF each');
    const made = await service.withTenant(tenant, async (trx) => {
      const { ada, version } = await personAndDocument(trx);
      const twelve = await publicationAt0026(
        trx,
        tenant,
        await requestFor(trx, ada, version),
        12,
        'c',
      );
      const thirteen = await publicationAt0026(
        trx,
        tenant,
        await requestFor(trx, ada, version),
        13,
        'd',
      );
      return { twelve, thirteen, queued: await requestFor(trx, ada, version) };
    });

    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
      '0027_word_layout_and_outputs',
    ]);
    const { rows } = await queryAs(
      db.adminUrl,
      `select publication_id, format, standard, producer, producer_version, report
         from ${tenant.schema}.publication_output order by producer_version`,
    );
    expect(rows).toEqual([
      {
        publication_id: made.twelve,
        format: 'pdf',
        standard: 'ua-1',
        producer: 'typst',
        producer_version: '12',
        report: [],
      },
      {
        publication_id: made.thirteen,
        format: 'pdf',
        standard: 'ua-1',
        producer: 'typst',
        producer_version: '13',
        report: [],
      },
    ]);
    // Each reads as it was made, engine, template and all.
    const read = await service.withTenant(tenant, (trx) => readPublication(trx, made.thirteen));
    expect(read).toMatchObject({
      formats: ['pdf'],
      engine: { name: 'typst', version: '0.15.1' },
      template: { name: 'publication', version: 13 },
      outputs: [
        {
          format: 'pdf',
          standard: 'ua-1',
          producer: 'typst',
          producerVersion: '13',
          report: [],
        },
      ],
    });

    // And a request queued before it still finishes with its one PDF.
    const publication = await service.withTenant(tenant, (trx) =>
      recordPublication(trx, {
        requestId: made.queued,
        pipelineVersion: '13',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 13,
            key: `${tenant.role}/sha256/${'e'.repeat(64)}`,
            sha256: 'e'.repeat(64),
            bytes: 1000,
          },
        ],
      }),
    );
    expect(publication).toBeDefined();
  });
});
