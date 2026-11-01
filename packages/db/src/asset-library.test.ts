import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  type AssetRights,
  type ContentDocument,
  type ImageHeader,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAssets } from './asset-library.js';
import { createAssetUpload, receiveAssetBytes, recordAsset } from './assets.js';
import { makeBaseline } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { assetUses } from './uses.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});

const headerOf = (format: 'png' | 'jpeg', width: number, height: number): ImageHeader => ({
  format,
  width,
  height,
  orientation: 1,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
  end: 3530,
});

describe("a space's images, browsed and traced (the AL plan, AL-J, AL-K)", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  let stock: string;
  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  const key = (fill: string) => `${production.role}/sha256/${fill.repeat(64)}`;

  /** An image Ada uploaded, as the ingest job records one. */
  const image = (
    fill: string,
    name: string,
    header: ImageHeader,
    rights?: AssetRights,
    space = general,
    alternative: { text: string; language: string } | null = null,
  ) =>
    tenant(async (trx) => {
      const upload = await createAssetUpload(trx, {
        spaceId: space,
        uploader: ada,
        alternative,
        name,
        ...(rights === undefined ? {} : { rights: rights as never }),
      });
      await receiveAssetBytes(trx, upload.id, {
        key: key(fill),
        format: header.format,
        bytes: 3530,
      });
      return recordAsset(trx, upload.id, header);
    });

  /** A component in this space at a second version, its one figure placing the image. */
  const placing = (version: StoredVersion, title: string, space = general) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const blocks = [
        {
          type: 'figure',
          id: 'f1',
          asset: version.id,
          imageStyle: 'figure',
          caption: [{ type: 'text', value: title, marks: [] }],
          alternative: { kind: 'own', text: 'A harbour' },
        },
      ] as ContentDocument['content'];
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { ...substance, content: { ...substance.content, content: blocks } },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  /** A document in General at a second version placing these components. */
  const documentPlacing = (title: string, components: string[]) =>
    tenant(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const nodes: OutlineNode[] = components.map(reference);
      const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const list = (by: string, filter: Parameters<typeof listAssets>[4] = {}) =>
    tenant((trx) => listAssets(trx, by, general, { limit: 100 }, filter));
  const names = async (by: string, filter: Parameters<typeof listAssets>[4] = {}) =>
    (await list(by, filter))!.items.map((each) => each.name);

  let harbour: StoredVersion;
  let pump: StoredVersion;
  let lapsed: StoredVersion;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await tenant(async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada authors in both; Grace reads General alone.
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      for (const [role, principal, space] of [
        [author!.id, ada, general],
        [author!.id, ada, quality],
        [reader!.id, grace, general],
      ] as const) {
        await grant(trx, {
          roleId: role,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      const licence = await createDefinition(trx, {
        kind: 'licence',
        definition: {
          schemaVersion: 1,
          name: 'Stock, editorial',
          key: 'stock_editorial',
          base: 'en',
          names: [{ language: 'en', text: 'Stock, editorial' }],
          permits: ['internal', 'publication'],
          attribution: { required: false },
        },
        author: ada,
      });
      if (licence.answer !== 'created') throw new Error(licence.answer);
      stock = licence.definition.id;
    });
    const declared = (expires?: string): AssetRights => ({
      kind: 'declared',
      source: { text: 'A stock library in Leeds' },
      licence: stock,
      ...(expires === undefined ? {} : { expires }),
    });
    harbour = await image('1', 'harbour.png', headerOf('png', 800, 600), declared(), general, {
      text: 'Boats at dawn',
      language: 'en-GB',
    });
    pump = await image('2', 'pump.jpg', headerOf('jpeg', 400, 600));
    lapsed = await image('3', 'tower.png', headerOf('png', 500, 500), declared('2020-01-31'));
    // One in Quality, which General's library never lists.
    await image('4', 'elsewhere.png', headerOf('png', 10, 10), undefined, quality);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('AST-028 lists a space’s images by name, each at its latest version with its rights, filtered by format, licence, rights and shape', async () => {
    expect(await names(ada)).toEqual(['harbour.png', 'pump.jpg', 'tower.png']);
    const listed = (await list(ada))!;
    expect(listed.total).toBe(3);
    expect(listed.items[0]).toMatchObject({
      id: harbour.artifactId,
      version: { id: harbour.id },
      name: 'harbour.png',
      alternative: { text: 'Boats at dawn', language: 'en-GB' },
      format: 'png',
      width: 800,
      height: 600,
      rights: { kind: 'declared', licence: stock },
      licence: { id: stock, name: 'Stock, editorial' },
      expired: false,
    });
    expect(await names(ada, { format: 'jpeg' })).toEqual(['pump.jpg']);
    expect(await names(ada, { licence: stock })).toEqual(['harbour.png', 'tower.png']);
    expect(await names(ada, { rights: 'undeclared' })).toEqual(['pump.jpg']);
    expect(await names(ada, { rights: 'expired', today: '2026-11-01' })).toEqual(['tower.png']);
    expect(await names(ada, { orientation: 'landscape' })).toEqual(['harbour.png']);
    expect(await names(ada, { orientation: 'portrait' })).toEqual(['pump.jpg']);
    expect(await names(ada, { orientation: 'square' })).toEqual(['tower.png']);
  });

  it('AST-028 searches a space’s images by name, description, format, licence and source', async () => {
    expect(await names(ada, { q: 'HARBOUR' })).toEqual(['harbour.png']);
    expect(await names(ada, { q: 'dawn' })).toEqual(['harbour.png']);
    expect(await names(ada, { q: 'jpeg' })).toEqual(['pump.jpg']);
    expect(await names(ada, { q: 'editorial' })).toEqual(['harbour.png', 'tower.png']);
    expect(await names(ada, { q: 'Leeds' })).toEqual(['harbour.png', 'tower.png']);
    // A pattern's own characters are only themselves.
    expect(await names(ada, { q: '%' })).toEqual([]);
  });

  it('AST-029 finds an image already in the space by the hash of its bytes', async () => {
    expect(await names(ada, { sha256: '2'.repeat(64) })).toEqual(['pump.jpg']);
    expect(await names(ada, { sha256: '4'.repeat(64) })).toEqual([]);
  });

  it('AST-018 AST-050 lists where an image is used, components, documents and baselines, and those nothing uses', async () => {
    const shown = await placing(harbour, 'The harbour');
    // In Quality, which Grace may not read: said to exist, never named.
    await placing(harbour, 'The quay', quality);
    const document = await documentPlacing('The harbour report', [shown.artifactId]);
    const baseline = await tenant((trx) =>
      makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name: 'Issue 1',
        maker: ada,
      }),
    );
    if (baseline.answer !== 'made') throw new Error(baseline.answer);

    const uses = await tenant((trx) => assetUses(trx, grace, harbour.artifactId));
    expect(uses).toEqual({
      components: { named: [{ id: shown.artifactId, title: 'The harbour' }], unreadable: true },
      documents: {
        named: [{ id: document.artifactId, title: 'The harbour report' }],
        unreadable: false,
      },
      baselines: {
        named: [{ id: baseline.baseline, name: 'Issue 1', document: document.artifactId }],
        unreadable: false,
      },
      publications: { named: [], unreadable: false },
    });
    expect(
      (await tenant((trx) => assetUses(trx, ada, harbour.artifactId))).components.named,
    ).toHaveLength(2);
    // In the reader's language, its titles sorted as that language sorts them.
    expect(await tenant((trx) => assetUses(trx, grace, harbour.artifactId, 'en-GB'))).toEqual(uses);

    // Nothing places the pump or the tower; the harbour is used.
    expect(await names(ada, { unused: true })).toEqual(['pump.jpg', 'tower.png']);
    expect((await list(ada))!.items.map((each) => [each.name, each.used])).toEqual([
      ['harbour.png', true],
      ['pump.jpg', false],
      ['tower.png', false],
    ]);
    expect(lapsed).toBeDefined();
    expect(pump).toBeDefined();
  });

  it('leaves a dataset’s images out of the library, as they are the environment’s own data (pre-flight 10)', async () => {
    await tenant(async (trx) => {
      const { uploadForDatasetImage } = await import('./assets.js');
      const made = await uploadForDatasetImage(trx, {
        spaceId: general,
        uploader: ada,
        key: key('5'),
        format: 'png',
        bytes: 3530,
      });
      await recordAsset(trx, made.upload.id, headerOf('png', 6, 4));
    });
    expect(await names(ada)).toEqual(['harbour.png', 'pump.jpg', 'tower.png']);
  });
});
