import {
  createAssetUpload,
  createJobQueue,
  createTenant,
  discardDerivatives,
  migrate,
  prepareDatabase,
  readAssetUpload,
  readAssetVersion,
  readDerivative,
  receiveAssetBytes,
  wantDerivatives,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveJob } from './jobs/derive.js';
import { ingestJob } from './jobs/ingest.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

describe("the derive job, which makes an image's thumbnail and preview (the AL plan, AL-H)", () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let store: TenantStore;
  let ada: string;
  let general: string;
  let handlers: Record<string, JobHandler>;
  const log: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

  /** Every job there is, run until none is left: the ingest, then what it asked for. */
  const drain = async () => {
    const outcomes: string[] = [];
    for (;;) {
      const outcome = await processNext({
        queue,
        db: worker,
        handlers,
        workerId: 'worker-1',
        leaseMs: 60_000,
        log,
      });
      if (outcome === 'idle') return outcomes;
      outcomes.push(outcome);
    }
  };

  /** An image uploaded and ingested, as the service and the ingest job make one. */
  const ingested = async (bytes: Buffer) => {
    const stored = await store.put(bytes, 'application/octet-stream');
    const upload = await service.withTenant(tenant, async (trx) => {
      const made = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: null,
      });
      await receiveAssetBytes(trx, made.id, {
        key: stored.key,
        format: bytes[0] === 0xff ? 'jpeg' : 'png',
        bytes: stored.size,
      });
      return made;
    });
    expect(await drain()).toEqual(['done', 'done']);
    const ready = await service.withTenant(tenant, (trx) => readAssetUpload(trx, upload.id));
    return (await service.withTenant(tenant, (trx) =>
      readAssetVersion(trx, ready!.assetVersionId!),
    ))!;
  };

  const derivative = (version: string, kind: 'thumbnail' | 'preview') =>
    service.withTenant(tenant, (trx) => readDerivative(trx, version, kind));

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
      derive: deriveJob({ db: worker, stores }),
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
  });

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('AST-008 makes a thumbnail and a preview on ingest, WebP, upright, never enlarged and stripped of what the original carried', async () => {
    // Stored 2,000 by 1,000 and turned a quarter: shown 1,000 by 2,000.
    const photo = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')
      .toBuffer();
    const version = await ingested(photo);
    for (const [kind, width, height] of [
      ['thumbnail', 128, 256],
      ['preview', 512, 1024],
    ] as const) {
      const made = await derivative(version.id, kind);
      expect(made, kind).toMatchObject({ width, height });
      const bytes = await store.get(made!.objectKey);
      const metadata = await sharp(bytes).metadata();
      expect(metadata, kind).toMatchObject({ format: 'webp', width, height });
      expect(metadata.orientation ?? 1, kind).toBe(1);
      expect(metadata.xmp, kind).toBeUndefined();
    }
    const stripped = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('asset_derivative')
        .select('stripped')
        .where('version_id', '=', version.id)
        .execute(),
    );
    expect(stripped.map((each) => each.stripped)).toEqual([
      expect.arrayContaining(['xmp']),
      expect.arrayContaining(['xmp']),
    ]);
    // A small image is never enlarged: its preview is its own size.
    const small = await ingested(
      await sharp({
        create: { width: 40, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer(),
    );
    expect(await derivative(small.id, 'preview')).toMatchObject({ width: 40, height: 30 });
  });

  it('AST-010 AST-048 makes a discarded derivative again from the original, which it never touched', async () => {
    const original = await sharp({
      create: { width: 600, height: 400, channels: 3, background: { r: 9, g: 90, b: 200 } },
    })
      .png()
      .toBuffer();
    const version = await ingested(original);
    const first = await derivative(version.id, 'thumbnail');
    expect(first).toBeDefined();
    const keys = await service.withTenant(tenant, (trx) => discardDerivatives(trx, general));
    expect(keys).toContain(first!.objectKey);
    expect(await derivative(version.id, 'thumbnail')).toBeUndefined();
    // Asked for again, as a read asks, and made again from the original alone.
    await service.withTenant(tenant, (trx) => wantDerivatives(trx, version.id));
    expect(await drain()).toEqual(['done']);
    expect(await derivative(version.id, 'thumbnail')).toEqual(first);
    expect(Buffer.compare(await store.get(version.content.object), original)).toBe(0);
  });
});
