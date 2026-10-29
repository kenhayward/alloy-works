import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  archiveSpace,
  createDeliveredStore,
  createJobQueue,
  createServiceIdentity,
  createSpace,
  createTenant,
  enqueueJob,
  findRole,
  grant,
  issueApiToken,
  migrate,
  prepareDatabase,
  readAssetVersion,
  readDelivery,
  recordNonce,
  revokeApiToken,
  startDelivery,
  writeBridgeSettings,
  type DeliveredStore,
  type JobQueue,
  type StoredDelivery,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import type { Permission } from '@alloy-works/domain';
import type {
  BridgePackage,
  ComponentVersion,
  DecomposedDocument,
  Receipt,
} from '@kenhayward/bridge-contract';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeDeliverJob, imagesOf } from './jobs/bridge-deliver.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const require = createRequire(import.meta.url);

// The throwaway server only (never 5432); the delivery store's database is made here if it is absent.
const SERVER = new URL(
  process.env['ALLOY_TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5436/postgres',
);
const DELIVERED = (() => {
  const url = new URL(SERVER);
  url.pathname = '/delivered_test';
  return url.toString();
})();

const PROVENANCE = {
  kind: 'decomposition' as const,
  sourceSha256: 'b'.repeat(64),
  sourceFilename: 'report.docx',
  sourceKey: 'example/source-1',
  batchId: null,
  decomposerVersion: 7,
  startedBy: { id: 'u-1', name: 'Example Operator', email: null },
  decomposedAt: '2026-10-29T09:00:00.000Z',
  publishedAt: '2026-10-29T09:05:00.000Z',
};

/** A PNG of a few pixels, its colour from `shade`, so each is its own bytes. */
const png = async (shade: number) =>
  sharp({ create: { width: 4, height: 3, channels: 3, background: { r: shade, g: 90, b: 40 } } })
    .png()
    .toBuffer();

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#c03"/></svg>',
  'utf8',
);

/** A decomposed document of one section holding a figure of the image `img-1`. */
const documentOf = (
  contentType: 'image/png' | 'image/svg+xml' = 'image/png',
  widthMm = 10,
): DecomposedDocument => ({
  blocks: [],
  sections: [
    {
      id: 's1',
      title: [{ kind: 'text', text: 'Method', marks: [] }],
      blocks: [
        {
          kind: 'paragraph',
          id: 'p1',
          inlines: [{ kind: 'text', text: 'We measured.', marks: [] }],
        },
        {
          kind: 'figure',
          id: 'f1',
          imageId: 'img-1',
          numbered: true,
          caption: [{ kind: 'text', text: 'A plot', marks: [] }],
          captionPosition: 'below',
        },
      ],
      sections: [],
    },
  ],
  images: [
    {
      id: 'img-1',
      contentType,
      widthMm,
      heightMm: widthMm / 2,
      align: 'center',
      alt: 'a plot',
      origin: 'embedded',
      originalContentType: null,
    },
  ],
  equations: [],
  notes: [],
  properties: [{ name: 'Client', value: 'Acme', origin: 'custom' }],
  report: [],
});

const documentPackage = (
  document: DecomposedDocument,
  images: { id: string; contentType: string; bytes: Uint8Array }[],
): BridgePackage => ({
  kind: 'document',
  contractVersion: 2,
  producer: { name: 'ct-studio', deployment: 'test' },
  idempotencyKey: randomBytes(32).toString('hex'),
  provenance: PROVENANCE,
  naming: {},
  files: [],
  data: null,
  rdf: null,
  narrative: null,
  images: images.map((image) => ({
    id: image.id,
    contentType: image.contentType,
    content: Buffer.from(image.bytes).toString('base64'),
  })),
  document,
});

