import { createHash } from 'node:crypto';
import {
  createComponent,
  createConnection,
  createDocument,
  createJobQueue,
  createQueryDefinition,
  createTenant,
  createTenantDatabase,
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
import { readPaint as readGlyphs } from '@alloy-works/conformance';
import {
  bindingDigestInput,
  canonicalResultBytes,
  defaultLimits,
  type CanonicalResult,
  type CanonicalValue,
  type ContentDocument,
  type OutlineDocument,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { strFromU8, unzipSync } from 'fflate';
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
 * **A bound table published** (the TB1 plan, task 6): its result read from the store by its checksum,
 * laid out by the binding stage, and set by template 16 in the PDF and by the Word writer, with
 * `provenance.json` beside them.
 */

const NODE = 'n'.repeat(26);
const READING = { base: 'decimal', precision: 10, scale: 2 } as const;
const COLUMNS = [
  { name: 'site', from: { column: 'site_code' }, type: { base: 'text' } },
  { name: 'reading', from: { column: 'reading_kpa' }, type: READING },
] as const;
/** Figure and punctuation spaces: the characters alignment by padding would add. */
const FIGURE_SPACES = new RegExp(`[${String.fromCodePoint(0x2007, 0x2008)}]`, 'u');
const LONG_SITE = 'North-east gauging station at the river mouth, by the old ferry steps';
const log: WorkerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };
/** The check each publication queues, passed over: this suite runs veraPDF where it asks. */
const passOver: JobHandler = { run: async () => undefined, failed: async () => undefined };
const text = (value: string) => ({ type: 'text', value, marks: [] });
/** Each Word table's cells, row by row, as the text each prints. */
const wordCells = (docx: Uint8Array): string[][][] => {
  const xml = strFromU8(unzipSync(docx)['word/document.xml']!);
  const said = (part: string) =>
    [...part.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join('');
  return [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(([, table]) =>
    [...table!.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map(([, row]) =>
      [...row!.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(([, cell]) => said(cell!)),
    ),
  );
};
/** Each Word paragraph's text, in order. */
const wordParagraphs = (docx: Uint8Array): string[] =>
  [...strFromU8(unzipSync(docx)['word/document.xml']!).matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(
    ([, paragraph]) =>
      [...paragraph!.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(''),
  );

describe('publishing a document holding a bound table', () => {
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
  const work = () => {
    const publish = publishJob({ db: worker, stores, typst, fonts });
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

  /** A bound table's binding, the whole result: an inline binding's members, no take. */
  const whole = (id: string) => ({
    type: 'binding' as const,
    id,
    query: query.id,
    parameters: { site: { literal: 'north' } },
    mode: 'checked' as const,
  });

  /**
   * A document whose one component holds these blocks, each binding's result stored and resolved in
   * the document as `results` gives it.
   */
  const documentHolding = (blocks: unknown[], results: Record<string, CanonicalValue[][]>) =>
    within(async (trx) => {
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
        content: blocks,
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
      for (const [binding, rows] of Object.entries(results)) {
        const result: CanonicalResult = {
          columns: [
            ['site', 'text'],
            ['reading', 'decimal'],
          ],
          rows,
        };
        const bytes = Buffer.from(canonicalResultBytes(result), 'utf8');
        const checksum = createHash('sha256').update(bytes).digest('hex');
        await (await stores.forTenant(trx, tenant)).put(bytes, 'application/json');
        const dataset = await recordDatasetVersion(trx, {
          author: ada,
          provenance: {
            schemaVersion: 1,
            queryDefinition: { artifact: query.id, version: query.version.id },
            connection: { artifact: connection.id, version: connection.version.id },
            parameters: { site: 'north' },
            ran: { sql: 'select site, reading from gauges' },
            identity: { kind: 'service' },
            at: '2026-10-07T09:00:00.000Z',
            durationMs: 7,
            rowCount: rows.length,
            columns: [...COLUMNS],
            canonical: 1,
            checksum,
            images: {},
          },
        });
        await nameDataset(trx, { dataset: dataset.dataset.id, name: 'Gauge readings', by: ada });
        await recordResolution(trx, {
          document: document.version.artifactId,
          node: NODE,
          binding,
          digest: sha256Hex(bindingDigestInput(whole(binding))),
          version: dataset.version.id,
          replaces: null,
          act: 'resolve',
          by: ada,
        });
      }
      return version.version;
    });

  const ask = (version: { artifactId: string; id: string }, formats: string[]) =>
    within(async (trx) => {
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats,
        requester: ada,
        kind: 'publish',
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
        .select(['o.format', 'o.object_key'])
        .where('p.request_id', '=', request)
        .execute(),
    );
  const bytesOf = async (key: string) =>
    (await within((trx) => stores.forTenant(trx, tenant))).get(key);

  /** The readings, its site column not wrapping, its negatives in parentheses and coloured. */
  const readings = {
    type: 'boundTable',
    id: 't1',
    style: 'table',
    binding: { id: 'rows' },
    caption: [text('Readings by site')],
    columns: [
      { column: 'site', header: 'Site', wrap: false },
      {
        column: 'reading',
        header: 'Reading',
        unit: { text: 'kPa', place: 'header' },
        format: { negative: 'parentheses', negativeColour: true },
      },
    ],
    headerColumn: false,
    source: [text('Gauge survey, spring')],
  };
  /** A table of no rows its definition declares valid, its first column heading each row. */
  const quiet = {
    type: 'boundTable',
    id: 't2',
    style: 'table',
    binding: { id: 'none' },
    caption: [text('Readings from the quiet sites')],
    columns: [
      { column: 'site', header: 'Site' },
      { column: 'reading', header: 'Reading' },
    ],
    headerColumn: true,
    empty: [text('No quiet site reported.')],
  };
  const withBinding = <T extends { binding: { id: string } }>(table: T) => ({
    ...table,
    binding: whole(table.binding.id),
  });

  let published: {
    pdf: Buffer;
    docx: Uint8Array;
    provenance: { values: { block: string; table?: unknown }[] };
  };

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
          title: 'Readings by site',
          description: '',
          connection: connection.id,
          parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
          fetch: { kind: 'sql', text: 'select site, reading from gauges where site = {{site}}' },
          columns: [...COLUMNS],
          key: ['site'],
          order: [{ column: 'site', direction: 'ascending' }],
          empty: 'valid',
          limits: { ...defaultLimits },
          retired: false,
        },
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      query = defined.definition;
    });

    // One publication every test below reads: the readings and the quiet table, in the PDF and Word.
    const version = await documentHolding(
      [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [text('The readings follow.')],
        },
        withBinding(readings),
        withBinding(quiet),
      ],
      {
        rows: [
          [LONG_SITE, '1.11'],
          ['South', '3.45'],
          ['West', '-2.5'],
        ],
        none: [],
      },
    );
    const request = await ask(version, ['pdf', 'docx']);
    expect(await work()).toBe('done');
    const outputs = await outputsOf(request);
    const of = (format: string) =>
      bytesOf(outputs.find((each) => each.format === format)!.object_key);
    published = {
      pdf: await of('pdf'),
      docx: new Uint8Array(await of('docx')),
      provenance: JSON.parse((await of('provenance')).toString('utf8')),
    };
  }, 240_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('DAT-028 publishes a block binding as one tagged table with its header row, and the same characters in every cell in the PDF and in Word', async () => {
    const read = await readPdf(published.pdf);
    // Two tables, each one Table with one header row, the empty one's statement a data cell.
    expect(read.elements['Table']).toBe(2);
    const cells = read.reading.filter((each) => each.role === 'TH' || each.role === 'TD');
    const expected = [
      ['Site', 'Reading (kPa)'],
      [LONG_SITE, '1.11'],
      ['South', '3.45'],
      ['West', '(2.50)'],
    ];
    // A header the narrow column wraps is read back without the space its line broke at, so the PDF's
    // text is compared with its spaces out; Word's below with every character.
    const bare = (said: string) => said.replace(/\s+/g, '');
    expect(cells.map((each) => bare(each.text))).toEqual(
      [...expected.flat(), 'Site', 'Reading', 'No quiet site reported.'].map(bare),
    );
    expect(cells.map((each) => each.role)).toEqual([
      ...['TH', 'TH', 'TD', 'TD', 'TD', 'TD', 'TD', 'TD'],
      ...['TH', 'TH', 'TD'],
    ]);
    // Word's cells print the same characters, row by row.
    expect(wordCells(published.docx)).toEqual([
      expected,
      [['Site', 'Reading'], ['No quiet site reported.']],
    ]);
    expect(await checkPdfUa1(published.pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    expect(await checkOoxml(published.docx)).toEqual([]);
  });

  it("TAB-046 sets a number column's decimal separators at one x in the PDF, a parenthesised negative's among them, by layout and no added character", async () => {
    const paint = await readGlyphs(published.pdf);
    const separatorAt = (value: string) => {
      const run = paint.texts.find((each) => each.text === value);
      if (run === undefined) throw new Error(`no run prints ${value}`);
      return run.x + run.offsets[value.indexOf('.')]!;
    };
    const one = separatorAt('1.11');
    expect(separatorAt('3.45')).toBeCloseTo(one, 2);
    expect(separatorAt('(2.50)')).toBeCloseTo(one, 2);
    // Nothing printed beside the values to align them: a reader meets the value alone.
    const read = await readPdf(published.pdf);
    expect(read.taggedText.flat().join(' ')).not.toMatch(FIGURE_SPACES);
  });

  it("TAB-016 sets a negative in its table style's colour beside its parentheses, and every other value in the text's", async () => {
    const paint = await readGlyphs(published.pdf);
    const fill = (value: string) => paint.texts.find((each) => each.text === value)!.fill;
    expect(fill('(2.50)')).toBe('#c00000');
    expect(fill('1.11')).not.toBe('#c00000');
  });

  it("TAB-035 sets a no-wrap column's cells on one line in the PDF, and w:noWrap on them in Word", async () => {
    const paint = await readGlyphs(published.pdf);
    const words = LONG_SITE.split(' ');
    const lines = new Set(
      paint.texts
        .filter((each) => words.some((word) => each.text.includes(word)) && !each.artifact)
        .filter((each) => each.text.length > 0 && LONG_SITE.includes(each.text.trim()))
        .map((each) => Math.round(each.y * 10)),
    );
    expect(lines.size).toBe(1);
    const xml = strFromU8(unzipSync(published.docx)['word/document.xml']!);
    const [first] = [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(([, table]) => table!);
    const siteCells = [...first!.matchAll(/<w:tr>[\s\S]*?<w:tc>([\s\S]*?)<\/w:tc>/g)];
    expect(siteCells.length).toBe(4);
    for (const [, cell] of siteCells) expect(cell).toContain('<w:noWrap/>');
  });

  it("TAB-027 prints the source beneath its table after the layout's word, in the PDF and in Word", async () => {
    const read = await readPdf(published.pdf);
    const paragraphs = read.reading.filter((each) => each.role === 'P').map((each) => each.text);
    expect(paragraphs).toContain('Source: Gauge survey, spring');
    const said = wordParagraphs(published.docx);
    expect(said).toContain('Source: Gauge survey, spring');
    // After the readings' table, before the quiet table's caption (the last paragraph naming it: the
    // list of tables names it first).
    expect(said.indexOf('Source: Gauge survey, spring')).toBeLessThan(
      said.findLastIndex((each) => each.includes('Readings from the quiet sites')),
    );
  });

  it("DAT-069 publishes an empty result its definition declares valid as its headers and the statement, in the PDF's tags and Word's cells", () => {
    // Read above: the quiet table's header row and its one statement, a data cell across it.
    expect(wordCells(published.docx)[1]).toEqual([
      ['Site', 'Reading'],
      ['No quiet site reported.'],
    ]);
  });

  it("TAB-019 records each printed cell's canonical value in provenance.json beside its column's format and rounding rule", () => {
    const table = published.provenance.values.find((each) => each.block === 't1');
    expect(table).toMatchObject({
      binding: 'rows',
      dataset: { name: 'Gauge readings' },
      table: {
        columns: [
          { name: 'site', header: 'Site', format: {} },
          {
            name: 'reading',
            header: 'Reading (kPa)',
            format: {
              style: 'number',
              rounding: 'halfAwayFromZero',
              negative: 'parentheses',
              negativeColour: true,
            },
          },
        ],
        rows: [
          [
            { printed: LONG_SITE, value: LONG_SITE },
            { printed: '1.11', value: '1.11' },
          ],
          [
            { printed: 'South', value: 'South' },
            { printed: '3.45', value: '3.45' },
          ],
          [
            { printed: 'West', value: 'West' },
            { printed: '(2.50)', value: '-2.5' },
          ],
        ],
      },
    });
    expect(table).not.toHaveProperty('take');
  });

  it('TAB-004 fails a publish whose dataset version lacks a column shown, naming the table and the column, and makes nothing', async () => {
    const version = await documentHolding(
      [
        withBinding({
          ...readings,
          columns: [...readings.columns, { column: 'depth', header: 'Depth' }],
        }),
      ],
      { rows: [['South', '3.45']] },
    );
    const request = await ask(version, ['pdf', 'docx']);
    expect(await work()).toBe('failed');
    expect(await requestOf(request)).toEqual({
      state: 'failed',
      failures: [
        { stage: 'bind', code: 'column_missing', node: NODE, block: 't1', detail: 'depth' },
      ],
    });
    expect(await outputsOf(request)).toEqual([]);
  });
});
