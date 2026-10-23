import { createHash } from 'node:crypto';
import {
  acceptImport,
  createImport,
  createJobQueue,
  createTenant,
  importParts,
  migrate,
  prepareDatabase,
  readAssetVersion,
  readImport,
  readVersion,
  receiveImportFile,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJob } from './jobs/import.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A small Word document built here: a title, a section of two components, a list and a table. */
function report(): Uint8Array {
  const p = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = [
    p('Field notes by Ada', 'Title'),
    p('Some opening words.'),
    p('Methods', 'Heading1'),
    p('Sampling', 'Heading2'),
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Grace</w:t></w:r><w:r><w:t xml:space="preserve"> sampled the pond.</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Nets</w:t></w:r></w:p>`,
    p('Analysis', 'Heading2'),
    `<w:tbl><w:tr><w:tc>${p('Species')}</w:tc><w:tc>${p('Count')}</w:tc></w:tr><w:tr><w:tc>${p('Newt')}</w:tc><w:tc>${p('3')}</w:tc></w:tr></w:tbl>`,
    `<w:p><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>Noted.</w:t></w:r></w:p>`,
  ].join('');
  return zipSync({
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}">` +
        `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>` +
        `</w:styles>`,
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    ),
  });
}

describe('the import job, which reads a file into a proposal (the IM plan, IM-C)', () => {
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

  /** An import filled with these bytes as the service fills one: stored, and its job queued. */
  const imported = async (bytes: Uint8Array, fileName = 'Field notes.docx') => {
    const stored = await store.put(bytes, 'application/octet-stream');
    return service.withTenant(tenant, async (trx) => {
      const made = await createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName,
        fileType: 'docx',
      });
      return (await receiveImportFile(trx, made.id, {
        key: stored.key,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: stored.size,
      }))!;
    });
  };
  const gone = (key: string) =>
    store.get(key).then(
      () => false,
      () => true,
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
    handlers = { import: importJob({ db: worker, stores }) };
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

  it('IMP-001 IMP-003 IMP-004 IMP-007 IMP-017 reads a Word document into a proposal that makes nothing until a person accepts it, then a document of sections and components', async () => {
    const artifacts = () =>
      service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
      );
    const before = await artifacts();
    const made = await imported(report());
    expect(await work()).toBe('done');
    expect(await artifacts()).toEqual(before);
    const read = await service.withTenant(tenant, (trx) => readImport(trx, made.id));
    expect(read).toMatchObject({ state: 'proposed', title: 'Field notes by Ada' });
    const parts = await service.withTenant(tenant, (trx) => importParts(trx, made.id));
    expect(parts.map((part) => [part.kind, part.title, part.reason.rule])).toEqual([
      ['component', 'Introduction', 'beforeFirstHeading'],
      ['section', 'Methods', 'heading'],
      ['component', 'Sampling', 'heading'],
      ['component', 'Analysis', 'heading'],
    ]);
    expect(parts[2]!.blocks.map((block) => block.type)).toEqual(['paragraph', 'list']);
    expect(parts[3]!.blocks.map((block) => block.type)).toEqual(['table', 'paragraph']);
    // What it left out is said, the footnote among it.
    expect(read!.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: 'notYetRead', detail: 'footnote', part: null }),
        expect.objectContaining({ subject: 'pageSetup' }),
      ]),
    );

    const accepted = await service.withTenant(
      tenant,
      (trx) =>
        acceptImport(trx, made.id, {
          by: ada,
          title: read!.title!,
          language: 'en-GB',
          direction: 'ltr',
        }),
      { actorKind: 'person', actor: ada },
    );
    if (accepted.answer !== 'accepted') throw new Error(accepted.answer);
    const outline = substanceOf(accepted.document);
    if (outline.kind !== 'document') throw new Error('not a document');
    expect(outline.content.title).toBe('Field notes by Ada');
    expect(outline.content.nodes.map((node) => node.type)).toEqual(['reference', 'section']);
    const sampling = await service.withTenant(tenant, (trx) =>
      readVersion(trx, accepted.components[1]!.id),
    );
    const content = sampling && substanceOf(sampling);
    if (content?.kind !== 'component') throw new Error('not a component');
    expect(content.content.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', value: 'Grace', marks: [{ type: 'strong' }] },
        { type: 'text', value: ' sampled the pond.' },
      ],
    });
  });

  it("IMP-006 IMP-009 ingests a figure's image as an asset of the space, leaves out one it refuses and one in another format, proposes a comment as a thread, and lists who the file names", async () => {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const drawing = (id: string, descr: string) =>
      `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture" descr="${descr}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: { r: 10, g: 120, b: 40 } },
    })
      .png()
      .toBuffer();
    const bytes = zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>` +
          `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Pond</w:t></w:r></w:p>` +
          drawing('rId9', 'A newt') +
          `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Three newts.</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>` +
          drawing('rId10', 'A broken newt') +
          drawing('rId11', 'A moving newt') +
          `</w:body></w:document>`,
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId9" Type="${R}/image" Target="media/image1.png"/>` +
          `<Relationship Id="rId10" Type="${R}/image" Target="media/image2.png"/>` +
          `<Relationship Id="rId11" Type="${R}/image" Target="media/image3.gif"/></Relationships>`,
      ),
      'word/media/image1.png': new Uint8Array(png),
      'word/media/image2.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      'word/media/image3.gif': strToU8('GIF89a'),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Grace"><w:p><w:r><w:t>Recount them.</w:t></w:r></w:p></w:comment></w:comments>`,
      ),
    });
    const made = await imported(bytes, 'Pond.docx');
    expect(await work()).toBe('done');
    const read = await service.withTenant(tenant, (trx) => readImport(trx, made.id));
    expect(read!.identities).toEqual([{ name: 'Grace', email: null, carries: ['comments'] }]);
    const [part] = await service.withTenant(tenant, (trx) => importParts(trx, made.id));
    const [figure, words, broken] = part!.blocks as unknown as {
      type: string;
      asset?: string;
      alternative?: object;
    }[];
    expect(figure).toMatchObject({ type: 'figure', alternative: { kind: 'own', text: 'A newt' } });
    // Held for the import, not an asset of the space, until it is accepted (IMP-008).
    const uploads = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('asset_upload').select('id').execute(),
    );
    expect(uploads).toEqual([]);
    expect(words!.type).toBe('paragraph');
    // The image the check refused stands as an empty paragraph, and is said.
    expect(broken).toMatchObject({ type: 'paragraph', content: [] });
    expect(part!.threads.map((thread) => [thread.author, thread.text, thread.quote])).toEqual([
      ['Grace', 'Recount them.', 'Three newts.'],
    ]);
    expect(read!.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: 'imageFormat', detail: 'gif', part: null }),
        expect.objectContaining({ subject: 'imageRefused', count: 1, part: null }),
      ]),
    );
    const accepted = await service.withTenant(
      tenant,
      (trx) =>
        acceptImport(trx, made.id, { by: ada, title: 'Pond', language: 'en', direction: 'ltr' }),
      { actorKind: 'person', actor: ada },
    );
    if (accepted.answer !== 'accepted') throw new Error(accepted.answer);
    const placed = (accepted.components[0]!.content as { content: { asset?: string }[] })
      .content[0]!;
    const asset = await service.withTenant(tenant, (trx) => readAssetVersion(trx, placed.asset!));
    expect(asset).toMatchObject({ spaceId: general });
  });

  it('IMP-042 fails a zip bomb leaving nothing behind, and says why', async () => {
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(21 * 1024 * 1024) }, { level: 9 });
    const made = await imported(bomb, 'Bomb.docx');
    expect(await work()).toBe('failed');
    const read = await service.withTenant(tenant, (trx) => readImport(trx, made.id));
    expect(read).toMatchObject({ state: 'failed', failure: 'file_too_large', objectKey: null });
    expect(await gone(made.objectKey!)).toBe(true);
    expect(await service.withTenant(tenant, (trx) => importParts(trx, made.id))).toEqual([]);
  });

  it('IMP-042 ends a read past its time, failing the import', async () => {
    handlers = { import: importJob({ db: worker, stores, budget: { timeMs: 1, memoryMb: 512 } }) };
    try {
      const made = await imported(report(), 'Slow.docx');
      expect(await work()).toBe('failed');
      const read = await service.withTenant(tenant, (trx) => readImport(trx, made.id));
      expect(read).toMatchObject({ state: 'failed', failure: 'file_too_large' });
    } finally {
      handlers = { import: importJob({ db: worker, stores }) };
    }
  });

  it('IMP-042 fails what is not a Word document at all', async () => {
    const made = await imported(strToU8('Ada wrote this in a text editor.'), 'Notes.docx');
    expect(await work()).toBe('failed');
    expect((await service.withTenant(tenant, (trx) => readImport(trx, made.id)))?.failure).toBe(
      'file_unreadable',
    );
  });
});