const dataPackage = (data: BridgePackage['data']): BridgePackage => ({
  kind: 'document',
  contractVersion: 1,
  producer: { name: 'ct-studio', deployment: 'test' },
  idempotencyKey: randomBytes(32).toString('hex'),
  provenance: {
    sourceSha256: 'c'.repeat(64),
    sourceFilename: 'rates.pdf',
    jobId: 'job-1',
    recipeId: 'rates',
    recipeVersion: 2,
    approver: { id: 'u-2', name: 'Pat', email: null },
    extractedAt: null,
    publishedAt: '2026-10-29T10:00:00.000Z',
  },
  naming: {},
  files: [],
  data,
  rdf: null,
  narrative: null,
  images: null,
});

describe('the bridge_deliver job, which writes a delivery CT Studio asked for (the CS plan, Task 10)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let delivered: DeliveredStore;
  let tenant: Tenant;
  let store: TenantStore;
  let ada: string;
  let general: string;
  let identity: string;
  let schema: string;
  let handlers: Record<string, JobHandler>;
  const log: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

  const work = (with_: Record<string, JobHandler> = handlers) =>
    processNext({ queue, db: worker, handlers: with_, workerId: 'worker-1', leaseMs: 60_000, log });

  /** A token of the identity, as a connection holds one, by its id. */
  const token = (scopes: Permission[] = ['create', 'edit']) =>
    service.withTenant(
      tenant,
      async (trx) =>
        (
          await issueApiToken(trx, {
            principalId: identity,
            name: `CT Studio ${randomUUID()}`,
            tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
            scopes,
            expiresAt: new Date(Date.now() + 86_400_000),
          })
        ).id,
    );

  /**
   * A delivery accepted as `POST /bridge/deliveries` accepts one: the request without its instance or
   * credential stored by its hash, the delivery started and its job queued.
   */
  const accepted = async (
    pkg: BridgePackage,
    over: {
      tokenId?: string;
      destination?: Record<string, string>;
      spaceId?: string;
      update?: { persistentId: string; expected: ComponentVersion[] };
    } = {},
  ): Promise<StoredDelivery> => {
    const tokenId = over.tokenId ?? (await token());
    const spaceId = over.spaceId ?? general;
    const bytes = Buffer.from(
      JSON.stringify({
        destination: over.destination ?? { space: spaceId },
        idempotencyKey: randomUUID(),
        actingUser: { id: 'u-1', name: 'Example Operator', email: null },
        ...(over.update === undefined ? {} : { update: over.update }),
        package: pkg,
      }),
      'utf8',
    );
    const stored = await store.put(bytes, 'application/json');
    return service.withTenant(tenant, async (trx) => {
      const started = await startDelivery(trx, {
        key: randomUUID(),
        spaceId,
        family: pkg.document ? 'document' : 'data',
        tokenId,
        principalId: identity,
        packageKey: stored.key,
        provenance: {
          source: pkg.provenance,
          producer: pkg.producer,
          actingUser: 'Example Operator',
          origin: 'https://dev.acme.alloy.test',
        },
      });
      if (started.answer !== 'started') throw new Error(started.answer);
      await enqueueJob(trx, 'bridge_deliver', started.id);
      return (await readDelivery(trx, started.id))!;
    });
  };
  const deliveryOf = (id: string) => service.withTenant(tenant, (trx) => readDelivery(trx, id));
  /** Who the delivery's bridge.refused event was recorded as. */
  const refusedAs = (id: string) =>
    service.withTenant(tenant, async (trx) => {
      const events = await trx
        .selectFrom('audit_event')
        .select(['actor_kind', 'actor', 'token', 'detail'])
        .where('kind', '=', 'bridge.refused')
        .execute();
      return events.find((event) => event.detail['delivery'] === id);
    });
  /** As an administrator, outside the tenant's grants: for state a test needs and no role may set. */
  const asAdmin = async (text: string, values: unknown[] = []) => {
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      return await admin.query(text, values);
    } finally {
      await admin.end();
    }
  };
  const gone = (key: string) =>
    store.get(key).then(
      () => false,
      () => true,
    );
  const countArtifacts = () =>
    service.withTenant(tenant, async (trx) =>
      Number(
        (
          await trx
            .selectFrom('artifact')
            .select((eb) => eb.fn.countAll().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );

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

    const bootstrap = new pg.Client({ connectionString: SERVER.toString() });
    await bootstrap.connect();
    try {
      const found = await bootstrap.query('select 1 from pg_database where datname = $1', [
        'delivered_test',
      ]);
      if (found.rowCount === 0) await bootstrap.query('create database delivered_test');
    } finally {
      await bootstrap.end();
    }
    delivered = createDeliveredStore(DELIVERED);
    schema = (await delivered.ensure(tenant.id)).schema;
    handlers = { bridge_deliver: bridgeDeliverJob({ db: worker, stores, delivered }) };

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
      identity = (
        await createServiceIdentity(trx, {
          name: 'CT Studio',
          description: 'The delivery bridge',
          by: ada,
        })
      ).id;
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: identity },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      await writeBridgeSettings(trx, {
        spaceId: general,
        componentType: null,
        template: null,
        propertyMap: {},
        connectionId: randomUUID(),
        tableSchema: schema,
        changedBy: ada,
      });
      store = await stores.forTenant(trx, tenant);
    });
  });

  afterAll(async () => {
    if (delivered && schema) {
      const admin = new pg.Client({ connectionString: DELIVERED });
      await admin.connect();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      const role = `${schema}_read`;
      if ((await admin.query('select 1 from pg_roles where rolname = $1', [role])).rowCount) {
        await admin.query(`drop owned by "${role}"`);
        await admin.query(`drop role "${role}"`);
      }
      await admin.end();
    }
    await delivered?.close();
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('API-067 a package with a refused image writes nothing', async () => {
    const broken = (await png(10)).subarray(0, 40);
    const before = await countArtifacts();
    const delivery = await accepted(
      documentPackage(documentOf(), [{ id: 'img-1', contentType: 'image/png', bytes: broken }]),
    );
    expect(await work()).toBe('failed');
    const after = (await deliveryOf(delivery.id))!;
    expect(after).toMatchObject({
      state: 'refused',
      key: null,
      refusal: {
        class: 'needs_user',
        code: 'content_rejected',
        details: { reason: 'image_refused', image: 'img-1' },
      },
    });
    expect(await countArtifacts()).toBe(before);
  });

  it('an SVG is rasterised and its original kept', async () => {
    const delivery = await accepted(
      documentPackage(documentOf('image/svg+xml', 25.4), [
        { id: 'img-1', contentType: 'image/svg+xml', bytes: SVG },
      ]),
    );
    expect(await work()).toBe('done');
    const after = (await deliveryOf(delivery.id))!;
    expect(after.state).toBe('written');
    const receipt = after.receipt as Receipt;
    const asset = receipt.document!.components.find((each) => each.kind === 'asset')!;
    const version = await service.withTenant(tenant, (trx) => readAssetVersion(trx, asset.version));
    // 25.4 mm at 300 dpi.
    expect(version!.content).toMatchObject({ format: 'png', width: 300, height: 150 });
    const stored = await store.get(version!.content.object);
    expect((await sharp(stored).metadata()).format).toBe('png');
    const provenance = after.provenance as {
      originals: { image: string; key: string; sha256: string; contentType: string }[];
    };
    expect(provenance.originals).toEqual([
      {
        image: 'img-1',
        key: expect.any(String),
        sha256: createHash('sha256').update(SVG).digest('hex'),
        contentType: 'image/svg+xml',
      },
    ]);
    expect(Buffer.compare(await store.get(provenance.originals[0]!.key), SVG)).toBe(0);
  });

  it('a revoked token between accept and run refuses', async () => {
    const tokenId = await token();
    const pngBytes = await png(30);
    const delivery = await accepted(
      documentPackage(documentOf(), [{ id: 'img-1', contentType: 'image/png', bytes: pngBytes }]),
      { tokenId },
    );
    await service.withTenant(tenant, (trx) => revokeApiToken(trx, identity, tokenId));
    const before = await countArtifacts();
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: { class: 'needs_user', code: 'credential_rejected' },
    });
    expect(await countArtifacts()).toBe(before);
    // Its token is gone, so nothing names the identity: recorded as the system.
    expect(await refusedAs(delivery.id)).toMatchObject({
      actor_kind: 'system',
      actor: null,
      token: null,
    });
  });

  it('an expired token refuses, audited as the identity it names', async () => {
    const tokenId = await token();
    const delivery = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: await png(31) },
      ]),
      { tokenId },
    );
    await asAdmin(
      `update "${tenant.schema}".api_token
          set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [tokenId],
    );
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: { code: 'credential_rejected' },
    });
    expect(await refusedAs(delivery.id)).toMatchObject({
      actor_kind: 'token',
      actor: identity,
      token: tokenId,
    });
  });

  it('an update by a token scoped without edit refuses, audited as the identity', async () => {
    const tokenId = await token(['create']);
    const delivery = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: await png(32) },
      ]),
      {
        tokenId,
        principalId: identity,
        update: {
          persistentId: randomUUID(),
          expected: [{ kind: 'map', id: randomUUID(), version: randomUUID(), element: null }],
        },
      },
    );
    const before = await countArtifacts();
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      packageKey: null,
      refusal: { code: 'credential_rejected', details: { permission: 'edit' } },
    });
    expect(await countArtifacts()).toBe(before);
    expect(await refusedAs(delivery.id)).toMatchObject({
      actor_kind: 'token',
      actor: identity,
      token: tokenId,
    });
  });

  it('a space archived between accept and run refuses not_found', async () => {
    const archived = await service.withTenant(tenant, async (trx) => {
      const made = await createSpace(trx, `Archive ${randomUUID().slice(0, 8)}`);
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: identity },
        level: { kind: 'space', id: made.id },
        effect: 'allow',
        grantedBy: ada,
      });
      return made.id;
    });
    const delivery = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: await png(33) },
      ]),
      { spaceId: archived },
    );
    await service.withTenant(tenant, (trx) => archiveSpace(trx, archived, ada));
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: { code: 'not_found' },
    });
  });

  it('a package whose bytes do not match its key is tried again, never refused', async () => {
    const delivery = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: await png(34) },
      ]),
    );
    // A store that answers other bytes than the key names.
    const lying: ObjectStores = {
      forTenant: async (trx, t) => {
        const real = await stores.forTenant(trx, t);
        return {
          ...real,
          get: async (key) => Buffer.concat([await real.get(key), Buffer.from(' ')]),
        };
      },
    };
    expect(await work({ bridge_deliver: bridgeDeliverJob({ db: worker, stores: lying }) })).toBe(
      'retry',
    );
    expect(await deliveryOf(delivery.id)).toMatchObject({ state: 'running' });
    expect(await gone(delivery.packageKey!)).toBe(false);
    // The next attempt, from a store that answers truly, writes it.
    await asAdmin('update platform.job set run_after = now() where subject_id = $1', [delivery.id]);
    expect(await work()).toBe('done');
    expect(await deliveryOf(delivery.id)).toMatchObject({ state: 'written' });
  });

  it('an image the document does not describe is refused, never drawn', async () => {
    const pkg = documentPackage(documentOf('image/svg+xml', 25.4), [
      { id: 'other', contentType: 'image/svg+xml', bytes: SVG },
    ]);
    expect(await imagesOf(pkg, undefined)).toMatchObject({
      code: 'content_rejected',
      details: { reason: 'image_refused', image: 'other', refusal: 'undescribed' },
    });
  });

  it('read-back is ok for every decomposed fixture', async () => {
    const fixtures = join(
      dirname(dirname(require.resolve('@kenhayward/bridge-contract'))),
      'test',
      'fixtures',
    );
    const decomposed = ['package-decomposed.json'];
    for (const name of decomposed) {
      const pkg = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as BridgePackage;
      const delivery = await accepted({ ...pkg, idempotencyKey: randomBytes(32).toString('hex') });
      expect(await work(), name).toBe('done');
      const after = (await deliveryOf(delivery.id))!;
      expect(after.state, name).toBe('written');
      const receipt = after.receipt as Receipt;
      expect(receipt.document!.readBack, name).toEqual({ ok: true, at: null, detail: null });
      expect(receipt.written[0], name).toMatchObject({
        kind: 'document',
        url: `https://dev.acme.alloy.test/#/documents/${receipt.document!.persistentId}`,
      });
    }
  });

  it('the package object is removed once written or refused', async () => {
    const good = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: await png(50) },
      ]),
    );
    expect(await gone(good.packageKey!)).toBe(false);
    expect(await work()).toBe('done');
    expect(await deliveryOf(good.id)).toMatchObject({ state: 'written', packageKey: null });
    expect(await gone(good.packageKey!)).toBe(true);

    const bad = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: Buffer.from('not an image') },
      ]),
    );
    expect(await work()).toBe('failed');
    expect(await deliveryOf(bad.id)).toMatchObject({ state: 'refused', packageKey: null });
    expect(await gone(bad.packageKey!)).toBe(true);
  });

  it('unmapped properties are kept with the provenance', async () => {
    const delivery = await accepted(
      documentPackage(documentOf(), [
        { id: 'img-1', contentType: 'image/png', bytes: await png(70) },
      ]),
    );
    expect(await work()).toBe('done');
    expect((await deliveryOf(delivery.id))!.provenance).toMatchObject({
      unmappedProperties: [{ name: 'Client', value: 'Acme', origin: 'custom' }],
    });
  });

  const rates = {
    fields: [{ id: 'total', title: 'Total', type: 'number', value: 12, unit: null }],
    tables: [
      {
        id: 'prices',
        title: 'Prices',
        columns: [
          { id: 'item', title: 'Item', type: 'text' },
          { id: 'price', title: 'Price', type: 'number' },
        ],
        rows: [
          { item: 'Nets', price: '4.50' },
          { item: 'Jars', price: '7.50' },
        ],
      },
    ],
  };

  it("API-072 a data package is written to the space's tables and the receipt lists each", async () => {
    const delivery = await accepted(dataPackage(rates), {
      destination: { space: general, tableSet: 'pond' },
    });
    expect(await work()).toBe('done');
    const after = (await deliveryOf(delivery.id))!;
    expect(after.receipt).toEqual({
      written: [
        { kind: 'table', id: `${schema}.pond_prices`, label: null, url: null },
        { kind: 'table', id: `${schema}.pond_fields`, label: null, url: null },
      ],
    });
    expect(await gone(delivery.packageKey!)).toBe(true);
    const admin = new pg.Client({ connectionString: DELIVERED });
    await admin.connect();
    try {
      const rows = await admin.query(
        `select item, price::text as price, ct_row::int as row from "${schema}".pond_prices order by ct_row`,
      );
      expect(rows.rows).toEqual([
        { item: 'Nets', price: '4.50', row: 1 },
        { item: 'Jars', price: '7.50', row: 2 },
      ]);
    } finally {
      await admin.end();
    }
  });

  it('a data package whose tables meet in one name refuses, naming the table set', async () => {
    const delivery = await accepted(
      dataPackage({ fields: [], tables: [{ ...rates.tables[0]!, id: 'fields' }] }),
    );
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: {
        code: 'content_rejected',
        details: { reason: 'name_conflict', field: 'tableSet' },
      },
    });
  });

  it('API-072 a column whose type has changed refuses, naming it, and its rows stay', async () => {
    const first = await accepted(dataPackage(rates), {
      destination: { space: general, tableSet: 'typed' },
    });
    expect(await work()).toBe('done');
    expect((await deliveryOf(first.id))!.state).toBe('written');
    const retyped = {
      ...rates,
      tables: [
        {
          ...rates.tables[0]!,
          columns: [
            { id: 'item', title: 'Item', type: 'text' },
            { id: 'price', title: 'Price', type: 'date' },
          ],
        },
      ],
    };
    const second = await accepted(dataPackage(retyped), {
      destination: { space: general, tableSet: 'typed' },
    });
    expect(await work()).toBe('failed');
    expect(await deliveryOf(second.id)).toMatchObject({
      state: 'refused',
      refusal: {
        code: 'content_rejected',
        details: { reason: 'type_changed', table: 'typed_prices', column: 'price' },
      },
    });
  });

  it('API-072 a value its column cannot hold refuses, naming its row', async () => {
    const bad = {
      ...rates,
      tables: [
        {
          ...rates.tables[0]!,
          rows: [
            { item: 'Nets', price: '4.50' },
            { item: 'Jars', price: 'lots' },
          ],
        },
      ],
    };
    const delivery = await accepted(dataPackage(bad), {
      destination: { space: general, tableSet: 'valued' },
    });
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: {
        code: 'content_rejected',
        details: { reason: 'value_invalid', table: 'valued_prices', column: 'price', row: 2 },
      },
    });
  });

  it('API-072 a column named as provenance is refused', async () => {
    const reserved = {
      ...rates,
      tables: [
        {
          ...rates.tables[0]!,
          columns: [...rates.tables[0]!.columns, { id: 'ct_note', title: null, type: 'text' }],
        },
      ],
    };
    const delivery = await accepted(dataPackage(reserved));
    expect(await work()).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: { code: 'content_rejected', details: { reason: 'reserved_column' } },
    });
  });

  it('a worker with no delivery store refuses a data package as not configured', async () => {
    const delivery = await accepted(dataPackage(rates));
    const without = { bridge_deliver: bridgeDeliverJob({ db: worker, stores }) };
    expect(await work(without)).toBe('failed');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      refusal: { code: 'content_rejected', details: { reason: 'not_configured' } },
    });
  });

  it('a package with neither a document nor data is written as nothing', async () => {
    const delivery = await accepted(dataPackage(null));
    expect(await work()).toBe('done');
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'written',
      receipt: { written: [] },
    });
  });

  it('a delivery whose last attempt failed is refused as internal', async () => {
    const delivery = await accepted(dataPackage(rates));
    const failing: JobHandler = {
      run: () => Promise.reject(new Error('the store is down')),
      failed: (t, job, cause) => handlers['bridge_deliver']!.failed(t, job, cause),
    };
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      for (const expected of ['retry', 'retry', 'failed']) {
        // Due again at once, rather than after the queue's back-off.
        await admin.query('update platform.job set run_after = now() where subject_id = $1', [
          delivery.id,
        ]);
        expect(await work({ bridge_deliver: failing })).toBe(expected);
      }
    } finally {
      await admin.end();
    }
    expect(await deliveryOf(delivery.id)).toMatchObject({
      state: 'refused',
      packageKey: null,
      refusal: { class: 'retryable', code: 'internal' },
    });
    expect(await gone(delivery.packageKey!)).toBe(true);
  });

  it("the nonces past the signing window are swept on the worker's idle tick", async () => {
    const old = randomUUID();
    const fresh = randomUUID();
    await service.withTenant(tenant, async (trx) => {
      await recordNonce(trx, old);
      await recordNonce(trx, fresh);
    });
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        "update platform.bridge_nonce set at = now() - interval '301 seconds' where nonce = $1",
        [old],
      );
      expect(await queue.sweepBridgeNonces()).toBe(1);
      const left = await admin.query('select nonce from platform.bridge_nonce order by nonce');
      expect(left.rows.map((row: { nonce: string }) => row.nonce)).toEqual([fresh]);
    } finally {
      await admin.end();
    }
  });
});
