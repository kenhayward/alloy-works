import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  DEFINITION_SCHEMA_VERSION,
  readImageHeader,
  TEMPLATE_SCHEMA_VERSION,
  type OutlineDocument,
} from '@alloy-works/domain';
import * as bridge from '@alloy-works/domain/bridge';
import type { Block, DecomposedDocument, Inline } from '@kenhayward/bridge-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  writeDocumentDelivery,
  type CheckedImage,
  type DocumentDelivery,
  type DocumentRefused,
  type DocumentWritten,
} from './bridge-documents.js';
import {
  elementsOf,
  finishDelivery,
  refuseDelivery,
  startDelivery,
  type BridgeSettings,
} from './bridge-store.js';
import { deleteArtifact } from './deletion.js';
import { createDocument } from './documents.js';
import { claimLock } from './editing.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createServiceIdentity } from './service-identities.js';
import { archiveSpace, createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate, documentTemplate } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';

const require = createRequire(import.meta.url);
const NOTE = 'Delivered by CT Studio from report.docx (7) for Example Operator';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);
const TITLE_FIELD = 'b7a10000-0000-4000-8000-000000000001';
const PAGES_FIELD = 'b7a10000-0000-4000-8000-000000000002';
const SCHEMA = 'b7a10000-0000-4000-8000-000000000003';

const text = (value: string): Inline => ({ kind: 'text', text: value, marks: [] });
const para = (id: string, words: string): Block => ({
  kind: 'paragraph',
  id,
  inlines: [text(words)],
});
const figure = (id: string, imageId: string): Block => ({
  kind: 'figure',
  id,
  imageId,
  numbered: true,
  caption: [text('A plot')],
  captionPosition: 'below',
});
const section = (
  id: string,
  title: string,
  blocks: Block[],
  sections: DecomposedDocument['sections'] = [],
) => ({ id, title: [text(title)], blocks, sections });
const imageOf = (id: string): DecomposedDocument['images'][number] => ({
  id,
  contentType: 'image/png',
  widthMm: 10,
  heightMm: 5,
  align: 'center',
  alt: 'a plot',
  origin: 'embedded',
  originalContentType: null,
});
const documentOf = (over: Partial<DecomposedDocument> = {}): DecomposedDocument => ({
  blocks: [para('lead', 'Summary first.')],
  sections: [
    section('s1', 'Method', [para('s1p', 'We measured.'), figure('s1f', 'img-1')]),
    section('s2', 'Results', [para('s2p', 'It worked.')]),
  ],
  images: [imageOf('img-1')],
  equations: [],
  notes: [],
  properties: [],
  report: [],
  ...over,
});
const checked = (id: string, bytes: Uint8Array = PNG): CheckedImage => {
  const header = readImageHeader(bytes);
  if (!header.ok) throw new Error('not an image');
  return {
    id,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    header: header.header,
    alternative: 'a plot',
  };
};

