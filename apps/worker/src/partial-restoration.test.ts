import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  answerRestoration,
  beginRestoration,
  createComponent,
  createServiceIdentity,
  createWebhookSubscription,
  createJobQueue,
  createRestoration,
  createRestorerDatabase,
  createTenant,
  migrate,
  prepareDatabase,
  readRestoration,
  readTenantExport,
  receiveRestorationArchive,
  requestTenantExport,
  type JobQueue,
  type RestorerDatabase,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restorationJob } from './jobs/restoration.js';
import { tenantExportJob } from './jobs/tenant-export.js';
import { tarWriter } from './tar.js';
import { processNext, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
const MARKER = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.SEALEDMARKER';

describe('a part of a tenant imported into one in use (the EI plan, EId)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let restorer: RestorerDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let source: Tenant;
  let sourceStore: TenantStore;
  let ada = '';
  let space = '';
  let part = '';
  let archive: Buffer;
  let configuration: Buffer;

  const newTenant = async () => {
    const id = db.newTenantId();
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: id },
      hostnames: [`${id}.acme.alloy.test`],
    });
    await objects.setUp(db.adminUrl, tenant);
    return tenant;
  };
  const signInAs = (tenant: Tenant, subject: string) =>
    service.withTenant(tenant, async (trx) => {
      const made = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject, email: null, display_name: subject })
        .returning('id')
        .executeTakeFirstOrThrow();
      return made.id;
    });
  const work = async () => {
    for (;;) {
      const outcome = await processNext({
        queue,
        db: worker,
        handlers: {
          tenant_export: tenantExportJob({ db: worker, stores }),
          restoration: restorationJob({ db: worker, restorer, stores }),
        },
        workerId: 'worker-1',
        leaseMs: 60_000,
        log: quiet,
      });
      if (outcome === 'idle') return;
    }
  };
  const uploaded = async (tenant: Tenant, by: string, bytes: Buffer) => {
    const store = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const kept = await store.put(bytes, 'application/x-tar');
    const id = await service.withTenant(tenant, async (trx) => {
      const made = await createRestoration(trx, by);
      await receiveRestorationArchive(trx, made.id, kept);
      return made.id;
    });
    await work();
    return {
      id,
      read: () => service.withTenant(tenant, (trx) => readRestoration(trx, id)),
    };
  };
  const applied = async (tenant: Tenant, id: string) => {
    await service.withTenant(tenant, async (trx) => {
      const held = (await readRestoration(trx, id))!;
      await answerRestoration(trx, id, {
        issuers: Object.fromEntries((held.plan?.issuers ?? []).map((each) => [each.issuer, null])),
        switchedOff: (held.plan?.secrets ?? []).map((each) => each.reference),
      });
      await beginRestoration(trx, id);
    });
    await work();
    return (await service.withTenant(tenant, (trx) => readRestoration(trx, id)))!;
  };
  const exported = async (scope: { scope: 'space' | 'configuration'; id: string | null }) => {
    const asked = await service.withTenant(source, (trx) =>
      requestTenantExport(trx, ada, { ...scope, followReferences: false }),
    );
    await work();
    const written = (await service.withTenant(source, (trx) => readTenantExport(trx, asked.id)))!;
    expect(written.state).toBe('done');
    return sourceStore.get(written.key!);
  };
  /** The archive with entries changed, as an administrator with a text editor might. */
  const forged = (
    from: Buffer,
    change: (name: string, content: Buffer) => Buffer | undefined,
    extra: readonly (readonly [string, Buffer])[] = [],
  ) => {
    const entries: [string, Buffer][] = [];
    let at = 0;
    while (at + 512 <= from.length) {
      const name = from.toString('utf8', at, at + 100).replace(/\0.*$/s, '');
      if (name === '') break;
      const size = parseInt(from.toString('utf8', at + 124, at + 135), 8);
      const content = Buffer.from(from.subarray(at + 512, at + 512 + size));
      entries.push([name, change(name, content) ?? content]);
      at += 512 + Math.ceil(size / 512) * 512;
    }
    const folder = mkdtempSync(join(tmpdir(), 'aw-forged-'));
    const path = join(folder, 'forged.tar');
    const fd = openSync(path, 'w');
    const tar = tarWriter(fd);
    for (const [name, content] of [...entries, ...extra]) tar.bytes(name, content);
    tar.end();
    closeSync(fd);
    const bytes = readFileSync(path);
    rmSync(folder, { recursive: true, force: true });
    return bytes;
  };
  const rowsIn = (content: Buffer) =>
    gunzipSync(content)
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  const rezip = (rows: readonly Record<string, unknown>[]) =>
    gzipSync(rows.map((row) => `${JSON.stringify(row)}\n`).join(''));

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    source = await newTenant();
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    restorer = createRestorerDatabase(db.restorerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    ada = await signInAs(source, 'ada');
    await service.withTenant(source, async (trx) => {
      sourceStore = await stores.forTenant(trx, source);
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
      const made = await trx
        .insertInto('space')
        .values({ name: 'Pumps' })
        .returning('id')
        .executeTakeFirstOrThrow();
      space = made.id;
      const component = await createComponent(trx, {
        spaceId: space,
        title: 'Pump care',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (component.answer !== 'created') throw new Error(component.answer);
      part = component.version.artifactId;
    });
    await service.withTenant(source, async (trx) => {
      await sql`insert into model_endpoint (name, protocol, base_url, model, context_window,
          price_in_micros, price_out_micros, currency, boundary, made_by)
        values ('Marked', 'openai', 'https://model.example/', 'm', 2000, 0, 0, 'GBP', 'inside',
                ${ada})`.execute(trx);
      await sql`insert into model_credential (endpoint_id, sealed, sealed_for, set_by)
        select id, ${MARKER}, ${MARKER}, ${ada} from model_endpoint`.execute(trx);
      const identity = await createServiceIdentity(trx, {
        name: 'Bridge',
        description: '',
        by: ada,
      });
      await createWebhookSubscription(trx, {
        id: '00000000-0000-4000-8000-00000000abcd',
        serviceIdentity: identity.id,
        url: 'https://hooks.example/in',
        description: '',
        eventTypes: ['content.version_cut'],
        sealed: MARKER,
        by: ada,
      });
    });
    archive = await exported({ scope: 'space', id: space });
    configuration = await exported({ scope: 'configuration', id: null });
  }, 240_000);

  afterAll(async () => {
    await queue?.close();
    await restorer?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('IMP-039 says what a part would do, changing nothing, and then brings it into a tenant in use', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const before = await service.withTenant(target, (trx) =>
      trx.selectFrom('artifact').select('id').execute(),
    );
    const { id, read } = await uploaded(target, grace, archive);
    const previewed = (await read())!;
    expect(previewed.state, JSON.stringify(previewed.refusal)).toBe('previewed');
    const would = previewed.plan!.would!;
    expect(would.added['artifact']).toBeGreaterThanOrEqual(1);
    expect(
      await service.withTenant(target, (trx) => trx.selectFrom('artifact').select('id').execute()),
    ).toEqual(before);

    const done = await applied(target, id);
    expect(done.state, JSON.stringify(done.refusal)).toBe('restored');
    expect(done.report).toEqual(would);

    await service.withTenant(target, async (trx) => {
      const version = await trx
        .selectFrom('artifact_version')
        .select(['version_digest', 'author_id'])
        .where('artifact_id', '=', part)
        .executeTakeFirstOrThrow();
      const original = await service.withTenant(source, (inner) =>
        inner
          .selectFrom('artifact_version')
          .select(['version_digest'])
          .where('artifact_id', '=', part)
          .executeTakeFirstOrThrow(),
      );
      expect(version.version_digest).toBe(original.version_digest);
      expect(version.author_id).toBe(ada);
      const spaces = await trx.selectFrom('space').select('name').execute();
      expect(spaces.map((each) => each.name)).toContain('Pumps');
    });
  });

  it('IMP-039 gives nobody access: an author arrives with no grants, and the writer keeps theirs', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const { id } = await uploaded(target, grace, archive);
    expect((await applied(target, id)).state).toBe('restored');
    await service.withTenant(target, async (trx) => {
      const grants = await trx
        .selectFrom('access_grant')
        .select('principal_id')
        .where('principal_id', '=', ada)
        .execute();
      expect(grants).toEqual([]);
    });
  });

  it('IMP-039 maps an author already here, by issuer and subject, keeping their history theirs', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const sameAda = await signInAs(target, 'ada');
    const { id } = await uploaded(target, grace, archive);
    expect((await applied(target, id)).state).toBe('restored');
    await service.withTenant(target, async (trx) => {
      const version = await trx
        .selectFrom('artifact_version')
        .select('author_id')
        .where('artifact_id', '=', part)
        .executeTakeFirstOrThrow();
      expect(version.author_id).toBe(sameAda);
    });
  });

  it('IMP-039 counts what is already here the second time, and adds nothing', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const first = await uploaded(target, grace, archive);
    const firstDone = await applied(target, first.id);
    expect(firstDone.state).toBe('restored');
    const count = () =>
      service.withTenant(target, async (trx) => {
        const counts: Record<string, number> = {};
        for (const table of Object.keys(firstDone.report!.added)) {
          const { rows } = await sql<{ n: number }>`
            select count(*)::int as n from ${sql.id(table)}`.execute(trx);
          counts[table] = rows[0]!.n;
        }
        return counts;
      });
    const before = await count();
    const second = await uploaded(target, grace, archive);
    const done = await applied(target, second.id);
    expect(done.state, JSON.stringify(done.refusal)).toBe('restored');
    expect(done.report!.added).toEqual({});
    expect(done.report!.already['artifact']).toBeGreaterThanOrEqual(1);
    expect(await count()).toEqual(before);
  });

  it('IMP-039 leaves a version here with other content and lists it, overwriting nothing', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const first = await uploaded(target, grace, archive);
    expect((await applied(target, first.id)).state).toBe('restored');
    await restorer.asOwner(target, async (trx) => {
      await sql`alter table artifact_version disable trigger user`.execute(trx);
      await sql`update artifact_version set version_digest = ${'0'.repeat(64)}
        where artifact_id = ${part}`.execute(trx);
      await sql`alter table artifact_version enable trigger user`.execute(trx);
    });
    const second = await uploaded(target, grace, archive);
    const done = await applied(target, second.id);
    expect(done.report!.conflictCount).toBeGreaterThanOrEqual(1);
    expect(done.report!.conflicts[0]!.table).toBe('artifact_version');
    await service.withTenant(target, async (trx) => {
      const { rows } = await sql<{ digest: string }>`
        select version_digest as digest from artifact_version where artifact_id = ${part}`.execute(
        trx,
      );
      expect(rows[0]!.digest).toBe('0'.repeat(64));
    });
  });

  it('IMP-039 keeps a definition as this tenant has it, beside the versions imported content names', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const latest = (trx: Parameters<Parameters<TenantDatabase['withTenant']>[1]>[0]) =>
      sql<{ artifact_id: string; content_hash: string }>`
        select distinct on (artifact_id) artifact_id, content_hash from artifact_version
         where kind in ('field', 'metadataSchema', 'componentType')
         order by artifact_id, revision_no desc, version_no desc`.execute(trx);
    await restorer.asOwner(target, async (trx) => {
      await sql`alter table artifact_version disable trigger user`.execute(trx);
      await sql`update artifact_version set content_hash = ${'1'.repeat(64)}
        where kind = 'componentType'`.execute(trx);
      await sql`alter table artifact_version enable trigger user`.execute(trx);
    });
    const before = (await service.withTenant(target, latest)).rows;
    const { id } = await uploaded(target, grace, archive);
    const done = await applied(target, id);
    expect(done.state, JSON.stringify(done.refusal)).toBe('restored');
    expect((await service.withTenant(target, latest)).rows).toEqual(before);
  });

  it('IMP-039 leaves this tenant its settings, and brings an endpoint and a webhook off', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const { id } = await uploaded(target, grace, configuration);
    const done = await applied(target, id);
    expect(done.state, JSON.stringify(done.refusal)).toBe('restored');
    expect(done.report!.settingsLeft).toContain('access_policy');
    await service.withTenant(target, async (trx) => {
      const endpoints = await sql<{ name: string }>`select name from model_endpoint`.execute(trx);
      expect(endpoints.rows.map((each) => each.name)).toEqual(['Marked']);
      const keys = await sql<{ n: number }>`
        select count(*)::int as n from model_credential`.execute(trx);
      expect(keys.rows[0]!.n).toBe(0);
      const hooks = await sql<{ sealed: string | null; disabled_reason: string | null }>`
        select sealed, disabled_reason from webhook_subscription`.execute(trx);
      expect(hooks.rows).toEqual([{ sealed: null, disabled_reason: 'restored' }]);
    });
  });

  it('turns every trigger back on afterwards', async () => {
    const target = await newTenant();
    const grace = await signInAs(target, 'grace');
    const { id } = await uploaded(target, grace, archive);
    expect((await applied(target, id)).state).toBe('restored');
    await service.withTenant(target, async (trx) => {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = current_schema() and not t.tgisinternal and t.tgenabled = 'D'`.execute(
        trx,
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  describe('a forged part is refused, and nothing changes', () => {
    const refused = async (bytes: Buffer, code = 'export_invalid', says?: RegExp) => {
      const target = await newTenant();
      const grace = await signInAs(target, 'grace');
      const { read } = await uploaded(target, grace, bytes);
      const seen = (await read())!;
      expect(seen).toMatchObject({ state: 'refused', refusal: { code } });
      if (says) expect(seen.refusal!.message).toMatch(says);
      const artifacts = await service.withTenant(target, (trx) =>
        trx.selectFrom('artifact').select('id').where('kind', '=', 'component').execute(),
      );
      expect(artifacts).toEqual([]);
    };
    const withTable = (name: string, rows: readonly Record<string, unknown>[], columns: string[]) =>
      added(`tables/${name}.jsonl.gz`, rezip(rows), name, rows, columns);
    const added = (
      path: string,
      file: Buffer,
      name: string,
      rows: readonly Record<string, unknown>[],
      columns: string[],
    ) =>
      forged(
        archive,
        (entry, content) => {
          // The table's file takes the place of a references list it would otherwise lack.
          if (entry === 'manifest.json') {
            const manifest = JSON.parse(content.toString()) as {
              tables: Record<string, unknown>;
            };
            manifest.tables[name] = {
              file: `tables/${name}.jsonl.gz`,
              rows: rows.length,
              bytes: 100_000,
            };
            return Buffer.from(JSON.stringify(manifest));
          }
          if (entry === 'schema.json') {
            const schema = JSON.parse(content.toString()) as {
              tables: Record<string, unknown>;
            };
            schema.tables[name] = { columns: columns.map((column) => ({ name: column })) };
            return Buffer.from(JSON.stringify(schema));
          }
          return undefined;
        },
        [[path, file]],
      );

    it('IMP-039 a part holding access', async () => {
      await refused(withTable('access_grant', [], ['id']), 'export_invalid', /cannot hold/);
    });

    it('IMP-052 a part holding the audit log', async () => {
      await refused(withTable('audit_event', [], ['sequence']), 'export_invalid', /cannot hold/);
    });

    it('IMP-042 a row no constraint would take, found by the preview', async () => {
      await refused(
        forged(configuration, (name, content) => {
          if (name !== 'tables/role.jsonl.gz') return undefined;
          return rezip(
            rowsIn(content).map((row, at) =>
              at === 0
                ? {
                    ...row,
                    id: '00000000-0000-4000-8000-00000000eeee',
                    name: 'Forged',
                    permissions: ['everything'],
                  }
                : row,
            ),
          );
        }),
      );
    });

    it('a scope it does not know', async () => {
      await refused(
        forged(archive, (name, content) =>
          name === 'manifest.json'
            ? Buffer.from(
                JSON.stringify({ ...(JSON.parse(content.toString()) as object), scope: 'other' }),
              )
            : undefined,
        ),
      );
    });
  });
});
