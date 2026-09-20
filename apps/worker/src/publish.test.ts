import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createJobQueue,
  createSpace,
  createTenant,
  createTenantDatabase,
  defaultLayout,
  findRole,
  grant,
  migrate,
  provisionTenant,
  publicationInputs,
  recordVersion,
  requestPublication,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  assemble,
  blockIdentifierFrom,
  DRAFT_NOTICE,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, loadPinnedFonts, PINNED_FONT_FILES, type PinnedFonts } from './fonts.js';
import { publishJob } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { checkPdfUa1, type VeraPdfVerdict } from './testing/verapdf.js';
import { createTypst, typstBinaryPath, type Typst } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
/** Enough paragraphs that the publication runs to several pages. */
const LONG = Array.from(
  { length: 80 },
  (_, index) =>
    `Step ${index + 1}. Set the tray, and calibrate it before every run of the press, as Ada and Grace agreed when they wrote the procedure.`,
);

/**
 * What a reader's text extraction gives back of some text runs, as one string. A sentence the page
 * wraps comes back as one run per line, so it is joined before it is looked for.
 */
const spoken = (runs: readonly string[]) => runs.join(' ').replace(/\s+/g, ' ').trim();
const occurrencesOf = (text: string, within: string) => within.split(text).length - 1;

