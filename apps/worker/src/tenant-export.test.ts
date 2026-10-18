import { createHash } from 'node:crypto';
import {
  createAssetUpload,
  createComponent,
  createJobQueue,
  createTenant,
  migrate,
  prepareDatabase,
  readAssetUpload,
  readTenantExport,
  receiveAssetBytes,
  requestTenantExport,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestJob } from './jobs/ingest.js';
import { LEFT_OUT, tenantExportJob } from './jobs/tenant-export.js';
import { sweepExpiredTenantExports } from './sweep.js';
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

  it("API-044 writes the tenant's content, versions and assets' bytes by hash into one archive, with a manifest of what it leaves out", async () => {
    // Content: a component, and an image admitted as an asset.
    await service.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Pump care',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
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

    const asked = await service.withTenant(tenant, (trx) => requestTenantExport(trx, ada));
    expect(asked.state).toBe('queued');
    await work();
    const written = (await service.withTenant(tenant, (trx) => readTenantExport(trx, asked.id)))!;
    expect(written.state).toBe('done');
    expect(written.expiresAt!.getTime() - written.finishedAt!.getTime()).toBe(7 * 86_400_000);

    const archive = await store.get(written.key!);
    expect(createHash('sha256').update(archive).digest('hex')).toBe(written.sha256);
    const files = unzipSync(new Uint8Array(archive));
    const lines = (name: string) =>
      strFromU8(files[name]!)
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    const artifacts = lines('artifacts.jsonl');
    expect(artifacts.map((each) => each['kind'])).toEqual(
      expect.arrayContaining(['component', 'asset']),
    );
    const versions = lines('versions.jsonl');
    expect(
      versions.some(
        (each) => (each['content'] as { title?: string } | null)?.title === 'Pump care',
      ),
    ).toBe(true);
    // The image's bytes, by their hash, once.
    expect(files[`objects/${kept.sha256}`]).toEqual(new Uint8Array(png));
    for (const part of ['relationships', 'baselines', 'publications']) {
      expect(files[`${part}.jsonl`], part).toBeDefined();
    }
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
      export: string;
      parts: Record<string, number>;
      objects: { count: number; missing: string[] };
      leftOut: string[];
    };
    expect(manifest).toMatchObject({
      export: asked.id,
      parts: { 'artifacts.jsonl': artifacts.length, 'versions.jsonl': versions.length },
      objects: { count: 1, missing: [] },
      leftOut: LEFT_OUT,
    });
    expect(written.counts).toMatchObject({ artifacts: artifacts.length, objects: 1 });
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
