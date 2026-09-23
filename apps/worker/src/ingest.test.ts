import { crc32, deflateSync } from 'node:zlib';
import {
  bootstrapCluster,
  createAssetUpload,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  migrate,
  readAssetUpload,
  readAssetVersion,
  receiveAssetBytes,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestJob, type Decode } from './jobs/ingest.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A PNG whose structure is sound and whose compressed data is whatever it is given. */
const pngHolding = (width: number, height: number, data: Buffer) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', data),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

describe('the ingest job, which proves an upload is only an image (figures 1)', () => {
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

  const work = () =>
    processNext({ queue, db: worker, handlers, workerId: 'worker-1', leaseMs: 60_000, log });

  /** An upload filled with these bytes as the service fills one - stored, and its job queued. */
  const uploaded = async (
    bytes: Buffer,
    alternative: { text: string; language: string } | null = null,
  ) => {
    const stored = await store.put(bytes, 'application/octet-stream');
    return service.withTenant(tenant, async (trx) => {
      const upload = await createAssetUpload(trx, { spaceId: general, uploader: ada, alternative });
      await receiveAssetBytes(trx, upload.id, {
        key: stored.key,
        format: bytes[0] === 0xff ? 'jpeg' : 'png',
        bytes: stored.size,
      });
      return { id: upload.id, key: stored.key };
    });
  };

  const uploadOf = (id: string) => service.withTenant(tenant, (trx) => readAssetUpload(trx, id));
  const gone = (key: string) =>
    store.get(key).then(
      () => false,
      () => true,
    );

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await objects.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    handlers = { ingest: ingestJob({ db: worker, stores }) };
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

  it('AST-005 records a decoded image as an asset, its dimensions as displayed and its description in its language', async () => {
    // A photograph stored 60 by 40 and turned a quarter by its EXIF orientation: shown 40 by 60.
    const photo = await sharp({
      create: { width: 60, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { id, key } = await uploaded(photo, { text: 'A red field', language: 'de' });
    expect(await work()).toBe('done');
    const upload = await uploadOf(id);
    expect(upload).toMatchObject({ state: 'ready' });
    const version = await service.withTenant(tenant, (trx) =>
      readAssetVersion(trx, upload!.assetVersionId!),
    );
    expect(version?.content).toMatchObject({
      object: key,
      format: 'jpeg',
      width: 40,
      height: 60,
      orientation: 6,
      colour: 'rgb',
      alternative: { text: 'A red field', language: 'de' },
    });
    expect(version?.spaceId).toBe(general);
  });

  // Not cited as AST-037, whose refusal must be audited: nothing audits one until LIF's log exists.
  it('AST-006 AST-051 refuses a file whose structure is sound but whose pixels do not decode, and keeps no bytes', async () => {
    const broken = pngHolding(8, 8, deflateSync(Buffer.alloc(3)));
    const { id, key } = await uploaded(broken);
    expect(await work()).toBe('failed');
    expect(await uploadOf(id)).toMatchObject({
      state: 'refused',
      reason: 'undecodable',
      assetVersionId: null,
    });
    expect(await gone(key)).toBe(true);
  });

  it('AST-051 walks the bytes again rather than trusting the service, refusing a second file hidden after the image', async () => {
    const image = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const { id, key } = await uploaded(Buffer.concat([image, Buffer.from([0x50, 0x4b, 3, 4])]));
    expect(await work()).toBe('failed');
    expect(await uploadOf(id)).toMatchObject({ state: 'refused', reason: 'malformed' });
    expect(await gone(key)).toBe(true);
  });

  it('refuses the same bytes a second time without removing them from the asset that already has them', async () => {
    const image = await sharp({
      create: { width: 5, height: 5, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const first = await uploaded(image);
    expect(await work()).toBe('done');
    // The second upload of the same bytes shares their key; a decoder that refuses it this time -
    // a limit lowered between the two, say - must not take the first asset's bytes with it.
    const refusing: Decode = async () => ({ ok: false });
    handlers = { ingest: ingestJob({ db: worker, stores, decode: refusing }) };
    try {
      const second = await uploaded(image);
      expect(second.key).toBe(first.key);
      expect(await work()).toBe('failed');
      expect(await uploadOf(second.id)).toMatchObject({ state: 'refused', reason: 'undecodable' });
      expect(await gone(first.key)).toBe(false);
    } finally {
      handlers = { ingest: ingestJob({ db: worker, stores }) };
    }
  });

  it("retries a decode that failed for the decoder's own reasons rather than refusing the image", async () => {
    const image = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 4, g: 5, b: 6 } },
    })
      .png()
      .toBuffer();
    const faulty: Decode = async () => {
      throw new Error('vips: out of memory');
    };
    handlers = { ingest: ingestJob({ db: worker, stores, decode: faulty }) };
    try {
      const { id, key } = await uploaded(image);
      expect(await work()).toBe('retry');
      expect(await uploadOf(id)).toMatchObject({ state: 'checking' });
      expect(await gone(key)).toBe(false);
    } finally {
      handlers = { ingest: ingestJob({ db: worker, stores }) };
    }
  });

  it('refuses an upload whose check never finished, once its job has failed for the last time', async () => {
    const image = await sharp({
      create: { width: 3, height: 3, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();
    const { id } = await uploaded(image);
    const job = {
      id: 'job',
      tenantId: tenant.id,
      kind: 'ingest',
      subjectId: id,
      attempts: 3,
      maxAttempts: 3,
    };
    await ingestJob({ db: worker, stores }).failed(tenant, job as never);
    expect(await uploadOf(id)).toMatchObject({ state: 'refused', reason: 'unchecked' });
  });

  it('keeps the bytes another upload of the same image is still being checked against, when refusing one', async () => {
    const image = await sharp({
      create: { width: 7, height: 7, channels: 3, background: { r: 7, g: 7, b: 7 } },
    })
      .png()
      .toBuffer();
    const first = await uploaded(image);
    const second = await uploaded(image);
    expect(second.key).toBe(first.key);
    // The first's check fails for the last time for the store's reasons; the second has not run yet.
    const job = {
      id: 'job',
      tenantId: tenant.id,
      kind: 'ingest',
      subjectId: first.id,
      attempts: 3,
      maxAttempts: 3,
    };
    await ingestJob({ db: worker, stores }).failed(tenant, job as never);
    expect(await uploadOf(first.id)).toMatchObject({ state: 'refused', reason: 'unchecked' });
    expect(await gone(first.key)).toBe(false);
    // And the second is recorded over them, whatever order the queue gives the two jobs in.
    for (let turn = 0; turn < 4 && (await uploadOf(second.id))?.state === 'checking'; turn += 1) {
      await work();
    }
    expect(await uploadOf(second.id)).toMatchObject({ state: 'ready' });
  });
});
