import {
  EXPORT_TABLES,
  PARTIAL_CONFIGURATION,
  PARTIAL_CONTENT,
  PARTIAL_REFERENCED,
  carriedTables,
  createComponent,
  createDocument,
  createJobQueue,
  createSpace,
  createTenant,
  editOutline,
  migrate,
  prepareDatabase,
  readExportCatalogue,
  readTenantExport,
  requestTenantExport,
  type ExportScope,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantExportJob } from './jobs/tenant-export.js';
import { contentHashOf, readArchive, versionDigestOf } from './testing/export-reader.js';
import { processNext, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
const MARKER = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.SEALEDMARKER';

describe('a part of a tenant exported (EI-R)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let store: TenantStore;
  let tenant: Tenant;
  let ada = '';
  let general = '';
  let elsewhere = '';
  let inside = '';
  let outside = '';
  let document = '';
  let documentVersion = '';

  const made = async <T extends { answer: string }>(answer: Promise<T> | T) => {
    const got = await answer;
    if (got.answer !== 'created' && got.answer !== 'recorded') throw new Error(JSON.stringify(got));
    return got as T & { version: { artifactId: string; id: string } };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await objects.setUp(db.adminUrl, tenant);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    await service.withTenant(tenant, async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: 'ada@example.com',
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const administrator = await trx
        .selectFrom('role')
        .select('id')
        .where('name', '=', 'Administrator')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access_grant')
        .values({
          principal_id: ada,
          role_id: administrator.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: ada,
        })
        .execute();
      store = await stores.forTenant(trx, tenant);
    });
    elsewhere = (await service.withTenant(tenant, (trx) => createSpace(trx, 'Elsewhere'))).id;
    const component = (title: string, spaceId: string) =>
      service.withTenant(tenant, (trx) =>
        made(
          createComponent(trx, {
            spaceId,
            title,
            language: 'en-GB',
            direction: 'ltr',
            author: ada,
          }),
        ),
      );
    inside = (await component('Inside', general)).version.artifactId;
    outside = (await component('Outside', elsewhere)).version.artifactId;
    const blank = await service.withTenant(tenant, (trx) =>
      made(
        createDocument(trx, {
          spaceId: general,
          title: 'The report',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        }),
      ),
    );
    document = blank.version.artifactId;
    documentVersion = blank.version.id;
    for (const part of [inside, outside]) {
      const placed = await service.withTenant(tenant, (trx) =>
        editOutline(trx, {
          artifactId: document,
          openedFrom: documentVersion,
          author: ada,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'reference', component: part, mode: { kind: 'latest' } },
          } as never,
        }),
      );
      if (placed.answer !== 'recorded') throw new Error(JSON.stringify(placed));
      documentVersion = placed.version.id;
    }
    await service.withTenant(tenant, async (trx) => {
      await sql`insert into model_endpoint (name, protocol, base_url, model, context_window,
          price_in_micros, price_out_micros, currency, boundary, made_by)
        values ('Marked', 'openai', 'https://model.example/', 'm', 2000, 0, 0, 'GBP', 'inside',
                ${ada})`.execute(trx);
      await sql`insert into model_credential (endpoint_id, sealed, sealed_for, set_by)
        select id, ${MARKER}, ${MARKER}, ${ada} from model_endpoint`.execute(trx);
      await sql`insert into audit_event (kind, actor_kind, actor, outcome)
        values ('export.produced', 'person', ${ada}::uuid, 'done')`.execute(trx);
    });
  }, 180_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  const exported = async (scope: ExportScope, id: string | null, followReferences = false) => {
    const asked = await service.withTenant(tenant, (trx) =>
      requestTenantExport(trx, ada, { scope, id, followReferences }),
    );
    await processNext({
      queue,
      db: worker,
      handlers: { tenant_export: tenantExportJob({ db: worker, stores }) },
      workerId: 'worker-1',
      leaseMs: 60_000,
      log: quiet,
    });
    const written = (await service.withTenant(tenant, (trx) => readTenantExport(trx, asked.id)))!;
    expect(written.state).toBe('done');
    const bytes = await store.get(written.key!);
    const archive = readArchive(bytes);
    return {
      archive,
      bytes,
      ids: (table: string) => archive.rows(table).map((row) => row['id'] as string),
    };
  };

  it('names every carried table as content, referenced, configuration or out on purpose, and every required key as reachable', async () => {
    const catalogue = await service.withTenant(tenant, (trx) => readExportCatalogue(trx));
    const wrong = catalogue.foreignKeys.filter(
      (fk) =>
        PARTIAL_CONTENT.has(fk.table) &&
        !fk.nullable &&
        !PARTIAL_CONTENT.has(fk.refers) &&
        !PARTIAL_REFERENCED.has(fk.refers),
    );
    expect(wrong.map((fk) => `${fk.table}.${fk.columns.join()} -> ${fk.refers}`)).toEqual([]);
    for (const table of [...PARTIAL_CONTENT, ...PARTIAL_REFERENCED, ...PARTIAL_CONFIGURATION]) {
      expect(EXPORT_TABLES[table]?.fate, table).toBe('carried');
    }
    // Every content table is reached from an artifact through a required key.
    const unreachable = [...PARTIAL_CONTENT].filter(
      (table) =>
        table !== 'artifact' &&
        !catalogue.foreignKeys.some(
          (fk) => fk.table === table && !fk.nullable && PARTIAL_CONTENT.has(fk.refers),
        ),
    );
    expect(unreachable).toEqual([]);
    expect(carriedTables().length).toBeGreaterThan(PARTIAL_CONTENT.size);
  });

  it('IMP-024 IMP-052 exports one space with what it needs, and no audit, access or other space', async () => {
    const { archive, ids } = await exported('space', general);
    expect(archive.manifest).toMatchObject({ format: 2, scope: 'space', scopeId: general });
    const artifacts = ids('artifact');
    expect(artifacts).toEqual(expect.arrayContaining([inside, document]));
    expect(artifacts).not.toContain(outside);
    expect(archive.entries).not.toContain('tables/audit_event.jsonl.gz');
    expect(archive.entries).not.toContain('tables/access_grant.jsonl.gz');
    expect(archive.entries).not.toContain('tables/role.jsonl.gz');
    expect((archive.manifest['leftOut'] as Record<string, string>)['audit_event']).toMatch(/whole/);
    expect(ids('space')).toEqual([general]);
  });

  it('IMP-038 lists what a part refers to outside itself by identity', async () => {
    const { archive, ids } = await exported('space', general);
    expect(archive.entries).toContain('references.jsonl');
    expect(ids('artifact')).not.toContain(outside);
    const listed = archive
      .bytes('references.jsonl')!
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { table: string; id: string; how: string });
    expect(listed).toContainEqual({ table: 'artifact', id: outside, how: 'by_identity' });
  });

  it('IMP-040 follows references when asked, says so, and lists them by value', async () => {
    const { archive, ids } = await exported('space', general, true);
    expect(archive.manifest).toMatchObject({ followReferences: true });
    expect(ids('artifact')).toContain(outside);
    const listed = archive
      .bytes('references.jsonl')!
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { table: string; id: string; how: string });
    expect(listed).toContainEqual({ table: 'artifact', id: outside, how: 'by_value' });
  });

  it('IMP-024 exports one document, its versions checking out from the archive alone', async () => {
    const { archive, ids } = await exported('document', document);
    expect(ids('artifact')).toContain(document);
    expect(ids('artifact')).not.toContain(inside);
    const definitions = archive.rows('version_definition');
    const versions = archive.rows('artifact_version');
    expect(versions.map((each) => each['id'])).toContain(documentVersion);
    for (const version of versions) {
      expect(contentHashOf(version)).toBe(version['content_hash']);
      expect(
        versionDigestOf(
          version,
          definitions.filter((each) => each['version_id'] === version['id']),
        ),
      ).toBe(version['version_digest']);
    }
  });

  it('holds of a person only what finds them elsewhere', async () => {
    const { archive } = await exported('document', document);
    const ada_ = archive.rows('principal').find((each) => each['id'] === ada)!;
    expect(ada_).toMatchObject({ subject: 'ada', display_name: 'Ada' });
    expect(ada_).not.toHaveProperty('email');
  });

  it('ADM-005 ADM-054 exports the configuration, with roles and secrets as references, and no content', async () => {
    const { archive, bytes, ids } = await exported('configuration', null);
    expect(archive.rows('role').length).toBeGreaterThan(5);
    expect(archive.rows('workflow_definition').length).toBeGreaterThan(0);
    expect(archive.rows('model_endpoint').map((each) => each['name'])).toContain('Marked');
    expect(archive.secrets.map((each) => each['kind'])).toContain('model_endpoint');
    expect(ids('artifact')).not.toContain(document);
    expect(bytes.includes('SEALEDMARKER')).toBe(false);
    expect(JSON.stringify(archive.rows('model_credential'))).not.toContain('SEALEDMARKER');
  });

  it('IMP-023 leaves out of a partial export what its asker may not read', async () => {
    const bea = await service.withTenant(tenant, async (trx) => {
      const person = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'bea',
          email: null,
          display_name: 'Bea',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const reader = await trx
        .selectFrom('role')
        .select('id')
        .where('name', '=', 'Reader')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access_grant')
        .values({
          principal_id: person.id,
          role_id: reader.id,
          level: 'space',
          space_id: elsewhere,
          effect: 'allow',
          granted_by: ada,
        } as never)
        .execute();
      return person.id;
    });
    const asked = await service.withTenant(tenant, (trx) =>
      requestTenantExport(trx, bea, { scope: 'space', id: general }),
    );
    await processNext({
      queue,
      db: worker,
      handlers: { tenant_export: tenantExportJob({ db: worker, stores }) },
      workerId: 'worker-1',
      leaseMs: 60_000,
      log: quiet,
    });
    const written = (await service.withTenant(tenant, (trx) => readTenantExport(trx, asked.id)))!;
    const archive = readArchive(await store.get(written.key!));
    const artifacts = archive.rows('artifact').map((row) => row['id']);
    expect(artifacts).not.toContain(inside);
    expect(artifacts).not.toContain(document);
  });

  it('COL-053 holds no internal thread in a partial export', async () => {
    const thread = await service.withTenant(tenant, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        insert into thread (on_id, on_kind, made_against, anchor, created_by)
        values (${document}, 'document', ${documentVersion},
                '{"kind":"node","node":"n"}'::jsonb, ${ada})
        returning id`.execute(trx);
      await sql`insert into thread_internal (thread_id, marked_by)
        values (${rows[0]!.id}, ${ada})`.execute(trx);
      return rows[0]!.id;
    });
    const { ids } = await exported('document', document);
    expect(ids('thread')).not.toContain(thread);
  });
});