describe('publishing a document, from the request to the stored PDF', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let fonts: PinnedFonts;
  let typst: Typst;
  let handlers: Record<string, JobHandler>;
  let ada: string;
  let general: string;
  let quality: string;
  const logged: object[] = [];
  const log: WorkerLog = {
    info: (details) => logged.push(details),
    warn: (details) => logged.push(details),
    error: (details) => logged.push(details),
  };

  const work = (over: Partial<Parameters<typeof processNext>[0]> = {}) =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 60_000,
      log,
      ...over,
    });

  /** The queue, retrying at once rather than after its back-off. */
  const eager = (): JobQueue => ({
    ...queue,
    fail: (job, reason) => queue.fail(job, reason, { retryInMs: 0 }),
  });

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A component in a space, at a second version holding these paragraphs; answers its id. */
  const component = async (
    trx: TenantTransaction,
    space: string,
    title: string,
    paragraphs: string[],
  ) => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const substance = substanceOf(made.version);
    if (substance.kind !== 'component') throw new Error('not a component');
    const content: ContentDocument = {
      schemaVersion: 1,
      title,
      language: 'en-GB',
      direction: 'ltr',
      content: paragraphs.map((text, index) => ({
        type: 'paragraph',
        id: `p${index + 1}`,
        style: 'body',
        content: [{ type: 'text', value: text, marks: [] }],
      })),
    };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { ...substance, content },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version.artifactId;
  };

  const documentWith = async (trx: TenantTransaction, nodes: OutlineNode[]) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const section = (title: string, children: OutlineNode[]): OutlineNode => ({
    type: 'section',
    id: nodeId(),
    title: [{ type: 'text', value: title, marks: [] }],
    ...base,
    children,
  });
  const reference = (component: string): OutlineNode => ({
    type: 'reference',
    id: nodeId(),
    component,
    mode: { kind: 'latest' },
    ...base,
    children: [],
  });

  /** Ada asks to publish a document of these nodes; answers the request's id. */
  const requested = (nodes: (trx: TenantTransaction) => Promise<OutlineNode[]>) =>
    service.withTenant(tenant, async (trx) => {
      const version = await documentWith(trx, await nodes(trx));
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  const requestRow = (id: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication_request')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );

  const publicationOf = (requestId: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication as p')
        .innerJoin('publication_output as o', 'o.publication_id', 'p.id')
        .selectAll()
        .where('p.request_id', '=', requestId)
        .executeTakeFirst(),
    );

  const pdfOf = async (key: string) => {
    const store = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    return store.get(key);
  };

  const publicationCount = () =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('kind', '=', 'publication')
        .executeTakeFirstOrThrow()
        .then((row) => Number(row.n)),
    );

  const jobOf = async (requestId: string) =>
    (
      await queryAs(
        db.adminUrl,
        'select attempts, last_error from platform.job where subject_id = $1',
        [requestId],
      )
    ).rows[0];

  /** A store that will not take anything: every put throws, as an unreachable store would. */
  const refusingStores = (): ObjectStores => ({
    forTenant: async (trx, owner) => ({
      ...(await stores.forTenant(trx, owner)),
      put: async () => {
        throw new Error('the store is down');
      },
    }),
  });

  /**
   * One publication most tests read: two chapters, a component of eighty paragraphs - several pages -
   * and a subsection, one paragraph of which would be Typst source if it were ever evaluated.
   */
  let first:
    | Promise<{
        request: string;
        read: ReadPdf;
        row: Record<string, unknown>;
        verdict: VeraPdfVerdict;
      }>
    | undefined;
  const published = () =>
    (first ??= (async () => {
      const request = await requested(async (trx) => {
        const calibration = await component(trx, general, 'Calibration', [
          ...LONG,
          'Then #panic("x") ] [ * _ $ as words.',
        ]);
        return [
          section('Introduction', [reference(calibration), section('Scope', [])]),
          section('Method', []),
        ];
      });
      if ((await work()) !== 'done') throw new Error('The publish did not finish');
      const row = await publicationOf(request);
      const pdf = await pdfOf(row!.object_key);
      // veraPDF over what the job stored: several pages, a running head on each, and the notice.
      return { request, row: row!, read: await readPdf(pdf), verdict: await checkPdfUa1(pdf) };
    })());

  beforeAll(async () => {
    fonts = await loadPinnedFonts();
    typst = createTypst({ binary: typstBinaryPath(), fonts });
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
    handlers = { publish: publishJob({ db: worker, stores, typst, fonts }) };
    await service.withTenant(tenant, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada authors and publishes in General, and may not read Quality.
      for (const role of ['Author', 'Publisher']) {
        const found = await findRole(trx, role);
        await grant(trx, {
          roleId: found!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
    // The shared publication, made once here: veraPDF's container starts cold in about eleven seconds.
    await published();
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('PUB-021 bookmarks the outline, each heading with the number the outline panel shows', async () => {
    const { read } = await published();
    expect(read.bookmarks).toEqual([
      {
        title: '1 Introduction',
        items: [
          { title: '1.1 Calibration', items: [] },
          { title: '1.2 Scope', items: [] },
        ],
      },
      { title: '2 Method', items: [] },
    ]);
  });

  it('PUB-093 says on every page and once to assistive technology that it is not approved, and its record says so', async () => {
    const { read, row } = await published();
    expect(read.pages).toBeGreaterThan(1);
    // On every page, as an artifact - where no layout can remove it, and a screen reader skips it -
    // once, beside the running heads and feet the layout sets there.
    expect(read.artifactText).toHaveLength(read.pages);
    for (const [index, runs] of read.artifactText.entries()) {
      expect(occurrencesOf(DRAFT_NOTICE.page, spoken(runs)), `page ${index + 1}`).toBe(1);
    }
    // And once where a screen reader reads it: the whole sentence, however the page wraps it.
    expect(occurrencesOf(DRAFT_NOTICE.text, spoken(read.taggedText.flat()))).toBe(1);
    expect(row).toMatchObject({ approval: 'none' });
  });

  it('PUB-061 is always tagged PDF/UA-1, in the document title and language', async () => {
    const { read, row, verdict } = await published();
    expect(verdict).toMatchObject({
      compliant: true,
      profile: 'PDF/UA-1 validation profile',
      failedRules: 0,
    });
    expect(read.marked).toBe(true);
    expect(read.pdfuaPart).toBe('1');
    expect(read.roles[0]).toBe('Document');
    expect(read.roles).toContain('H1');
    expect(read.title).toBe('The dosing report');
    expect(read.language).toBe('en-GB');
    expect(row).toMatchObject({ standard: 'ua-1' });
  });

  it('PUB-062 sets content that would be Typst source as the words it is', async () => {
    const { read } = await published();
    expect(spoken(read.taggedText.flat())).toContain('Then #panic("x") ] [ * _ $ as words.');
  });

  it("PUB-063 records the engine, the engine's version and the template's version that made it", async () => {
    const { request } = await published();
    const row = await publicationOf(request);
    // Made under a layout, so by template 2 and pipeline 2, under the layout its request recorded.
    expect(row).toMatchObject({
      engine: 'typst',
      engine_version: '0.15.1',
      template: 'publication',
      template_version: 2,
      pipeline_version: '2',
      layout_version_id: (await requestRow(request)).layout_version_id,
    });
    expect(row!.layout_version_id).not.toBeNull();
    expect(row!.fonts).toEqual(PINNED_FONT_FILES.map(({ file, sha256 }) => ({ file, sha256 })));
    expect(row!.fonts.map((each) => each.file)).toEqual([
      'LiberationSerif-Bold.ttf',
      'LiberationSerif-BoldItalic.ttf',
      'LiberationSerif-Italic.ttf',
      'LiberationSerif-Regular.ttf',
    ]);
    expect(await requestRow(request)).toMatchObject({ state: 'done', failures: [] });
  });

  it("records the default layout's version on the publication", async () => {
    const { request } = await published();
    const declared = await service.withTenant(tenant, (trx) => defaultLayout(trx));
    expect(await publicationOf(request)).toMatchObject({
      layout_id: declared.artifactId,
      layout_version_id: declared.versionId,
    });
  });

  it('publishes an empty document as its cover alone, under the default layout', async () => {
    const request = await service.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The empty report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      expect((made.version.content as OutlineDocument).nodes).toEqual([]);
      const answer = await requestPublication(trx, {
        documentId: made.version.artifactId,
        version: made.version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });
    expect(await work()).toBe('done');
    const pdf = await pdfOf((await publicationOf(request))!.object_key);
    const read = await readPdf(pdf);

    // The default layout declares a cover, and a contents that would hold nothing and so is not set
    // (decision K): one page, the title and the notice's sentence, the notice above them.
    expect(read.pages).toBe(1);
    expect(spoken(read.taggedText[0]!)).toBe(`The empty report ${DRAFT_NOTICE.text}`);
    expect(spoken(read.artifactText[0]!)).toBe(DRAFT_NOTICE.page);
    // The cover has no label, but here the PDF says so by declaring none: the pinned Typst writes page
    // labels only where some page is numbered, so a cover alone has none, and a reader shows it as 1.
    expect(read.pageLabels).toBeNull();
    expect(await checkPdfUa1(pdf)).toMatchObject({
      compliant: true,
      profile: 'PDF/UA-1 validation profile',
      failedRules: 0,
    });
  }, 120_000);

  it('refuses a publish job with no subject at once, rather than completing it silently', async () => {
    // Nothing enqueues a publish job with no subject; this is the row such a bug would leave.
    await queryAs(
      db.adminUrl,
      "insert into platform.job (tenant_id, kind, subject_id) values ($1, 'publish', null)",
      [tenant.id],
    );
    expect(await work()).toBe('failed');
  });

  it('fails a document with a character no face can set once, with every failure, and logs none of it', async () => {
    logged.length = 0;
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Arabic \u{627} here'])),
      reference(await component(trx, quality, 'Secret', ['Never read'])),
    ]);
    expect(await work()).toBe('failed');
    const row = await requestRow(id);
    expect(row.state).toBe('failed');
    expect((row.failures as { code: string }[]).map((each) => each.code)).toEqual([
      'occurrence_unreadable',
      'glyph_missing',
    ]);
    expect(await publicationOf(id)).toBeUndefined();
    expect(await jobOf(id)).toEqual({ attempts: 1, last_error: 'publish_refused' });
    expect(JSON.stringify(logged)).not.toContain('U+0627');
    expect(JSON.stringify(logged)).not.toContain('\u{627}');
  });

  it('PUB-094 refuses a publish holding a component the publisher may not read, naming its node and nothing of it, and makes no publication', async () => {
    logged.length = 0;
    const hidden: string[] = [];
    const unreadable: string[] = [];
    const id = await requested(async (trx) => {
      const readable = reference(await component(trx, general, 'Scope', ['Set the tray.']));
      hidden.push(await component(trx, quality, 'Calibration', ['Never read']));
      hidden.push(await component(trx, quality, 'Install the printer', ['Never read either']));
      const [first, nested] = hidden.map(reference);
      unreadable.push(first!.id, nested!.id);
      // Two places: one at the top of the outline, and one inside a section.
      return [readable, first!, section('Method', [nested!])];
    });
    const versions = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', 'in', hidden)
        .execute()
        .then((rows) => rows.map((row) => row.id)),
    );
    expect(versions).toHaveLength(4);
    const before = await publicationCount();
    expect(await work()).toBe('failed');
    // After the job, not only at the request: the job writes the request's failures again, from
    // `assemble`'s list, and that list must still say nothing of the component.
    const row = await requestRow(id);
    expect(row.state).toBe('failed');
    // Each place, in outline order, and nothing of either component.
    expect(row.failures).toEqual(
      unreadable.map((node) => ({
        stage: 'resolve',
        code: 'occurrence_unreadable',
        node,
        block: null,
        detail: null,
      })),
    );
    expect(await publicationOf(id)).toBeUndefined();
    expect(await publicationCount()).toBe(before);
    const occurrences = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication_request_occurrence')
        .selectAll()
        .where('request_id', '=', id)
        .execute(),
    );
    // The readable one alone was recorded; the other was never resolved, so never read.
    expect(occurrences).toHaveLength(1);
    const everything = JSON.stringify({ row, occurrences, logged });
    for (const withheld of [...hidden, ...versions, 'Calibration', 'Install the printer']) {
      expect(everything).not.toContain(withheld);
    }
  });

  it('PUB-053 records no publication and no artifact when the store will not take the PDF', async () => {
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
    ]);
    const before = await publicationCount();
    const broken = { publish: publishJob({ db: worker, stores: refusingStores(), typst, fonts }) };
    // The platform's failure: retried, then recorded with its stage and nothing an author could act on.
    expect(await work({ handlers: broken, queue: eager() })).toBe('retry');
    expect(await work({ handlers: broken, queue: eager() })).toBe('retry');
    expect(await work({ handlers: broken, queue: eager() })).toBe('failed');
    expect(await requestRow(id)).toMatchObject({
      state: 'failed',
      failures: [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }],
    });
    expect(await publicationOf(id)).toBeUndefined();
    expect(await publicationCount()).toBe(before);
  });

  it('PUB-086 names the engine stage and the store stage, and no place, when the platform fails', async () => {
    // The engine: a face removed from under a running worker, so every compile stops before Typst
    // starts. The document is not at fault, and nothing in its failure says it is.
    const copy = await mkdtemp(join(tmpdir(), 'aw-fonts-'));
    try {
      await cp(FONT_DIRECTORY, copy, { recursive: true });
      const shrinking = await loadPinnedFonts(copy);
      const faceless = publishJob({
        db: worker,
        stores,
        typst: createTypst({ binary: typstBinaryPath(), fonts: shrinking }),
        fonts: shrinking,
      });
      const engine = await requested(async (trx) => [
        reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
      ]);
      await rm(join(copy, 'LiberationSerif-Bold.ttf'));
      const before = await publicationCount();
      for (const outcome of ['retry', 'retry', 'failed']) {
        expect(await work({ handlers: { publish: faceless }, queue: eager() })).toBe(outcome);
      }
      expect(await jobOf(engine)).toEqual({ attempts: 3, last_error: 'fonts_unavailable' });
      expect(await requestRow(engine)).toMatchObject({
        state: 'failed',
        failures: [
          { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
        ],
      });
      expect(await publicationOf(engine)).toBeUndefined();
      expect(await publicationCount()).toBe(before);
    } finally {
      await rm(copy, { recursive: true, force: true });
    }

    // The store: the PDF was made and could not be kept.
    const store = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
    ]);
    const broken = { publish: publishJob({ db: worker, stores: refusingStores(), typst, fonts }) };
    for (const outcome of ['retry', 'retry', 'failed']) {
      expect(await work({ handlers: broken, queue: eager() })).toBe(outcome);
    }
    expect(await jobOf(store)).toEqual({ attempts: 3, last_error: 'store_failed' });
    expect(await requestRow(store)).toMatchObject({
      state: 'failed',
      failures: [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }],
    });
  });

  it('keeps nothing of a record the database refuses, and fails the request at the store stage', async () => {
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
    ]);
    // A store that keeps the PDF and then answers another digest for it, which the record's key
    // check refuses part way through the record.
    const misreporting: ObjectStores = {
      forTenant: async (trx, owner) => {
        const store = await stores.forTenant(trx, owner);
        return {
          ...store,
          put: async (body, contentType) => ({
            ...(await store.put(body, contentType)),
            sha256: '0'.repeat(64),
          }),
        };
      },
    };
    const before = await publicationCount();
    const refused = { publish: publishJob({ db: worker, stores: misreporting, typst, fonts }) };
    for (const outcome of ['retry', 'retry', 'failed']) {
      expect(await work({ handlers: refused, queue: eager() })).toBe(outcome);
    }
    // The PDF was made; it could not be kept as a publication.
    expect(await jobOf(id)).toEqual({ attempts: 3, last_error: 'store_failed' });
    expect(await requestRow(id)).toMatchObject({
      state: 'failed',
      failures: [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }],
    });
    expect(await publicationOf(id)).toBeUndefined();
    expect(await publicationCount()).toBe(before);
  });

  it('makes the same bytes from what a request recorded, compiled again', async () => {
    const id = await requested(async (trx) => [
      reference(await component(trx, general, 'Calibration', ['Set the tray.'])),
    ]);
    const inputs = await service.withTenant(tenant, (trx) => publicationInputs(trx, id));
    expect(await work()).toBe('done');
    const row = await publicationOf(id);
    const again = assemble({
      outline: inputs!.outline,
      occurrences: new Map([...inputs!.occurrences].map(([node, each]) => [node, each.content])),
      refused: inputs!.refused,
      layout: inputs!.layout?.layout ?? null,
      revision: inputs!.revision,
      covers: fonts.covers,
    });
    if (!again.ok) throw new Error('did not assemble');
    const data = JSON.stringify(again.document);
    // The record names the very bytes Typst read, so a reproduction can tell input from engine.
    expect(row!.data_sha256).toBe(createHash('sha256').update(data).digest('hex'));
    // Compiled again with the template the record names.
    const template =
      PUBLICATION_TEMPLATE[row!.template_version as keyof typeof PUBLICATION_TEMPLATE];
    const bytes = await typst.compile(template.file, data, inputs!.request.requestedAt);
    const stored = await pdfOf(row!.object_key);
    // The output row names the bytes the store holds under its key.
    expect(row!.sha256).toBe(createHash('sha256').update(stored).digest('hex'));
    expect(row!.bytes).toBe(stored.length);
    expect(bytes.equals(stored)).toBe(true);
  });
});

