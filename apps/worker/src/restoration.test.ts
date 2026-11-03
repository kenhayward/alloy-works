import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  answerRestoration,
  beginRestoration,
  carriedTables,
  createComponent,
  createDocument,
  createJobQueue,
  createRestoration,
  createRestorerDatabase,
  createServiceIdentity,
  createTenant,
  createWebhookSubscription,
  editOutline,
  endRestoreReview,
  migrate,
  prepareDatabase,
  readRestoration,
  readTenantExport,
  receiveAssetBytes,
  createAssetUpload,
  receiveRestorationArchive,
  recordEvent,
  requestTenantExport,
  restoreReview,
  restoreUnderReview,
  tenantIsEmpty,
  webhookHasSecret,
  type JobQueue,
  type RestorerDatabase,
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
import { restorationJob } from './jobs/restoration.js';
import { tenantExportJob } from './jobs/tenant-export.js';
import { tarWriter } from './tar.js';
import * as sweeps from './sweep.js';
import { SWEEPS_UNDER_REVIEW, sweepOldNotifications, sweepRestorations } from './sweep.js';
import { processNext, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
const MARKER = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.SEALEDMARKER';

describe('a tenant restored from its export (the EI plan, EIc)', () => {
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
  let general = '';
  let part = '';
  let png: Buffer;
  let archive: Buffer;
  let eventCount = 0;

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
  /** The one person in a fresh tenant: who signed in to restore it. */
  const signInAs = (tenant: Tenant, subject = 'grace') =>
    service.withTenant(tenant, async (trx) => {
      const made = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject,
          email: null,
          display_name: subject,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return made.id;
    });
  const handlers = () => ({
    ingest: ingestJob({ db: worker, stores }),
    tenant_export: tenantExportJob({ db: worker, stores }),
    restoration: restorationJob({ db: worker, restorer, stores }),
  });
  /** Every job the queue will give: tenants share it, and earlier tests leave embedding to do. */
  const work = async () => {
    for (;;) {
      const outcome = await processNext({
        queue,
        db: worker,
        handlers: handlers(),
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
  const answered = async (tenant: Tenant, id: string) => {
    const read = (await service.withTenant(tenant, (trx) => readRestoration(trx, id)))!;
    await service.withTenant(tenant, async (trx) => {
      await answerRestoration(trx, id, {
        issuers: Object.fromEntries((read.plan?.issuers ?? []).map((each) => [each.issuer, null])),
        switchedOff: (read.plan?.secrets ?? []).map((each) => each.reference),
      });
      await beginRestoration(trx, id);
    });
    await work();
    return (await service.withTenant(tenant, (trx) => readRestoration(trx, id)))!;
  };

  /** The archive with one entry replaced, as an administrator with a text editor might. */
  const forged = (change: (name: string, content: Buffer) => Buffer | undefined) => {
    const entries: [string, Buffer][] = [];
    let at = 0;
    while (at + 512 <= archive.length) {
      const name = archive.toString('utf8', at, at + 100).replace(/\0.*$/s, '');
      if (name === '') break;
      const size = parseInt(archive.toString('utf8', at + 124, at + 135), 8);
      const content = Buffer.from(archive.subarray(at + 512, at + 512 + size));
      entries.push([name, change(name, content) ?? content]);
      at += 512 + Math.ceil(size / 512) * 512;
    }
    const folder = mkdtempSync(join(tmpdir(), 'aw-forged-'));
    const path = join(folder, 'forged.tar');
    const fd = openSync(path, 'w');
    const tar = tarWriter(fd);
    for (const [name, content] of entries) tar.bytes(name, content);
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
      sourceStore = await stores.forTenant(trx, source);
    });
    part = await service.withTenant(source, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Pump care',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });
    const document = await service.withTenant(source, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    await service.withTenant(source, async (trx) => {
      const placed = await editOutline(trx, {
        artifactId: document.artifactId,
        openedFrom: document.id,
        author: ada,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component: part, mode: { kind: 'latest' } },
        } as never,
      });
      if (placed.answer !== 'recorded') throw new Error(placed.answer);
    });
    png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const kept = await sourceStore.put(png, 'application/octet-stream');
    await service.withTenant(source, async (trx) => {
      const made = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: { text: 'A red square', language: 'en-GB' },
      });
      await receiveAssetBytes(trx, made.id, { key: kept.key, format: 'png', bytes: kept.size });
    });
    await work();
    await service.withTenant(source, async (trx) => {
      for (let each = 0; each < 3; each += 1) {
        await recordEvent(trx, {
          kind: 'export.downloaded',
          subject: { kind: 'tenant_export', id: part },
          detail: { export: part, of: 'tenant' },
        });
      }
      await sql`insert into model_endpoint (name, protocol, base_url, model, context_window,
          price_in_micros, price_out_micros, currency, boundary, made_by)
        values ('Marked', 'openai', 'https://model.example/', 'm', 2000, 0, 0, 'GBP', 'inside',
                ${ada})`.execute(trx);
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
      await sql`insert into model_credential (endpoint_id, sealed, sealed_for, set_by)
        select id, ${MARKER}, ${MARKER}, ${ada} from model_endpoint`.execute(trx);
      eventCount = (
        await sql<{ n: number }>`select count(*)::int as n from audit_event`.execute(trx)
      ).rows[0]!.n;
    });
    const asked = await service.withTenant(source, (trx) => requestTenantExport(trx, ada));
    await work();
    const written = (await service.withTenant(source, (trx) => readTenantExport(trx, asked.id)))!;
    expect(written.state).toBe('done');
    archive = await sourceStore.get(written.key!);
  }, 240_000);

  afterAll(async () => {
    await queue?.close();
    await restorer?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('IMP-039 IMP-052 restores a whole tenant into an empty one, every version and its audit log as they were', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    await service.withTenant(
      target,
      (trx) =>
        recordEvent(trx, {
          kind: 'export.downloaded',
          subject: { kind: 'tenant_export', id: grace },
          detail: { export: grace, of: 'tenant' },
        }),
      { actorKind: 'person', actor: grace },
    );
    const { id, read } = await uploaded(target, grace, archive);
    const plan = (await read())!;
    expect(plan.state, JSON.stringify(plan.refusal)).toBe('previewed');
    expect(plan.plan!.issuers).toContainEqual({ issuer: 'https://idp.example', people: 1 });
    expect(plan.plan!.secrets.map((each) => each.kind)).toContain('model_endpoint');
    expect(plan.plan!.tables['artifact']).toBeGreaterThan(5);

    const done = await answered(target, id);
    expect(done.state, JSON.stringify(done.refusal)).toBe('restored');

    const compare = async (tenant: Tenant) =>
      service.withTenant(tenant, async (trx) => {
        const counts: Record<string, number> = {};
        for (const [table] of carriedTables()) {
          const { rows } = await sql<{ n: number }>`
            select count(*)::int as n from ${sql.id(table)}`.execute(trx);
          counts[table] = rows[0]!.n;
        }
        const { rows: digests } = await sql<{ id: string; version_digest: string }>`
          select id, version_digest from artifact_version order by id`.execute(trx);
        return { counts, digests };
      });
    const before = await compare(source);
    const after = await compare(target);
    expect(after.digests).toEqual(before.digests);
    // What it holds, but for what its own arrival added: the restorer, and the three credentials.
    for (const [table, rows] of Object.entries(before.counts)) {
      if (
        [
          'audit_event',
          'audit_label',
          'audit_restored',
          'model_credential',
          'principal',
          'access_grant',
        ].includes(table)
      ) {
        continue;
      }
      expect(after.counts[table], table).toBe(rows);
    }
  });

  it('IMP-052 brings the log back in order, renumbered, marked and at its original instants', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id } = await uploaded(target, grace, archive);
    expect((await answered(target, id)).state).toBe('restored');
    const log = await service.withTenant(target, async (trx) => {
      const { rows } = await sql<{
        sequence: string;
        at: Date;
        kind: string;
        original_sequence: string | null;
      }>`
        select e.sequence::text, e.at, e.kind, r.original_sequence::text
          from audit_event e left join audit_restored r on r.sequence = e.sequence
         order by e.sequence`.execute(trx);
      return rows;
    });
    const original = await service.withTenant(source, async (trx) => {
      const { rows } = await sql<{ sequence: string; at: Date }>`
        select sequence::text, at from audit_event order by audit_event.sequence limit ${eventCount}`.execute(
        trx,
      );
      return rows;
    });
    const restored = log.filter((row) => row.original_sequence !== null);
    expect(restored.length).toBeGreaterThanOrEqual(eventCount);
    expect(restored.slice(0, eventCount).map((row) => row.original_sequence)).toEqual(
      original.map((row) => row.sequence),
    );
    expect(restored.slice(0, eventCount).map((row) => row.at)).toEqual(
      original.map((row) => row.at),
    );
    expect(log.at(-1)?.kind).toBe('import.restored');
  });

  it('IMP-052 refuses a whole archive for a tenant in use, before asking about any secret', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    await signInAs(target, 'somebody-else');
    const { read } = await uploaded(target, grace, archive);
    expect(await read()).toMatchObject({
      state: 'refused',
      plan: null,
      refusal: { code: 'tenant_not_empty' },
    });
  });

  it('counts a tenant as empty despite the restorer, the vendor and a stranger, but not after a real act', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const empty = () => service.withTenant(target, (trx) => tenantIsEmpty(trx, grace));
    expect(await empty()).toBe('empty');
    await service.withTenant(
      target,
      (trx) =>
        recordEvent(trx, {
          kind: 'export.downloaded',
          subject: { kind: 'tenant_export', id: grace },
          detail: { export: grace, of: 'tenant' },
        }),
      { actorKind: 'system' },
    );
    expect(await empty()).toBe('empty');
    await service.withTenant(target, async (trx) => {
      const space = await trx.selectFrom('space').select('id').executeTakeFirstOrThrow();
      const made = await createComponent(trx, {
        spaceId: space.id,
        title: 'A real act',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      expect(made.answer).toBe('created');
    });
    expect(await empty()).not.toBe('empty');
  });

  it('refuses a second restore', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const first = await uploaded(target, grace, archive);
    expect((await answered(target, first.id)).state).toBe('restored');
    const second = await uploaded(target, grace, archive);
    expect(await second.read()).toMatchObject({ state: 'refused' });
  });

  it('ADM-054 arrives with a secret switched off: no credential, off, and never a sealed value', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id } = await uploaded(target, grace, archive);
    expect((await answered(target, id)).state).toBe('restored');
    await service.withTenant(target, async (trx) => {
      const { rows: endpoints } = await sql<{ name: string }>`
        select name from model_endpoint`.execute(trx);
      expect(endpoints.map((each) => each.name)).toContain('Marked');
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from model_credential`.execute(trx);
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('ADM-054 brings a webhook back off, with no secret, so it cannot send and cannot be turned on', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id } = await uploaded(target, grace, archive);
    expect((await answered(target, id)).state).toBe('restored');
    await service.withTenant(target, async (trx) => {
      const { rows } = await sql<{
        sealed: string | null;
        disabled_at: Date | null;
        disabled_reason: string | null;
      }>`select sealed, disabled_at, disabled_reason from webhook_subscription`.execute(trx);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sealed: null, disabled_reason: 'restored' });
      expect(rows[0]!.disabled_at).not.toBeNull();
      expect(await webhookHasSecret(trx, '00000000-0000-4000-8000-00000000abcd')).toBe(false);
    });
  });

  it('IMP-046 refuses to restore a person into their archive without the right to administer it', async () => {
    const target = await newTenant();
    const fresh = await signInAs(target, 'ada');
    await service.withTenant(source, (trx) =>
      trx.deleteFrom('access_grant').where('principal_id', '=', ada).execute(),
    );
    const again = await service.withTenant(source, (trx) => requestTenantExport(trx, ada));
    await work();
    const written = (await service.withTenant(source, (trx) => readTenantExport(trx, again.id)))!;
    const unprivileged = await sourceStore.get(written.key!);
    await service.withTenant(source, async (trx) => {
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
    });
    const { id } = await uploaded(target, fresh, unprivileged);
    expect(await answered(target, id)).toMatchObject({
      state: 'refused',
      refusal: { code: 'restorer_would_not_administer' },
    });
    // Nothing happened: the fresh person is as they were, able to try another archive.
    await service.withTenant(target, async (trx) => {
      const self = await trx
        .selectFrom('principal')
        .select(['subject', 'disabled_at'])
        .where('id', '=', fresh)
        .executeTakeFirstOrThrow();
      expect(self).toEqual({ subject: 'ada', disabled_at: null });
    });
  });

  it('IMP-046 says when two providers mapped to one would make two people one', async () => {
    const collide = forged((name, content) => {
      if (name !== 'tables/principal.jsonl.gz' && name !== 'manifest.json') return undefined;
      if (name === 'manifest.json') {
        const manifest = JSON.parse(content.toString()) as {
          tables: Record<string, { rows: number; bytes: number }>;
        };
        manifest.tables['principal']!.rows += 1;
        manifest.tables['principal']!.bytes += 4000;
        return Buffer.from(JSON.stringify(manifest));
      }
      const rows = rowsIn(content);
      const twin = {
        ...rows.find((row) => row['subject'] === 'ada')!,
        id: '00000000-0000-4000-8000-00000000dddd',
        issuer: 'https://other.example',
      };
      return rezip([...rows, twin]);
    });
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id, read } = await uploaded(target, grace, collide);
    const plan = (await read())!.plan!;
    await service.withTenant(target, async (trx) => {
      await answerRestoration(trx, id, {
        issuers: {
          'https://idp.example': 'https://one.example',
          'https://other.example': 'https://one.example',
        },
        switchedOff: plan.secrets.map((each) => each.reference),
      });
      await beginRestoration(trx, id);
    });
    await work();
    expect(await read()).toMatchObject({
      state: 'refused',
      refusal: { code: 'issuer_mapping_collides' },
    });
  });

  it('IMP-046 keeps the actor when an issuer is mapped, and the person signs in by the new one', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id, read } = await uploaded(target, grace, archive);
    const plan = (await read())!.plan!;
    await service.withTenant(target, async (trx) => {
      await answerRestoration(trx, id, {
        issuers: Object.fromEntries(
          plan.issuers.map((each) => [each.issuer, 'https://elsewhere.example']),
        ),
        switchedOff: plan.secrets.map((each) => each.reference),
      });
      await beginRestoration(trx, id);
    });
    await work();
    expect(await read()).toMatchObject({ state: 'restored' });
    await service.withTenant(target, async (trx) => {
      const person = await trx
        .selectFrom('principal')
        .select(['issuer', 'subject'])
        .where('id', '=', ada)
        .executeTakeFirstOrThrow();
      expect(person).toEqual({ issuer: 'https://elsewhere.example', subject: 'ada' });
      // Their acts are still theirs.
      const { rows } = await sql<{ author: string }>`
        select author_id as author from artifact_version where artifact_id = ${part} limit 1`.execute(
        trx,
      );
      expect(rows[0]!.author).toBe(ada);
    });
  });

  it('IMP-046 lets the restored person win where the restorer is in the archive, the fresh one giving way', async () => {
    const target = await newTenant();
    const fresh = await signInAs(target, 'ada');
    const { id } = await uploaded(target, fresh, archive);
    expect((await answered(target, id)).state).toBe('restored');
    await service.withTenant(target, async (trx) => {
      const held = await trx
        .selectFrom('principal')
        .select(['id', 'subject', 'disabled_at'])
        .where('issuer', '=', 'https://idp.example')
        .execute();
      expect(held.find((each) => each.subject === 'ada')?.id).toBe(ada);
      const self = held.find((each) => each.id === fresh)!;
      expect(self.subject).not.toBe('ada');
      expect(self.disabled_at).not.toBeNull();
    });
  });

  it('IMP-039 AST-030 opens an image from the new tenant store, its content still naming the old prefix', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id } = await uploaded(target, grace, archive);
    expect((await answered(target, id)).state).toBe('restored');
    const store = await service.withTenant(target, (trx) => stores.forTenant(trx, target));
    const key = await service.withTenant(target, async (trx) => {
      const { rows } = await sql<{ key: string }>`
        select content->>'object' as key from artifact_version
         where kind = 'asset' limit 1`.execute(trx);
      return rows[0]!.key;
    });
    expect(key.startsWith(`${source.schema}`) || key.includes(source.id)).toBe(true);
    expect(await store.get(key)).toEqual(png);
  });

  it('another tenant bytes stay out of reach by any key, restored content included', async () => {
    const target = await newTenant();
    const store = await service.withTenant(target, (trx) => stores.forTenant(trx, target));
    const only = await sourceStore.put(Buffer.from('only at the source'), 'text/plain');
    await expect(store.get(only.key)).rejects.toThrow();
    expect((await sourceStore.get(only.key)).toString()).toBe('only at the source');
  });

  it('EI-M holds the sweeps until the review ends, and a restored subscription sends nothing', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id } = await uploaded(target, grace, archive);
    expect((await answered(target, id)).state).toBe('restored');
    const held = () => service.withTenant(target, (trx) => restoreUnderReview(trx));
    expect(await held()).toBe(true);
    // Every held sweep leaves it alone, seen by what the iteration sweep would remove here.
    const iterationCountBefore = await service.withTenant(target, async (trx) => {
      await sql`insert into notification (recipient, kind, at, counts)
        values (${grace}, 'digest', now() - interval '200 days', '{}'::jsonb)`.execute(trx);
      return (await sql<{ n: number }>`select count(*)::int as n from notification`.execute(trx))
        .rows[0]!.n;
    });
    await sweepOldNotifications(worker, quiet);
    expect(
      await service.withTenant(
        target,
        async (trx) =>
          (await sql<{ n: number }>`select count(*)::int as n from notification`.execute(trx))
            .rows[0]!.n,
      ),
    ).toBe(iterationCountBefore);
    expect(await service.withTenant(target, (trx) => restoreReview(trx))).toMatchObject({
      underReview: true,
    });
    expect(await service.withTenant(target, (trx) => endRestoreReview(trx, grace))).toBe(id);
    expect(await held()).toBe(false);
    expect(await service.withTenant(target, (trx) => endRestoreReview(trx, grace))).toBeUndefined();
    await sweepOldNotifications(worker, quiet);
    expect(
      await service.withTenant(
        target,
        async (trx) =>
          (await sql<{ n: number }>`select count(*)::int as n from notification`.execute(trx))
            .rows[0]!.n,
      ),
    ).toBe(iterationCountBefore - 1);
  });

  it('IMP-044 removes an uploaded archive after its seven days, and says when a job gave up', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id, read } = await uploaded(target, grace, archive);
    const key = (await read())!.objectKey!;
    const store = await service.withTenant(target, (trx) => stores.forTenant(trx, target));
    const sweeping = (now: Date) => sweepRestorations(worker, stores, queue, quiet, now);
    await sweeping(new Date(Date.now() + 86_400_000));
    expect((await read())!.objectKey).toBe(key);
    await sweeping(new Date(Date.now() + 8 * 86_400_000));
    expect((await read())!.objectKey).toBeNull();
    await expect(store.get(key)).rejects.toThrow();

    await service.withTenant(target, async (trx) => {
      await sql`update restoration set state = 'applying' where id = ${id}`.execute(trx);
    });
    const gaveUp = { givenUp: async () => new Map([[id, 1]]) };
    await sweepRestorations(worker, stores, gaveUp, quiet);
    expect(await read()).toMatchObject({ state: 'failed', refusal: { code: 'restore_failed' } });
  });

  it('every sweep says whether a restore holds it', () => {
    const named = [...SWEEPS_UNDER_REVIEW.held, ...SWEEPS_UNDER_REVIEW.running].sort();
    const exported = Object.keys(sweeps)
      .filter((name) => /^(sweep|fold)[A-Z]/.test(name))
      .sort();
    expect(named).toEqual(exported);
  });

  describe('a forged archive is refused, and nothing changes', () => {
    const refused = async (bytes: Buffer, code = 'export_invalid') => {
      const target = await newTenant();
      const grace = await signInAs(target);
      const { read } = await uploaded(target, grace, bytes);
      expect(await read()).toMatchObject({ state: 'refused', refusal: { code } });
    };

    it('a changed version', async () => {
      await refused(
        forged((name, content) => {
          if (name !== 'tables/artifact_version.jsonl.gz') return undefined;
          return rezip(
            rowsIn(content).map((row) =>
              row['artifact_id'] === part ? { ...row, version_digest: '0'.repeat(64) } : row,
            ),
          );
        }),
      );
    });

    it('AST-030 an object not matching its hash', async () => {
      await refused(
        forged((name) => (name.startsWith('objects/') ? Buffer.from('not the image') : undefined)),
      );
    });

    it('a path out of the folder', async () => {
      const tampered = Buffer.from(archive);
      // The first entry's name, its checksum put right, so only the name is wrong.
      tampered.fill(0, 0, 100);
      tampered.write('../manifest.json', 0);
      tampered.fill(' ', 148, 156);
      const sum = tampered.subarray(0, 512).reduce((total, byte) => total + byte, 0);
      tampered.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
      await refused(tampered);
    });

    it('a table larger than its manifest says', async () => {
      await refused(
        forged((name, content) => {
          if (name !== 'manifest.json') return undefined;
          const manifest = JSON.parse(content.toString()) as {
            tables: Record<string, { bytes: number }>;
          };
          manifest.tables['role']!.bytes = 1;
          return Buffer.from(JSON.stringify(manifest));
        }),
      );
    });

    it('a script in content, its digests made to match', async () => {
      await refused(
        forged((name, content) => {
          if (name !== 'tables/artifact_version.jsonl.gz') return undefined;
          return rezip(
            rowsIn(content).map((row) =>
              row['artifact_id'] === part && row['kind'] === 'component'
                ? {
                    ...row,
                    content: {
                      ...(row['content'] as object),
                      blocks: [{ type: 'script', text: 'alert(1)' }],
                    },
                  }
                : row,
            ),
          );
        }),
      );
    });

    it('a column this schema does not have', async () => {
      await refused(
        forged((name, content) => {
          if (name !== 'schema.json') return undefined;
          const schema = JSON.parse(content.toString()) as {
            tables: Record<string, { columns: { name: string }[] }>;
          };
          schema.tables['role']!.columns.push({ name: 'smuggled' });
          return Buffer.from(JSON.stringify(schema));
        }),
      );
    });

    it('a secret in the rows', async () => {
      await refused(
        forged((name, content) => {
          if (name !== 'schema.json') return undefined;
          const schema = JSON.parse(content.toString()) as {
            tables: Record<string, { columns: { name: string }[] }>;
          };
          schema.tables['webhook_subscription']!.columns.push({ name: 'sealed' });
          return Buffer.from(JSON.stringify(schema));
        }),
      );
    });

    it('a table that unpacks past what its manifest declares, stopped as it unpacks', async () => {
      await refused(
        forged((name, content) => {
          if (name === 'tables/role.jsonl.gz') {
            return gzipSync(Buffer.alloc(8 * 1024 * 1024, 'x'));
          }
          return name === 'manifest.json' ? content : undefined;
        }),
      );
    });

    it('a format newer than this release', async () => {
      await refused(
        forged((name, content) => {
          if (name !== 'manifest.json') return undefined;
          return Buffer.from(
            JSON.stringify({ ...(JSON.parse(content.toString()) as object), format: 99 }),
          );
        }),
        'export_format_newer',
      );
    });
  });

  it('IMP-042 leaves nothing of an import that fails at its end', async () => {
    const target = await newTenant();
    const grace = await signInAs(target);
    const { id } = await uploaded(target, grace, archive);
    await service.withTenant(target, async (trx) => {
      const read = (await readRestoration(trx, id))!;
      await answerRestoration(trx, id, {
        issuers: Object.fromEntries((read.plan?.issuers ?? []).map((each) => [each.issuer, null])),
        switchedOff: (read.plan?.secrets ?? []).map((each) => each.reference),
      });
      await beginRestoration(trx, id);
    });
    // Someone arrives between the preview and the job: the job finds it no longer empty.
    await signInAs(target, 'late');
    await work();
    const after = await service.withTenant(target, async (trx) => ({
      read: await readRestoration(trx, id),
      component: await trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'component')
        .execute(),
    }));
    expect(after.read).toMatchObject({ state: 'refused', refusal: { code: 'tenant_not_empty' } });
    expect(after.component).toEqual([]);
  });
});
