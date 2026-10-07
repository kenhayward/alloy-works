import { createHash } from 'node:crypto';
import {
  addCatalogueVersion,
  addThemeVersion,
  createArtifact,
  createComponent,
  createConnection,
  createDocument,
  createJobQueue,
  createQueryDefinition,
  createTenant,
  createTenantDatabase,
  DEFAULT_VALUE_CATALOGUE_ID,
  defaultTheme,
  findRole,
  grant,
  migrate,
  nameDataset,
  prepareDatabase,
  recordDatasetVersion,
  recordResolution,
  recordVersion,
  requestPublication,
  sha256Hex,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase } from '@alloy-works/db/testing';
import {
  bindingDigestInput,
  canonicalResultBytes,
  DEFAULT_CATALOGUE_VERSIONS,
  defaultLimits,
  formatValue,
  type Binding,
  type CanonicalResult,
  type ContentDocument,
  type OutlineDocument,
  type ValueFormats,
} from '@alloy-works/domain';
import { createObjectStores, tenantPrefix, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts, type PinnedFonts } from './fonts.js';
import { publishJob } from './jobs/publish.js';
import { checkOoxml } from './testing/ooxml.js';
import { readPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { processNextBesideChecks } from './testing/work.js';
import { createTypst, typstBinaryPath, type Typst } from './typst.js';
import type { JobHandler, WorkerLog } from './worker.js';

/**
 * The publish's binding stage in the worker (the B3 plan, task 3): each value read from its stored
 * result by its checksum, set as the theme's value catalogue prints it, in the PDF and in Word, and
 * `provenance.json` kept beside them.
 */

const NODE = 'n'.repeat(26);
const SQL_RAN = 'select id, depth from secret_schema.gauge where site = $1';
const VALUE = '-4200.5';
const DEPTH_TYPE = { base: 'decimal', precision: 6, scale: 2 } as const;
const log: WorkerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };
/** The check each publication queues, passed over: veraPDF is not what this suite is about. */
const passOver: JobHandler = { run: async () => undefined, failed: async () => undefined };
/** Every text run of a Word document's body, joined. */
const wordText = (docx: Uint8Array) =>
  [...strFromU8(unzipSync(docx)['word/document.xml']!).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
    .map((match) => match[1])
    .join('');
const spoken = (runs: readonly string[]) => runs.join(' ').replace(/\s+/g, ' ');

/** Formats unlike the default in every separator: what a theme's catalogue gives English text. */
const UNLIKE: ValueFormats = {
  number: { decimal: ',', group: '.', groupFrom: 4, minus: 'U+2212' },
  date: { order: 'dmy', separator: '/', pad: true },
  time: { separator: ':' },
  boolean: { true: 'Ja', false: 'Nein' },
};

describe('publishing a document holding a value', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let fonts: PinnedFonts;
  let typst: Typst;
  let ada: string;
  let general: string;
  let query: { id: string; version: { id: string } };
  let connection: { id: string; version: { id: string } };

  const within = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work);
  const work = (
    over: ObjectStores = stores,
    conditionContent?: (node: string, content: ContentDocument) => ContentDocument,
  ) => {
    const publish = publishJob({
      db: worker,
      stores: over,
      typst,
      fonts,
      ...(conditionContent ? { conditionContent } : {}),
    });
    return processNextBesideChecks(
      {
        queue,
        db: worker,
        handlers: { publish, preview: publish },
        workerId: 'worker-1',
        leaseMs: 60_000,
        log,
      },
      passOver,
    );
  };

  const binding: Binding = {
    type: 'binding',
    id: 'v1',
    query: '',
    parameters: { site: { literal: 'north' } },
    mode: 'checked',
    take: { column: 'depth' },
  } as unknown as Binding;

  /**
   * A document whose one component holds a value in a paragraph, its result recorded and stored -
   * or, where `stored` is false, recorded and never stored - and resolved in the document.
   */
  const documentHoldingAValue = (stored = true) =>
    within(async (trx) => {
      const held: Binding = { ...binding, query: query.id };
      const result: CanonicalResult = {
        columns: [
          ['id', 'integer'],
          ['depth', 'decimal'],
        ],
        // A result never stored is another result, so no earlier test's object answers for it.
        rows: [[stored ? '1' : '2', VALUE]],
      };
      const bytes = Buffer.from(canonicalResultBytes(result), 'utf8');
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (stored) await (await stores.forTenant(trx, tenant)).put(bytes, 'application/json');
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Gauges',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content = {
        ...(made.version.content as ContentDocument),
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [
              { type: 'text', value: 'The depth is ', marks: [] },
              held,
              { type: 'text', value: ' metres.', marks: [] },
            ],
          },
        ],
      } as ContentDocument;
      const component = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { ...substance, content },
      });
      if (component.answer !== 'recorded') throw new Error(component.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The gauge report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const outline: OutlineDocument = {
        ...(document.version.content as OutlineDocument),
        nodes: [
          {
            type: 'reference',
            id: NODE,
            component: made.version.artifactId,
            mode: { kind: 'latest' },
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            children: [],
          },
        ],
      };
      const version = await recordVersion(trx, {
        artifactId: document.version.artifactId,
        openedFrom: document.version.id,
        author: ada,
        substance: { kind: 'document', content: outline },
      });
      if (version.answer !== 'recorded') throw new Error(version.answer);
      const dataset = await recordDatasetVersion(trx, {
        author: ada,
        provenance: {
          schemaVersion: 1,
          queryDefinition: { artifact: query.id, version: query.version.id },
          connection: { artifact: connection.id, version: connection.version.id },
          parameters: { site: 'north' },
          ran: { sql: SQL_RAN },
          identity: { kind: 'service' },
          at: '2026-10-05T09:00:00.000Z',
          durationMs: 7,
          rowCount: 1,
          columns: [
            { name: 'id', from: { column: 'gauge_id' }, type: { base: 'integer' } },
            { name: 'depth', from: { column: 'depth_hidden_column' }, type: DEPTH_TYPE },
          ],
          canonical: 1,
          checksum,
          images: {},
        },
      });
      await nameDataset(trx, { dataset: dataset.dataset.id, name: 'Gauge depths', by: ada });
      await recordResolution(trx, {
        document: document.version.artifactId,
        node: NODE,
        binding: 'v1',
        digest: sha256Hex(bindingDigestInput(held)),
        version: dataset.version.id,
        replaces: null,
        act: 'resolve',
        by: ada,
      });
      return version.version;
    });

  const ask = (
    version: { artifactId: string; id: string },
    formats: string[],
    kind: 'publish' | 'preview' = 'publish',
  ) =>
    within(async (trx) => {
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats,
        requester: ada,
        kind,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });
  const requestOf = (id: string) =>
    within((trx) =>
      trx
        .selectFrom('publication_request')
        .select(['state', 'failures'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
  const outputsOf = (request: string) =>
    within((trx) =>
      trx
        .selectFrom('publication as p')
        .innerJoin('publication_output as o', 'o.publication_id', 'p.id')
        .select([
          'o.format',
          'o.object_key',
          'o.producer',
          'o.producer_version',
          'p.pipeline_version',
        ])
        .where('p.request_id', '=', request)
        .execute(),
    );
  const bytesOf = async (key: string) =>
    (await within((trx) => stores.forTenant(trx, tenant))).get(key);

  beforeAll(async () => {
    fonts = await loadPinnedFonts();
    typst = createTypst({ binary: typstBinaryPath(), fonts });
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
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    await within(async (trx) => {
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
      for (const role of ['Author', 'Publisher']) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      // A source nothing here could reach: the worker reads results from the store alone (DAT-088).
      const made = await createConnection(trx, {
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
      if (made.answer !== 'created') throw new Error(made.answer);
      connection = made.connection;
      const defined = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: {
          schemaVersion: 1,
          title: 'Depth by site',
          description: '',
          connection: connection.id,
          parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
          fetch: {
            kind: 'sql',
            text: 'select id, depth from secret_schema.gauge where site = {{site}} order by id',
          },
          columns: [
            { name: 'id', from: { column: 'gauge_id' }, type: { base: 'integer' } },
            { name: 'depth', from: { column: 'depth_hidden_column' }, type: DEPTH_TYPE },
          ],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          empty: 'valid',
          limits: { ...defaultLimits },
          retired: false,
        },
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      query = defined.definition;
    });
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('DAT-088 reads each value from its stored result, never a source, and fails a result altered in the store by name', async () => {
    const version = await documentHoldingAValue();
    const request = await ask(version, ['pdf']);
    expect(await work()).toBe('done');
    const pdf = (await outputsOf(request)).find((each) => each.format === 'pdf')!;
    const read = await readPdf(await bytesOf(pdf.object_key));
    expect(spoken(read.taggedText.flat())).toContain('The depth is -4,200.50 metres.');

    // The same result, its object altered in the store: the bytes are not its checksum's.
    const altered = await ask(version, ['pdf']);
    const altering: ObjectStores = {
      forTenant: async (trx, owner) => {
        const store = await stores.forTenant(trx, owner);
        return {
          ...store,
          // Every object this job reads is the result: the document places no image.
          get: async (key) =>
            key.startsWith(`${tenantPrefix(owner)}sha256/`)
              ? Buffer.from('{"columns":[["id","integer"],["depth","decimal"]],"rows":[["1","0"]]}')
              : store.get(key),
        };
      },
    };
    expect(await work(altering)).toBe('failed');
    expect(await requestOf(altered)).toEqual({
      state: 'failed',
      failures: [
        { stage: 'bind', code: 'result_unreadable', node: NODE, block: 'p1', detail: 'v1' },
      ],
    });
  });

  it('DAT-046 fails a preview as the publish fails, by name, and makes neither', async () => {
    // A result recorded and never stored: the object is missing, and never comes back.
    const version = await documentHoldingAValue(false);
    const publish = await ask(version, ['pdf']);
    const preview = await ask(version, ['pdf'], 'preview');
    expect(await work()).toBe('failed');
    expect(await work()).toBe('failed');
    const failures = [
      { stage: 'bind', code: 'result_unreadable', node: NODE, block: 'p1', detail: 'v1' },
    ];
    expect(await requestOf(publish)).toEqual({ state: 'failed', failures });
    expect(await requestOf(preview)).toEqual({ state: 'failed', failures });
    expect(await outputsOf(publish)).toEqual([]);
  });

  it('DAT-042 PUB-049 accompanies a publication holding a value with provenance.json, recording what was printed and holding no SQL, connection or column source', async () => {
    const version = await documentHoldingAValue();
    const request = await ask(version, ['pdf', 'docx']);
    expect(await work()).toBe('done');
    const outputs = await outputsOf(request);
    expect(outputs.map((each) => [each.format, each.producer, each.producer_version])).toEqual(
      expect.arrayContaining([['provenance', 'pipeline', '20']]),
    );
    expect(outputs[0]!.pipeline_version).toBe('20');
    const kept = outputs.find((each) => each.format === 'provenance')!;
    const text = (await bytesOf(kept.object_key)).toString('utf8');
    const provenance = JSON.parse(text);
    expect(provenance.values).toMatchObject([
      {
        node: NODE,
        number: '1',
        block: 'p1',
        binding: 'v1',
        printed: '-4,200.50',
        value: VALUE,
        column: { name: 'depth', type: DEPTH_TYPE },
        take: { column: 'depth' },
        dataset: { name: 'Gauge depths', number: expect.stringMatching(/^0\.[1-9]\d*$/) },
        result: { rowCount: 1, parameters: { site: 'north' } },
      },
    ]);
    for (const secret of [
      SQL_RAN,
      'secret_schema',
      'depth_hidden_column',
      'gauge_id',
      connection.id,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('DAT-042 publishes a document whose bound block a condition removes, its provenance.json beside it listing nothing printed', async () => {
    const version = await documentHoldingAValue();
    const request = await ask(version, ['pdf']);
    // The binding is recorded on the request; a condition then takes its block out before binding.
    const removed = (_node: string, content: ContentDocument): ContentDocument =>
      ({
        ...content,
        content: [
          {
            type: 'paragraph',
            id: 'p2',
            style: 'body',
            content: [{ type: 'text', value: 'No depth today.', marks: [] }],
          },
        ],
      }) as ContentDocument;
    expect(await work(stores, removed)).toBe('done');
    const outputs = await outputsOf(request);
    expect(outputs.map((each) => each.format).sort()).toEqual(['pdf', 'provenance']);
    const kept = outputs.find((each) => each.format === 'provenance')!;
    expect(JSON.parse((await bytesOf(kept.object_key)).toString('utf8')).values).toEqual([]);
  });

  it("STY-082 prints a value from the theme's value catalogue alone, the same in the PDF and in Word, under formats unlike the default", async () => {
    // The default theme's next version names a value catalogue giving English text other formats.
    await within(async (trx) => {
      const catalogue = await addCatalogueVersion(trx, {
        artifactId: DEFAULT_VALUE_CATALOGUE_ID,
        openedFrom: DEFAULT_CATALOGUE_VERSIONS.value,
        author: ada,
        catalogue: {
          schemaVersion: 3,
          kind: 'value',
          formats: (await defaultTheme(trx)).theme.valueCatalogue!.formats,
          byLanguage: [{ language: 'en', formats: UNLIKE }],
        },
      });
      if (catalogue.answer !== 'recorded') throw new Error(catalogue.answer);
      const theme = await defaultTheme(trx);
      const next = await addThemeVersion(trx, {
        artifactId: theme.artifactId,
        openedFrom: theme.versionId,
        author: ada,
        theme: {
          ...theme.content,
          catalogues: { ...theme.content.catalogues, value: catalogue.version.id },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
    });
    const printed = formatValue(VALUE, DEPTH_TYPE, UNLIKE);
    expect(printed).toBe(`${String.fromCodePoint(0x2212)}4.200,50`);

    const version = await documentHoldingAValue();
    const request = await ask(version, ['pdf', 'docx']);
    expect(await work()).toBe('done');
    const outputs = await outputsOf(request);
    const pdf = await bytesOf(outputs.find((each) => each.format === 'pdf')!.object_key);
    const docx = await bytesOf(outputs.find((each) => each.format === 'docx')!.object_key);
    expect(spoken((await readPdf(pdf)).taggedText.flat())).toContain(
      `The depth is ${printed} metres.`,
    );
    expect(wordText(docx)).toContain(`The depth is ${printed} metres.`);
    // And Word's own schema finds nothing wrong with a document holding one.
    expect(await checkOoxml(docx)).toEqual([]);
  });

  describe('a bound image (the B6 plan, task 2)', () => {
    const PHOTO_TYPE = {
      base: 'image',
      encoding: 'binary',
      description: { column: 'caption' },
    } as const;
    const IMAGE_COLUMNS = [
      { name: 'site', from: { column: 'site_code' }, type: { base: 'text' } },
      { name: 'photo', from: { column: 'photo_bytes' }, type: PHOTO_TYPE },
      { name: 'caption', from: { column: 'caption_text' }, type: { base: 'text' } },
    ] as const;
    const NORTH_SAYS = 'The north gate, open';
    let photos: { id: string; version: { id: string } };
    let north: { bytes: Buffer; hash: string; asset: string; key: string };
    let south: { bytes: Buffer; hash: string; asset: string; key: string };

    /** A PNG of one colour, kept in the store and admitted as an asset version, as D8 admits one. */
    const admitted = (trx: TenantTransaction, colour: { r: number; g: number; b: number }) =>
      (async () => {
        const bytes = await sharp({
          create: { width: 80, height: 60, channels: 3, background: colour },
        })
          .png()
          .toBuffer();
        const kept = await (await stores.forTenant(trx, tenant)).put(bytes, 'image/png');
        const asset = await createArtifact(trx, {
          spaceId: general,
          author: ada,
          substance: {
            kind: 'asset',
            content: {
              schemaVersion: 1,
              object: kept.key,
              format: 'png',
              bytes: bytes.length,
              width: 80,
              height: 60,
              orientation: 1,
              colour: 'rgb',
              alpha: false,
              depth: 8,
              resolution: null,
              // A dataset's image carries no description: its definition's column gives one (DAT-097).
              alternative: null,
            },
          },
        });
        return { bytes, hash: kept.sha256, asset: asset.id, key: kept.key };
      })();

    const bound = (id: string, site: string): Binding =>
      ({
        type: 'binding',
        id,
        query: photos.id,
        parameters: {},
        mode: 'checked',
        take: { key: { site }, column: 'photo' },
      }) as Binding;

    /**
     * A document whose one component places `site`'s photo in a line, in a table's cell, as a figure
     * described by its definition and as one its author marked decorative, every binding resolved to
     * one dataset version whose provenance names both photos' asset versions.
     */
    const documentPlacingPhotos = (site: string) =>
      within(async (trx) => {
        const bindings = ['i1', 'i2', 'i3', 'i4'].map((id) => bound(id, site));
        const [inLine, inCell, asFigure, decorative] = bindings as [
          Binding,
          Binding,
          Binding,
          Binding,
        ];
        const made = await createComponent(trx, {
          spaceId: general,
          title: 'Gates',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version);
        if (substance.kind !== 'component') throw new Error('not a component');
        const words = (value: string) => ({ type: 'text', value, marks: [] });
        const paragraph = (id: string, ...content: unknown[]) => ({
          type: 'paragraph',
          id,
          style: 'body',
          content,
        });
        const figure = (id: string, binding: Binding, kind: string) => ({
          type: 'figure',
          id,
          binding,
          imageStyle: 'figure',
          caption: [words(`The gate, ${id}`)],
          alternative: { kind },
        });
        const content = {
          ...(made.version.content as ContentDocument),
          content: [
            paragraph('p1', words('The gate: '), inLine, words('.')),
            {
              type: 'table',
              id: 't1',
              style: 'table',
              caption: [words('Gates')],
              headerRows: 0,
              headerColumns: 0,
              rows: [
                {
                  cells: [
                    { content: [paragraph('c1', words('Gate'))], colspan: 1, rowspan: 1 },
                    { content: [paragraph('c2', inCell)], colspan: 1, rowspan: 1 },
                  ],
                },
              ],
            },
            figure('f1', asFigure, 'inherited'),
            figure('f2', decorative, 'decorative'),
          ],
        } as ContentDocument;
        const component = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: ada,
          substance: { ...substance, content },
        });
        if (component.answer !== 'recorded') throw new Error(component.answer);
        const document = await createDocument(trx, {
          spaceId: general,
          title: 'The gate report',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (document.answer !== 'created') throw new Error(document.answer);
        const outline: OutlineDocument = {
          ...(document.version.content as OutlineDocument),
          nodes: [
            {
              type: 'reference',
              id: NODE,
              component: made.version.artifactId,
              mode: { kind: 'latest' },
              numbered: true,
              matter: 'body',
              pageBreak: 'none',
              values: {},
              children: [],
            },
          ],
        };
        const version = await recordVersion(trx, {
          artifactId: document.version.artifactId,
          openedFrom: document.version.id,
          author: ada,
          substance: { kind: 'document', content: outline },
        });
        if (version.answer !== 'recorded') throw new Error(version.answer);
        const result: CanonicalResult = {
          columns: [
            ['site', 'text'],
            ['photo', 'image'],
            ['caption', 'text'],
          ],
          rows: [
            ['north', north.hash, NORTH_SAYS],
            ['south', south.hash, null],
          ],
        };
        const bytes = Buffer.from(canonicalResultBytes(result), 'utf8');
        await (await stores.forTenant(trx, tenant)).put(bytes, 'application/json');
        const dataset = await recordDatasetVersion(trx, {
          author: ada,
          images: [north.hash, south.hash],
          provenance: {
            schemaVersion: 1,
            queryDefinition: { artifact: photos.id, version: photos.version.id },
            connection: { artifact: connection.id, version: connection.version.id },
            parameters: {},
            ran: { sql: 'select site_code, photo_bytes, caption_text from secret_schema.gate' },
            identity: { kind: 'service' },
            at: '2026-10-06T09:00:00.000Z',
            durationMs: 9,
            rowCount: 2,
            columns: IMAGE_COLUMNS.map((column) => ({ ...column })),
            canonical: 1,
            checksum: createHash('sha256').update(bytes).digest('hex'),
            images: { [north.hash]: north.asset, [south.hash]: south.asset },
          },
        });
        for (const binding of bindings) {
          await recordResolution(trx, {
            document: document.version.artifactId,
            node: NODE,
            binding: binding.id,
            digest: sha256Hex(bindingDigestInput(binding)),
            version: dataset.version.id,
            replaces: null,
            act: 'resolve',
            by: ada,
          });
        }
        return version.version;
      });

    beforeAll(async () => {
      await within(async (trx) => {
        north = await admitted(trx, { r: 20, g: 120, b: 40 });
        south = await admitted(trx, { r: 120, g: 20, b: 140 });
        const defined = await createQueryDefinition(trx, {
          author: ada,
          spaceId: general,
          definition: {
            schemaVersion: 1,
            title: 'Gate photos',
            description: '',
            connection: connection.id,
            parameters: [],
            fetch: {
              kind: 'sql',
              text: 'select site_code, photo_bytes, caption_text from secret_schema.gate',
            },
            columns: IMAGE_COLUMNS.map((column) => ({ ...column })),
            key: ['site'],
            order: 'multiset',
            empty: 'valid',
            limits: { ...defaultLimits },
            retired: false,
          },
        });
        if (defined.answer !== 'created') throw new Error(defined.answer);
        photos = defined.definition;
      });
    });

    it("DAT-098 DAT-097 places a bound image in a line, in a table's cell and as a figure, printed from its asset version's bytes and described by its definition's column, a decorative one an artifact, in the PDF and in Word", async () => {
      const version = await documentPlacingPhotos('north');
      const request = await ask(version, ['pdf', 'docx']);
      // Every object the job reads, so it can be seen that the photo it did not place is never read.
      const read: string[] = [];
      const watched: ObjectStores = {
        forTenant: async (trx, owner) => {
          const store = await stores.forTenant(trx, owner);
          return { ...store, get: async (key) => (read.push(key), store.get(key)) };
        },
      };
      expect(await work(watched)).toBe('done');
      expect(read).toContain(north.key);
      expect(read).not.toContain(south.key);
      const outputs = await outputsOf(request);
      const pdf = await bytesOf(outputs.find((each) => each.format === 'pdf')!.object_key);
      const docx = await bytesOf(outputs.find((each) => each.format === 'docx')!.object_key);

      // The PDF: three `Figure`s - the image in its line, the one in its cell and the figure - each
      // read as the row's description; the decorative figure is an artifact, no `Figure` at all.
      expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
      const tagged = await readPdf(pdf);
      expect(tagged.figures.map(({ alt }) => alt)).toEqual([NORTH_SAYS, NORTH_SAYS, NORTH_SAYS]);

      // Word: four pictures, each the asset's own bytes; three described by the row's description,
      // and the decorative one flagged so and described by nothing.
      const parts = unzipSync(docx);
      const media = Object.keys(parts).filter((name) => name.startsWith('word/media/'));
      expect(media.length).toBeGreaterThan(0);
      for (const name of media)
        expect(Buffer.from(parts[name]!).equals(north.bytes), name).toBe(true);
      const body = strFromU8(parts['word/document.xml']!);
      const pictures = [...body.matchAll(/<wp:docPr [^>]*>/g)].map((match) => match[0]);
      expect(pictures).toHaveLength(4);
      expect(pictures.filter((each) => each.includes(`descr="${NORTH_SAYS}"`))).toHaveLength(3);
      expect(pictures.filter((each) => !each.includes('descr='))).toHaveLength(1);
      expect(body.match(/adec:decorative/g)).toHaveLength(1);
      expect(await checkOoxml(docx)).toEqual([]);
    }, 120_000);

    it('DAT-042 records each bound image in provenance.json, at its schema 3 since TB1.2: its hash, its asset version and its description', async () => {
      const version = await documentPlacingPhotos('north');
      const request = await ask(version, ['pdf']);
      expect(await work()).toBe('done');
      const kept = (await outputsOf(request)).find((each) => each.format === 'provenance')!;
      const provenance = JSON.parse((await bytesOf(kept.object_key)).toString('utf8'));
      expect(provenance.schemaVersion).toBe(3);
      expect(provenance.values).toMatchObject(
        [
          ['p1', 'i1', NORTH_SAYS],
          ['c2', 'i2', NORTH_SAYS],
          ['f1', 'i3', NORTH_SAYS],
          // The figure its author marked decorative is recorded so (Ken, 2026-10-06).
          ['f2', 'i4', 'decorative'],
        ].map(([block, binding, description]) => ({
          node: NODE,
          block,
          binding,
          image: { hash: north.hash, assetVersion: north.asset },
          description,
          column: { name: 'photo', type: PHOTO_TYPE },
          take: { key: { site: 'north' }, column: 'photo' },
        })),
      );
      for (const value of provenance.values) {
        expect(value).not.toHaveProperty('printed');
        expect(value).not.toHaveProperty('value');
      }
    }, 120_000);

    it('DAT-097 fails a publish and a preview of a bound image whose description is missing by name, naming every binding, its block and the column, and makes neither', async () => {
      const version = await documentPlacingPhotos('south');
      const publish = await ask(version, ['pdf', 'docx']);
      const preview = await ask(version, ['pdf'], 'preview');
      expect(await work()).toBe('failed');
      expect(await work()).toBe('failed');
      // Every place nothing marks decorative; the figure its author marked so, f2, needs none (Ken).
      const failures = [
        ['p1', 'i1'],
        ['c2', 'i2'],
        ['f1', 'i3'],
      ].map(([block, binding]) => ({
        stage: 'bind',
        code: 'image_description_missing',
        node: NODE,
        block,
        detail: `${binding}: caption`,
      }));
      expect(await requestOf(publish)).toEqual({ state: 'failed', failures });
      expect(await requestOf(preview)).toEqual({ state: 'failed', failures });
      expect(await outputsOf(publish)).toEqual([]);
    }, 120_000);
  });
});