describe('publishing a request made before layouts', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let before: string;
  let fonts: PinnedFonts;
  let typst: Typst;
  const log: WorkerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

  beforeAll(async () => {
    fonts = await loadPinnedFonts();
    typst = createTypst({ binary: typstBinaryPath(), fonts });
    db = await freshDatabase();
    objects = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0017 and none after: where every environment stood before layouts.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0018-'));
    await cp(new URL('../../../packages/db/migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 18;
      },
    });
  }, 120_000);

  afterAll(async () => {
    await objects?.drop();
    await db?.drop();
    if (before) await rm(before, { recursive: true, force: true });
  });

  it('publishes it with template 1 and pipeline 1, as the first slice did, and records no layout', async () => {
    const migrationsDir = pathToFileURL(`${before}/`);
    await migrate(db.migratorUrl, { migrationsDir });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Before layouts' },
      hostnames: ['before.acme.alloy.test'],
    });
    await migrate(db.migratorUrl, { migrationsDir });
    const service = createTenantDatabase(db.serviceUrl);
    const worker = createTenantDatabase(db.workerUrl);
    const queue = createJobQueue(db.workerUrl);
    try {
      // A document of two sections, and a request for it as 0017 took one: no layout, for there was none.
      const version = await service.withTenant(tenant, async (trx) => {
        const ada = await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const general = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const made = await createDocument(trx, {
          spaceId: general.id,
          title: 'The dosing report',
          language: 'en-GB',
          direction: 'ltr',
          author: ada.id,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const titled = (title: string, children: OutlineNode[]): OutlineNode => ({
          type: 'section',
          id: nodeId(),
          title: [{ type: 'text', value: title, marks: [] }],
          ...base,
          children,
        });
        const recorded = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: ada.id,
          substance: {
            kind: 'document',
            content: {
              ...(made.version.content as OutlineDocument),
              nodes: [titled('Introduction', [titled('Scope', [])]), titled('Method', [])],
            },
          },
        });
        if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
        return { ...recorded.version, requester: ada.id };
      });
      const { rows } = await queryAs(
        db.adminUrl,
        `insert into ${tenant.schema}.publication_request
           (document_id, document_version_id, formats, requested_by)
         values ($1, $2, array['pdf'], $3) returning id`,
        [version.artifactId, version.id, version.requester],
      );
      const request = (rows[0] as { id: string }).id;
      await queryAs(
        db.adminUrl,
        "insert into platform.job (tenant_id, kind, subject_id) values ($1, 'publish', $2)",
        [tenant.id, request],
      );

      // Then layouts arrive, and the worker finds the request still queued.
      await migrate(db.migratorUrl);
      await objects.setUp(db.adminUrl, tenant);
      const stores = createObjectStores(objects.settings, objects.sealingKey);
      const inputs = await service.withTenant(tenant, (trx) => publicationInputs(trx, request));
      expect(inputs).toMatchObject({ layout: null });

      expect(
        await processNext({
          queue,
          db: worker,
          handlers: { publish: publishJob({ db: worker, stores, typst, fonts }) },
          workerId: 'worker-1',
          leaseMs: 60_000,
          log,
        }),
      ).toBe('done');

      const published = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('publication')
          .selectAll()
          .where('request_id', '=', request)
          .executeTakeFirstOrThrow(),
      );
      expect(published).toMatchObject({
        template_version: 1,
        pipeline_version: '1',
        layout_id: null,
        layout_version_id: null,
      });
      // What Typst read was slice 1's `publishing/1`, under the default numbering and the draft notice.
      const slice1 = assemble({
        outline: inputs!.outline,
        occurrences: new Map(),
        refused: [],
        layout: null,
        revision: inputs!.revision,
        covers: fonts.covers,
      });
      if (!slice1.ok) throw new Error('did not assemble');
      expect(slice1.document).toMatchObject({ schema: 'publishing/1', notice: DRAFT_NOTICE });
      expect(published.data_sha256).toBe(
        createHash('sha256').update(JSON.stringify(slice1.document)).digest('hex'),
      );
      expect(published.numbering).toEqual(slice1.numbering);
    } finally {
      await queue.close();
      await worker.close();
      await service.close();
    }
  }, 120_000);
});
