import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  EXPORT_TABLES,
  carriedTables,
  createAssetUpload,
  createComponent,
  createConnection,
  createDocument,
  editOutline,
  createJobQueue,
  createTenant,
  migrate,
  prepareDatabase,
  readAssetUpload,
  readExportCut,
  readTenantExport,
  recordEvent,
  receiveAssetBytes,
  requestTenantExport,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { sql } from 'kysely';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestJob } from './jobs/ingest.js';
import { tenantExportJob } from './jobs/tenant-export.js';
import { sweepExpiredTenantExports } from './sweep.js';
import { contentHashOf, readArchive, versionDigestOf } from './testing/export-reader.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("the tenant's export, from the queue to the store (the R21 plan, R21-B)", () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let store: TenantStore;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let ada = '';
  let general = '';

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
    handlers = {
      ingest: ingestJob({ db: worker, stores }),
      tenant_export: tenantExportJob({ db: worker, stores }),
    };
    await service.withTenant(tenant, async (trx) => {
      ada = (
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
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  const work = () =>
    processNext({ queue, db: worker, handlers, workerId: 'worker-1', leaseMs: 60_000, log: quiet });

  /** A value no archive may hold, in every column a secret is kept in. */
  const MARKER = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.SEALEDMARKER';

  const writeExport = async () => {
    const asked = await service.withTenant(tenant, (trx) => requestTenantExport(trx, ada));
    expect(asked.state).toBe('queued');
    await work();
    const written = (await service.withTenant(tenant, (trx) => readTenantExport(trx, asked.id)))!;
    expect(written.state).toBe('done');
    return { asked, written, bytes: await store.get(written.key!) };
  };

  it('API-044 IMP-021 IMP-043 writes a whole tenant that a reader knowing only the format guide reads back and checks', async () => {
    // A document placing a component, so an outline's nodes are among the digests checked.
    const part = await service.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Pump care',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    await service.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The pump report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const placed = await editOutline(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: {
            type: 'reference',
            component: part.artifactId,
            mode: { kind: 'latest' },
          },
        } as never,
      });
      if (placed.answer !== 'recorded') throw new Error(JSON.stringify(placed));
    });
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const kept = await store.put(png, 'application/octet-stream');
    const upload = await service.withTenant(tenant, async (trx) => {
      const made = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: { text: 'A red square', language: 'en-GB' },
      });
      await receiveAssetBytes(trx, made.id, { key: kept.key, format: 'png', bytes: kept.size });
      return made.id;
    });
    await work();
    expect((await service.withTenant(tenant, (trx) => readAssetUpload(trx, upload)))?.state).toBe(
      'ready',
    );

    const { asked, written, bytes } = await writeExport();
    expect(written.expiresAt!.getTime() - written.finishedAt!.getTime()).toBe(7 * 86_400_000);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(written.sha256);

    const archive = readArchive(bytes);
    // The reader's own promise: it depends on nothing of this product.
    const source = readFileSync(new URL('./testing/export-reader.ts', import.meta.url), 'utf8');
    expect(source.match(/from '[^']+'/g)).toEqual(["from 'node:crypto'", "from 'node:zlib'"]);

    // The manifest comes first, so a reader knows what it holds before reading it (EI-O).
    expect(archive.entries.slice(0, 3)).toEqual(['manifest.json', 'schema.json', 'secrets.jsonl']);
    expect(archive.manifest).toMatchObject({ format: 2, export: asked.id, scope: 'tenant' });

    // Every carried table is there, with the rows the database holds; none is a best effort.
    const counted = await service.withTenant(tenant, async (trx) => {
      const counts: Record<string, number> = {};
      for (const [name] of carriedTables()) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from ${sql.id(name)}`.execute(trx);
        counts[name] = rows[0]!.n;
      }
      return counts;
    });
    const tables = archive.manifest['tables'] as Record<string, { rows: number; file: string }>;
    expect(Object.keys(tables).sort()).toEqual(Object.keys(counted).sort());
    for (const [name, rows] of Object.entries(counted)) {
      // The job's own request and its claim happen after the cut or leave the row count alone.
      expect(tables[name]!.rows, name).toBe(rows);
      expect(archive.rows(name).length, name).toBe(rows);
    }

    // Each version's digests, recomputed from what the archive holds.
    const versions = archive.rows('artifact_version');
    expect(versions.map((each) => each['kind'])).toEqual(
      expect.arrayContaining(['component', 'document', 'asset']),
    );
    const definitions = archive.rows('version_definition');
    for (const version of versions) {
      const id = `${String(version['kind'])} ${String(version['id'])}`;
      expect(contentHashOf(version), id).toBe(version['content_hash']);
      expect(
        versionDigestOf(
          version,
          definitions.filter((each) => each['version_id'] === version['id']),
        ),
        id,
      ).toBe(version['version_digest']);
    }

    // Described column by column, so it reads without the product (IMP-019).
    const described = (
      archive.schema['tables'] as Record<
        string,
        { primaryKey: string[]; notCarried: string[]; columns: { name: string }[] }
      >
    )['artifact_version']!;
    expect(described.primaryKey).toEqual(['id']);
    expect(described.notCarried).toEqual(
      expect.arrayContaining(['written_by', 'component_type_kind']),
    );
    expect(Object.keys(versions[0]!).sort()).toEqual(
      described.columns.map((each) => each.name).sort(),
    );

    // The image's bytes, by their hash, once.
    expect(archive.bytes(`objects/${kept.sha256}`)).toEqual(png);
    expect(archive.manifest['objects']).toMatchObject({ missing: [] });
    expect(written.counts).toMatchObject({ artifact: tables['artifact']!.rows });
  });

  it('IMP-018 holds the audit log, people, grants, definitions, assets and versions, and a file for threads, baselines, publications and relationships', async () => {
    const asked = await service.withTenant(tenant, (trx) => requestTenantExport(trx, ada));
    await work();
    await service.withTenant(tenant, (trx) =>
      recordEvent(trx, {
        kind: 'export.downloaded',
        subject: { kind: 'tenant_export', id: asked.id },
        detail: { export: asked.id, of: 'tenant' },
      }),
    );
    const archive = readArchive((await writeExport()).bytes);
    expect(archive.rows('audit_event').map((each) => each['kind'])).toContain('export.downloaded');
    expect(archive.rows('principal').map((each) => each['display_name'])).toContain('Ada');
    expect(archive.rows('role').length).toBeGreaterThan(5);
    expect(archive.rows('access_grant').map((each) => each['principal_id'])).toContain(ada);
    expect(archive.rows('workflow_definition').length).toBeGreaterThan(0);
    for (const table of ['thread', 'baseline', 'publication', 'relationship']) {
      expect(archive.entries).toContain(`tables/${table}.jsonl.gz`);
    }
    expect(archive.rows('artifact').map((each) => each['kind'])).toEqual(
      expect.arrayContaining(['component', 'asset']),
    );
  });

  it('IMP-020 says in the archive what it leaves out and what is rebuilt, each with why', async () => {
    const { manifest } = readArchive((await writeExport()).bytes);
    for (const [name, table] of Object.entries(EXPORT_TABLES)) {
      if (table.fate === 'carried') continue;
      expect((manifest[table.fate] as Record<string, string>)[name], name).toBe(table.why);
    }
  });

  it('IMP-020 names an object the store has lost, rather than refusing to export', async () => {
    const png = await sharp({
      create: { width: 5, height: 5, channels: 3, background: { r: 10, g: 40, b: 200 } },
    })
      .png()
      .toBuffer();
    const lost = await store.put(png, 'application/octet-stream');
    await service.withTenant(tenant, async (trx) => {
      const made = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: { text: 'A blue square', language: 'en-GB' },
      });
      await receiveAssetBytes(trx, made.id, { key: lost.key, format: 'png', bytes: lost.size });
    });
    await work();
    const sha256 = lost.sha256;
    await store.remove(lost.key);
    const { manifest, entries } = readArchive((await writeExport()).bytes);
    expect((manifest['objects'] as { missing: string[] }).missing).toContain(sha256);
    expect(entries).not.toContain(`objects/${sha256}`);
  });

  it('ADM-054 carries a reference to each secret and never a sealed value', async () => {
    await service.withTenant(tenant, async (trx) => {
      await sql`insert into identity_provider (issuer, client_id, name, sealed_secret)
        values ('https://idp.example/secret', 'client', 'Secret idp', ${MARKER})`.execute(trx);
      const { rows: identity } = await sql<{ id: string }>`
        insert into principal (kind, display_name)
        values ('service', 'Hook') returning id`.execute(trx);
      await sql`insert into service_identity (principal_id, created_by)
        values (${identity[0]!.id}, ${ada})`.execute(trx);
      await sql`insert into webhook_subscription
          (service_identity, url, event_types, sealed, sealed_previous, previous_until, created_by)
        values (${identity[0]!.id}, 'https://hook.example/', '{content.version_cut}', ${MARKER}, ${MARKER},
                now() + interval '1 day', ${ada})`.execute(trx);
      await sql`insert into extension (id, url, installed_by)
        values (gen_random_uuid(), 'https://ext.example/', ${ada})`.execute(trx);
      await sql`insert into extension_credential (id, extension_id, sealed, endpoint, set_by)
        select gen_random_uuid(), id, ${MARKER}, 'https://ext.example/', ${ada}
          from extension`.execute(trx);
      await sql`insert into model_endpoint (name, protocol, base_url, model, context_window,
          price_in_micros, price_out_micros, currency, boundary, made_by)
        values ('Marked', 'openai', 'https://model.example/', 'm', 2000, 0, 0, 'GBP', 'inside',
                ${ada})`.execute(trx);
      await sql`insert into model_credential (endpoint_id, sealed, sealed_for, set_by)
        select id, ${MARKER}, ${MARKER}, ${ada} from model_endpoint`.execute(trx);
      const connection = await createConnection(trx, {
        author: ada,
        spaceId: general,
        settings: {
          schemaVersion: 1,
          name: 'Gauges',
          description: '',
          type: 'postgres',
          source: {
            host: 'unreachable.invalid',
            port: 5432,
            database: 'gauges',
            account: 'reader',
            tls: 'require',
          },
          identity: { kind: 'service' },
          retired: false,
        },
      });
      if (connection.answer !== 'created') throw new Error(connection.answer);
      await sql`insert into connection_credential (connection_id, sealed, set_by)
        values (${connection.connection.id}, ${MARKER}, ${ada})`.execute(trx);
    });
    const { bytes } = await writeExport();
    const archive = readArchive(bytes);
    const kinds = archive.secrets.map((each) => each['kind']);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'connection',
        'identity_provider',
        'webhook',
        'extension',
        'model_endpoint',
      ]),
    );
    expect(archive.secrets.map((each) => each['reference'])).toContain(
      `identity_provider:${String(
        archive.rows('identity_provider').find((each) => each['name'] === 'Secret idp')?.['id'],
      )}`,
    );
    // Searched in the clear: the tables are gzipped, so each is opened first.
    expect(bytes.includes('SEALEDMARKER')).toBe(false);
    for (const name of archive.entries.filter((each) => each.startsWith('tables/'))) {
      const table = name.slice('tables/'.length, -'.jsonl.gz'.length);
      expect(JSON.stringify(archive.rows(table)), table).not.toContain('SEALEDMARKER');
    }
    expect(archive.rows('webhook_subscription')[0]).not.toHaveProperty('sealed');
  });

  it('takes one cut: what is written while it runs is wholly out, and no row names one it lacks', async () => {
    let written = '';
    const seen = new Map<string, string[]>();
    await worker.withTenant(
      tenant,
      (trx) =>
        readExportCut(trx, async (table, lines) => {
          seen.set(table, [...(seen.get(table) ?? []), ...lines]);
          // Committed after `artifact` is read and before `artifact_version` is: pages of separate
          // transactions would hold this version without its artifact.
          if (table === 'artifact' && written === '') {
            const made = await service.withTenant(tenant, (other) =>
              createComponent(other, {
                spaceId: general,
                title: 'Written during the export',
                language: 'en-GB',
                direction: 'ltr',
                author: ada,
              }),
            );
            if (made.answer !== 'created') throw new Error(made.answer);
            written = made.version.artifactId;
          }
        }),
      undefined,
      { isolation: 'repeatable read', readOnly: true },
    );
    expect(written).not.toBe('');
    const ids = (table: string, column: string) =>
      (seen.get(table) ?? []).map((line) => (JSON.parse(line) as Record<string, string>)[column]);
    expect(ids('artifact', 'id')).not.toContain(written);
    expect(ids('artifact_version', 'artifact_id')).not.toContain(written);
    const artifacts = new Set(ids('artifact', 'id'));
    expect(ids('artifact_version', 'artifact_id').filter((id) => !artifacts.has(id))).toEqual([]);
  });

  it('API-044 keeps a written export seven days, then removes its archive and keeps its row', async () => {
    const asked = await service.withTenant(tenant, (trx) => requestTenantExport(trx, ada));
    await work();
    const written = (await service.withTenant(tenant, (trx) => readTenantExport(trx, asked.id)))!;
    const at = (days: number) => new Date(written.finishedAt!.getTime() + days * 86_400_000);
    const read = () => service.withTenant(tenant, (trx) => readTenantExport(trx, asked.id));
    await sweepExpiredTenantExports(worker, stores, quiet, at(6));
    expect(await read()).toMatchObject({ state: 'done', key: written.key });

    // A removal that fails leaves the export named, to be swept again.
    const failing: ObjectStores = {
      forTenant: async (trx, of) => ({
        ...(await stores.forTenant(trx, of)),
        remove: () => Promise.reject(new Error('The store is unreachable')),
      }),
    };
    await sweepExpiredTenantExports(worker, failing, quiet, at(8));
    expect(await read()).toMatchObject({ state: 'done', key: written.key });

    await sweepExpiredTenantExports(worker, stores, quiet, at(8));
    expect(await read()).toMatchObject({ state: 'expired', key: null, sha256: written.sha256 });
    await expect(store.get(written.key!)).rejects.toThrow();
  });
});