describe('a document delivery', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;
  let space: string;
  let identity: string;
  let ada: string;
  let settings: BridgeSettings;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const stored = new Map<string, Uint8Array>();
  const store: DocumentDelivery['store'] = {
    put: (body) => {
      const sha256 = createHash('sha256').update(body).digest('hex');
      const key = `${tenant.role}/sha256/${sha256}`;
      stored.set(key, body);
      return Promise.resolve({ key, sha256 });
    },
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    const id = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await as(async (trx) => {
      space = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
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
      identity = (
        await createServiceIdentity(trx, {
          name: 'CT Studio',
          description: 'The delivery bridge',
          by: ada,
        })
      ).id;
      // The identity reads General, where the template is.
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: identity },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    settings = {
      spaceId: space,
      componentType: null,
      template: null,
      propertyMap: {},
      connectionId: null,
      tableSchema: null,
      changedBy: ada,
      changedAt: new Date(),
    };
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  type Delivered = (DocumentWritten | DocumentRefused) & { key: string };

  /**
   * One delivery as the job makes it: started by its key, written, and finished in the same
   * transaction, or refused and its key given up.
   */
  const deliver = async (
    over: Partial<Omit<DocumentDelivery, 'deliveryId' | 'store'>> = {},
    key = randomUUID(),
  ): Promise<Delivered> =>
    as(async (trx) => {
      const started = await startDelivery(trx, {
        key,
        spaceId: over.spaceId ?? space,
        family: 'document',
        tokenId: randomUUID(),
        principalId: identity,
        packageKey: null,
        provenance: { sourceFilename: 'report.docx' },
      });
      if (started.answer !== 'started') throw new Error(started.answer);
      const answer = await writeDocumentDelivery(trx, {
        deliveryId: started.id,
        spaceId: space,
        author: identity,
        note: NOTE,
        document: documentOf(),
        title: 'Annual report',
        images: [checked('img-1')],
        settings,
        store,
        origin: 'https://acme.alloy.test',
        ...over,
      });
      if (answer.answer === 'written') {
        await finishDelivery(trx, started.id, answer.receipt, answer.carried, {
          persistentId: answer.receipt.document!.persistentId,
          subject: answer.receipt.document!.persistentId,
        });
      } else {
        await refuseDelivery(trx, started.id, answer.error);
      }
      return { ...answer, key };
    });
  const written = (answer: Delivered) => {
    if (answer.answer !== 'written') throw new Error(JSON.stringify(answer.error));
    return answer.receipt.document!;
  };
  const updateOf = (receipt: ReturnType<typeof written>) => ({
    persistentId: receipt.persistentId,
    expected: receipt.components,
  });
  const latest = (id: string) => as((trx) => latestVersion(trx, id));
  const entry = (receipt: ReturnType<typeof written>, kind: string, element: string | null) =>
    receipt.components.find((each) => each.kind === kind && each.element === element)!;
  const countArtifacts = () =>
    as(async (trx) =>
      Number(
        (
          await trx
            .selectFrom('artifact')
            .select((eb) => eb.fn.countAll().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );
  /** A person's own next version of an artifact, made in Alloy Works between two deliveries. */
  const edit = (id: string, change: (version: StoredVersion) => StoredVersion['content']) =>
    as(async (trx) => {
      const current = (await latestVersion(trx, id))!;
      const answer = await recordVersion(trx, {
        artifactId: id,
        openedFrom: current.id,
        author: ada,
        substance: { ...substanceOf(current), content: change(current) } as never,
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });
  const pinnedOf = (outline: OutlineDocument): string[] =>
    JSON.stringify(outline).match(/"version":"[0-9a-f-]{36}"/gu) ?? [];

  it('API-067 a create makes the document, its components and assets at 0.1 in one transaction', async () => {
    const receipt = written(await deliver());
    const document = (await latest(receipt.persistentId))!;
    expect(document).toMatchObject({ kind: 'document', revision: 0, version: 1, author: identity });
    const outline = document.content as OutlineDocument;
    expect(outline.nodes.map((node) => node.type)).toEqual(['reference', 'section', 'section']);
    expect(outline.nodes[1]).toMatchObject({ numbered: false, matter: 'body' });
    for (const each of receipt.components.filter((one) => one.kind !== 'map')) {
      expect(await latest(each.id)).toMatchObject({
        id: each.version,
        revision: 0,
        version: 1,
        author: identity,
      });
    }
    // Each reference pinned to the version this delivery wrote.
    expect(pinnedOf(outline)).toHaveLength(3);
    expect(receipt.components.map((each) => each.kind).sort()).toEqual([
      'asset',
      'component',
      'component',
      'component',
      'map',
    ]);

    // One transaction: a failure after the write leaves nothing behind.
    const before = await countArtifacts();
    await expect(
      as(async (trx) => {
        const started = await startDelivery(trx, {
          key: randomUUID(),
          spaceId: space,
          family: 'document',
          tokenId: randomUUID(),
          principalId: identity,
          packageKey: null,
          provenance: {},
        });
        if (started.answer !== 'started') throw new Error(started.answer);
        await writeDocumentDelivery(trx, {
          deliveryId: started.id,
          spaceId: space,
          author: identity,
          note: NOTE,
          document: documentOf(),
          title: 'Rolled back',
          images: [checked('img-1')],
          settings,
          store,
        });
        throw new Error('the job failed after writing');
      }),
    ).rejects.toThrow('the job failed after writing');
    expect(await countArtifacts()).toBe(before);
  });

  it("API-071 every version's note names the source, decomposer and user delivered for", async () => {
    const receipt = written(await deliver({ images: [checked('img-1', withChunk(PNG, 'a'))] }));
    for (const each of receipt.components) {
      const version = await as((trx) => readVersion(trx, each.version));
      expect(version).toMatchObject({ note: NOTE, author: identity });
    }
    expect(receipt.components.some((each) => each.kind === 'asset')).toBe(true);
  });

  it('API-069 an update with a moved component version is refused, changing nothing', async () => {
    const receipt = written(await deliver());
    const component = entry(receipt, 'component', 's1');
    const edited = await edit(component.id, (current) => ({
      ...(current.content as object),
      title: 'Edited in Alloy Works',
    }));
    const answer = await deliver({ update: updateOf(receipt) });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        class: 'needs_user',
        code: 'changed_in_target',
        details: {
          changed: [{ id: component.id, expected: component.version, actual: edited.id }],
        },
      },
    });
    expect((await latest(component.id))!.id).toBe(edited.id);
    expect((await latest(receipt.persistentId))!.id).toBe(entry(receipt, 'map', null).version);
  });

  it('API-069 an update after an outline edit is refused', async () => {
    const receipt = written(await deliver());
    const edited = await edit(receipt.persistentId, (current) => ({
      ...(current.content as OutlineDocument),
      title: 'Retitled in Alloy Works',
    }));
    const answer = await deliver({ update: updateOf(receipt) });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        code: 'changed_in_target',
        details: { changed: [{ id: receipt.persistentId, actual: edited.id }] },
      },
    });
    expect((await latest(receipt.persistentId))!.id).toBe(edited.id);
  });

  it('API-069 an update whose expected leaves out the map is held to its last delivery', async () => {
    const receipt = written(await deliver());
    const map = entry(receipt, 'map', null);
    const edited = await edit(receipt.persistentId, (current) => ({
      ...(current.content as OutlineDocument),
      title: 'Retitled in Alloy Works',
    }));
    const answer = await deliver({
      update: {
        persistentId: receipt.persistentId,
        expected: receipt.components.filter((each) => each.kind !== 'map'),
      },
    });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        code: 'changed_in_target',
        details: {
          changed: [{ id: receipt.persistentId, expected: map.version, actual: edited.id }],
        },
      },
    });
    expect((await latest(receipt.persistentId))!.id).toBe(edited.id);
  });

  it('API-069 an update to a document no delivery wrote is refused, changing nothing', async () => {
    const made = await as(async (trx) => {
      const document = await createDocument(trx, {
        spaceId: space,
        title: 'Written by a person',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      return document.version;
    });
    const before = await countArtifacts();
    const answer = await deliver({ update: { persistentId: made.artifactId, expected: [] } });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        code: 'changed_in_target',
        details: {
          changed: [{ id: made.artifactId, expected: 'not delivered', actual: made.id }],
        },
      },
    });
    expect(await countArtifacts()).toBe(before);
    expect((await latest(made.artifactId))!.id).toBe(made.id);
  });

  it('API-069 an update to a document no delivery wrote is refused even when expected names its current map', async () => {
    const made = await as(async (trx) => {
      const document = await createDocument(trx, {
        spaceId: space,
        title: 'Written by a person',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      return document.version;
    });
    const before = await countArtifacts();
    const answer = await deliver({
      update: {
        persistentId: made.artifactId,
        expected: [{ kind: 'map', id: made.artifactId, version: made.id, element: null }],
      },
    });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        code: 'changed_in_target',
        details: {
          changed: [{ id: made.artifactId, expected: 'not delivered', actual: made.id }],
        },
      },
    });
    expect(await countArtifacts()).toBe(before);
    expect((await latest(made.artifactId))!.id).toBe(made.id);
  });

  it('API-069 an update after a new image version is refused', async () => {
    const receipt = written(await deliver({ images: [checked('img-1', withChunk(PNG, 'b'))] }));
    const asset = entry(receipt, 'asset', 'img-1');
    const edited = await edit(asset.id, (current) => ({
      ...(current.content as object),
      alternative: { text: 'Described in Alloy Works', language: 'en' },
    }));
    const answer = await deliver({
      update: updateOf(receipt),
      images: [checked('img-1', withChunk(PNG, 'b'))],
    });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        code: 'changed_in_target',
        details: { changed: [{ id: asset.id, actual: edited.id }] },
      },
    });
  });

  it('API-069 a component locked by a person refuses with component_locked', async () => {
    const receipt = written(await deliver());
    const component = entry(receipt, 'component', 's2');
    const claimed = await as((trx) =>
      claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
    );
    expect(claimed.answer).toBe('claimed');
    const answer = await deliver({ update: updateOf(receipt) });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        class: 'needs_user',
        code: 'content_rejected',
        details: {
          reason: 'component_locked',
          component: component.id,
          holder: { id: ada, name: 'Ada' },
        },
      },
    });
    expect((await latest(component.id))!.id).toBe(component.version);
  });

  it('a document gone answers not_found with document_missing', async () => {
    const persistentId = randomUUID();
    const answer = await deliver({
      update: {
        persistentId,
        expected: [{ kind: 'map', id: persistentId, version: randomUUID(), element: null }],
      },
    });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        class: 'needs_user',
        code: 'not_found',
        details: { reason: 'document_missing', persistentId },
      },
    });

    // Deleted in Alloy Works is gone as well.
    const receipt = written(await deliver());
    const deleted = await as((trx) => deleteArtifact(trx, receipt.persistentId, ada));
    expect(deleted).toMatchObject({ answer: 'deleted' });
    expect(await deliver({ update: updateOf(receipt) })).toMatchObject({
      answer: 'refused',
      error: {
        code: 'not_found',
        details: { reason: 'document_missing', persistentId: receipt.persistentId },
      },
    });
  });

  it('API-070 an unchanged section keeps its version', async () => {
    const receipt = written(await deliver());
    const changed = documentOf();
    changed.sections[1] = section('s2', 'Results', [para('s2p', 'It worked twice.')]);
    const again = written(await deliver({ document: changed, update: updateOf(receipt) }));
    expect(entry(again, 'component', 's1').version).toBe(entry(receipt, 'component', 's1').version);
    expect(entry(again, 'component', LEAD).version).toBe(entry(receipt, 'component', LEAD).version);
    expect(entry(again, 'asset', 'img-1')).toEqual(entry(receipt, 'asset', 'img-1'));
    const s2 = await latest(entry(again, 'component', 's2').id);
    expect(s2).toMatchObject({ id: entry(again, 'component', 's2').version, version: 2 });
    expect(entry(again, 'map', null).version).not.toBe(entry(receipt, 'map', null).version);
    expect(again.readBack.ok).toBe(true);

    // Nothing changed at all: every version, the document's too, stays.
    const same = written(await deliver({ document: changed, update: updateOf(again) }));
    expect(same.components).toEqual(again.components);
  });

  it('a section no longer sent leaves the outline and its component stays', async () => {
    const receipt = written(await deliver());
    const fewer = documentOf();
    fewer.sections = fewer.sections.slice(0, 1);
    const again = written(await deliver({ document: fewer, update: updateOf(receipt) }));
    const outline = (await latest(again.persistentId))!.content as OutlineDocument;
    const s2 = entry(receipt, 'component', 's2');
    expect(JSON.stringify(outline)).not.toContain(s2.id);
    expect(outline.nodes.filter((node) => node.type === 'section')).toHaveLength(1);
    expect((await latest(s2.id))!.id).toBe(s2.version);
    expect(again.components.some((each) => each.id === s2.id)).toBe(false);
  });

  it("API-068 a replayed create key after an update answers the create's receipt", async () => {
    const created = await deliver();
    const receipt = written(created);
    const changed = documentOf({ blocks: [para('lead', 'A new summary.')] });
    written(await deliver({ document: changed, update: updateOf(receipt) }));
    const replayed = await as((trx) =>
      startDelivery(trx, {
        key: created.key,
        spaceId: space,
        family: 'document',
        tokenId: randomUUID(),
        principalId: identity,
        packageKey: null,
        provenance: {},
      }),
    );
    expect(replayed).toEqual({
      answer: 'written',
      receipt: JSON.parse(JSON.stringify((created as DocumentWritten).receipt)),
    });
  });

  it("the receipt's components hold the document as map, components and assets", async () => {
    const answer = await deliver();
    if (answer.answer !== 'written') throw new Error('refused');
    const { receipt } = answer;
    const document = receipt.document!;
    const map = entry(document, 'map', null);
    expect(map).toEqual({
      kind: 'map',
      id: document.persistentId,
      version: (await latest(document.persistentId))!.id,
      element: null,
    });
    expect(document.components.filter((each) => each.kind === 'component')).toEqual(
      [LEAD, 's1', 's2'].map((element) => ({
        kind: 'component',
        id: bridge.componentIdFor(document.persistentId, element),
        version: expect.any(String),
        element,
      })),
    );
    expect(entry(document, 'asset', 'img-1')).toMatchObject({ kind: 'asset' });
    expect(receipt.written[0]).toEqual({
      kind: 'document',
      id: map.version,
      label: 'Annual report',
      url: `https://acme.alloy.test/#/documents/${document.persistentId}`,
    });
    expect(receipt.written.map((each) => each.kind)).toEqual([
      'document',
      'component',
      'component',
      'component',
      'asset',
    ]);
    expect(document.readBack).toEqual({ ok: true, at: null, detail: null });
    expect(await as((trx) => elementsOf(trx, document.persistentId))).toEqual(
      expect.arrayContaining([
        {
          element: LEAD,
          artifactId: bridge.componentIdFor(document.persistentId, LEAD),
          node: null,
        },
        {
          element: 's1',
          artifactId: bridge.componentIdFor(document.persistentId, 's1'),
          node: bridge.elementIdFor(document.persistentId, 's1'),
        },
        { element: 'img-1', artifactId: entry(document, 'asset', 'img-1').id, node: null },
      ]),
    );
  });

  it('an image the space holds is reused', async () => {
    const bytes = withChunk(PNG, 'c');
    const first = written(await deliver({ images: [checked('img-1', bytes)] }));
    const before = await countArtifacts();
    const two = documentOf({
      sections: [section('s1', 'Method', [figure('f1', 'img-a'), figure('f2', 'img-b')])],
      images: [imageOf('img-a'), imageOf('img-b')],
    });
    const second = written(
      await deliver({ document: two, images: [checked('img-a', bytes), checked('img-b', bytes)] }),
    );
    expect(entry(second, 'asset', 'img-a')).toMatchObject({
      id: entry(first, 'asset', 'img-1').id,
      version: entry(first, 'asset', 'img-1').version,
    });
    expect(entry(second, 'asset', 'img-b').id).toBe(entry(first, 'asset', 'img-1').id);
    // The document and its two components, and no asset.
    expect(await countArtifacts()).toBe(before + 3);
  });

  it('what the mapping refuses is refused before anything is written', async () => {
    const before = await countArtifacts();
    const notes = [
      { marker: '1', inlines: [text('One')] },
      { marker: '1', inlines: [text('Again')] },
    ];
    const answer = await deliver({
      document: documentOf({
        blocks: [
          {
            kind: 'table',
            id: 't1',
            numbered: false,
            caption: [],
            captionPosition: 'above',
            columnWidths: [],
            headerRows: 0,
            rows: [],
            notes,
            wide: false,
            key: null,
          },
        ],
      }),
    });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: { code: 'content_rejected', details: { reason: 'mapping_refused' } },
    });
    expect(await countArtifacts()).toBe(before);
  });

  it('the package fixture is delivered and reads back as it was sent', async () => {
    const path = join(
      dirname(dirname(require.resolve('@kenhayward/bridge-contract'))),
      'test',
      'fixtures',
      'package-decomposed.json',
    );
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as {
      document: DecomposedDocument;
      images: { id: string; content: string }[];
    };
    const images = fixture.images.map((image) =>
      checked(
        image.id,
        Uint8Array.from(atob(image.content), (c) => c.charCodeAt(0)),
      ),
    );
    const receipt = written(await deliver({ document: fixture.document, images }));
    expect(receipt.readBack).toEqual({ ok: true, at: null, detail: null });
  });

  let defined = false;
  /** A template of the space, its document fields Title and Pages; the definitions made once. */
  const templateOf = (over: { requires?: string[]; parameters?: unknown[] } = {}) =>
    as(async (trx) => {
      if (!defined) {
        defined = true;
        for (const [id, dataType] of [
          [TITLE_FIELD, 'text'],
          [PAGES_FIELD, 'number'],
        ] as const) {
          await createArtifact(trx, {
            author: ada,
            substance: {
              kind: 'field',
              content: {
                schemaVersion: DEFINITION_SCHEMA_VERSION,
                id,
                name: id,
                dataType,
                multiplicity: 'one',
                validation: {},
              },
            },
          });
        }
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'metadataSchema',
            content: {
              schemaVersion: DEFINITION_SCHEMA_VERSION,
              id: SCHEMA,
              name: 'Report',
              entries: [
                { field: TITLE_FIELD, required: false, fixed: false },
                { field: PAGES_FIELD, required: false, fixed: false },
              ],
            },
          },
        });
      }
      const made = await createTemplate(trx, {
        spaceId: space,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [{ schema: SCHEMA, level: 'document', requires: over.requires ?? [] }],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
          ...(over.parameters === undefined ? {} : { parameters: over.parameters }),
        },
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.template;
    });

  it('properties fill the fields of the template the space delivers with', async () => {
    const template = await templateOf();
    const answer = await deliver({
      settings: {
        ...settings,
        template: template.id,
        propertyMap: { Title: TITLE_FIELD, Pages: PAGES_FIELD },
      },
      document: documentOf({
        properties: [
          { name: 'Title', value: 'Annual report', origin: 'core' },
          { name: 'Pages', value: 'twelve', origin: 'custom' },
          { name: 'Author', value: 'Grace', origin: 'core' },
        ],
      }),
    });
    if (answer.answer !== 'written') throw new Error(JSON.stringify(answer.error));
    const id = answer.receipt.document!.persistentId;
    expect((await latest(id))!.values).toEqual({ [TITLE_FIELD]: 'Annual report' });
    expect(await as((trx) => documentTemplate(trx, id))).toMatchObject({ template: template.id });
    expect(answer.carried.map((each) => [each.code, each.element])).toEqual(
      expect.arrayContaining([
        ['property_unconverted', 'Pages'],
        ['property_unlisted', 'Author'],
      ]),
    );
  });

  it('API-069 a component re-sent after a person edited it outside expected is refused', async () => {
    const receipt = written(await deliver());
    const fewer = documentOf();
    fewer.sections = fewer.sections.slice(0, 1);
    const second = written(await deliver({ document: fewer, update: updateOf(receipt) }));
    const s2 = entry(receipt, 'component', 's2');
    const edited = await edit(s2.id, (current) => ({
      ...(current.content as object),
      title: 'Kept and edited in Alloy Works',
    }));
    const answer = await deliver({ update: updateOf(second) });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: {
        code: 'changed_in_target',
        details: { changed: [{ id: s2.id, expected: s2.version, actual: edited.id }] },
      },
    });
    expect((await latest(s2.id))!.id).toBe(edited.id);
    expect((await latest(second.persistentId))!.id).toBe(entry(second, 'map', null).version);

    // Untouched since, it is sent again and written.
    const other = written(await deliver());
    const without = written(await deliver({ document: fewer, update: updateOf(other) }));
    const back = written(await deliver({ update: updateOf(without) }));
    expect(entry(back, 'component', 's2').version).toBe(entry(other, 'component', 's2').version);
  });

  it('a component deleted in Alloy Works refuses with component_deleted', async () => {
    const receipt = written(await deliver());
    const fewer = documentOf();
    fewer.sections = fewer.sections.slice(0, 1);
    const second = written(await deliver({ document: fewer, update: updateOf(receipt) }));
    const s2 = entry(receipt, 'component', 's2');
    expect(await as((trx) => deleteArtifact(trx, s2.id, ada))).toMatchObject({
      answer: 'deleted',
    });
    expect(await deliver({ update: updateOf(second) })).toMatchObject({
      answer: 'refused',
      error: {
        code: 'content_rejected',
        details: { reason: 'component_deleted', component: s2.id },
      },
    });
    expect((await latest(second.persistentId))!.id).toBe(entry(second, 'map', null).version);
  });

  it('a component type the environment does not hold refuses, writing nothing', async () => {
    const before = await countArtifacts();
    expect(await deliver({ settings: { ...settings, componentType: randomUUID() } })).toMatchObject(
      {
        answer: 'refused',
        error: { code: 'content_rejected', details: { reason: 'component_type_missing' } },
      },
    );
    expect(await countArtifacts()).toBe(before);
  });

  it('a template the delivery cannot use refuses with template_unresolved', async () => {
    const before = await countArtifacts();
    expect(await deliver({ settings: { ...settings, template: randomUUID() } })).toMatchObject({
      answer: 'refused',
      error: { code: 'content_rejected', details: { reason: 'template_unresolved' } },
    });
    expect(await countArtifacts()).toBe(before);
    const parameterised = await templateOf({
      parameters: [
        {
          name: 'site',
          type: { base: 'text' },
          required: true,
          list: false,
          changeable: false,
          feeds: { field: TITLE_FIELD, arguments: false },
        },
      ],
    });
    const after = await countArtifacts();
    expect(await deliver({ settings: { ...settings, template: parameterised.id } })).toMatchObject({
      answer: 'refused',
      error: { code: 'content_rejected', details: { reason: 'template_unresolved' } },
    });
    expect(await countArtifacts()).toBe(after);
  });

  it('a required field left without a value refuses with metadata_incomplete', async () => {
    const template = await templateOf({ requires: [TITLE_FIELD] });
    const before = await countArtifacts();
    const withTemplate = {
      ...settings,
      template: template.id,
      propertyMap: { Title: TITLE_FIELD },
    };
    expect(await deliver({ settings: withTemplate })).toMatchObject({
      answer: 'refused',
      error: {
        code: 'content_rejected',
        details: { reason: 'metadata_incomplete', fields: [TITLE_FIELD] },
      },
    });
    expect(await countArtifacts()).toBe(before);
    const filled = await deliver({
      settings: withTemplate,
      document: documentOf({ properties: [{ name: 'Title', value: 'Annual', origin: 'core' }] }),
    });
    expect(filled.answer).toBe('written');
  });

  it('content the model refuses is refused with content_invalid, writing nothing', async () => {
    const before = await countArtifacts();
    const cell = {
      rowSpan: 0,
      colSpan: 1,
      hAlign: 'left' as const,
      vAlign: 'top' as const,
      header: false,
      blocks: [para('c1', 'A')],
    };
    const answer = await deliver({
      document: documentOf({
        sections: [
          section('s1', 'Method', [
            {
              kind: 'table',
              id: 't1',
              numbered: false,
              caption: [],
              captionPosition: 'above',
              columnWidths: [],
              headerRows: 0,
              rows: [{ cells: [cell] }],
              notes: [],
              wide: false,
              key: null,
            },
          ]),
        ],
        images: [],
      }),
      images: [],
    });
    expect(answer).toMatchObject({
      answer: 'refused',
      error: { code: 'content_rejected', details: { reason: 'content_invalid', element: 's1' } },
    });
    expect(await countArtifacts()).toBe(before);
  });

  it('an archived space answers not_found, writing nothing', async () => {
    const archived = await as(async (trx) => {
      const made = await createSpace(trx, `Archived ${randomUUID()}`);
      await archiveSpace(trx, made.id, ada);
      return made.id;
    });
    const before = await countArtifacts();
    expect(
      await deliver({ spaceId: archived, settings: { ...settings, spaceId: archived } }),
    ).toMatchObject({ answer: 'refused', error: { class: 'needs_user', code: 'not_found' } });
    expect(await countArtifacts()).toBe(before);
  });

  it('a document in another space is refused document_in_another_space, writing nothing', async () => {
    const receipt = written(await deliver());
    const elsewhere = await as(async (trx) => (await createSpace(trx, `Other ${randomUUID()}`)).id);
    const before = await countArtifacts();
    expect(
      await deliver({
        spaceId: elsewhere,
        settings: { ...settings, spaceId: elsewhere },
        update: updateOf(receipt),
      }),
    ).toMatchObject({
      answer: 'refused',
      error: {
        class: 'needs_user',
        code: 'content_rejected',
        details: { reason: 'document_in_another_space' },
      },
    });
    expect(await countArtifacts()).toBe(before);
    expect((await latest(receipt.persistentId))!.id).toBe(entry(receipt, 'map', null).version);
  });

  it('an image the document never names is neither stored nor listed, and is reported', async () => {
    const unnamed = withChunk(PNG, 'unnamed');
    const answer = await deliver({ images: [checked('img-1'), checked('img-x', unnamed)] });
    if (answer.answer !== 'written') throw new Error(JSON.stringify(answer.error));
    const document = answer.receipt.document!;
    expect(document.components.some((each) => each.element === 'img-x')).toBe(false);
    expect(answer.receipt.written.filter((each) => each.kind === 'asset')).toHaveLength(1);
    expect(answer.carried).toContainEqual({ code: 'image_unreferenced', element: 'img-x' });
    const key = `${tenant.role}/sha256/${createHash('sha256').update(unnamed).digest('hex')}`;
    expect(stored.has(key)).toBe(false);
  });
});

const LEAD = '~lead';

/**
 * The PNG with a private ancillary chunk of these bytes before its end, so each test has an image of
 * its own: the same pixel, other bytes, another hash.
 */
function withChunk(png: Uint8Array, words: string): Uint8Array {
  const end = png.length - 12;
  const data = new TextEncoder().encode(words);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode('teXt'), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return Uint8Array.from([...png.subarray(0, end), ...chunk, ...png.subarray(end)]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
