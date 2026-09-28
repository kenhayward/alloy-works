import { randomBytes } from 'node:crypto';
import { arch, availableParallelism, cpus, loadavg, platform, release, totalmem } from 'node:os';
import {
  createArtifact,
  createComponent,
  createDocument,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  recordVersion,
  requestPublication,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase } from '@alloy-works/db/testing';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  withAlternative,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { readPdf } from './testing/pdf.js';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { publishJob } from './jobs/publish.js';
import { TYPST_RELEASE } from './typst-release.js';
import { createTypst, typstBinaryPath } from './typst.js';
import { processNext, type WorkerLog } from './worker.js';

/**
 * PUB-102's budget: a publish of the reference document, from the request to the recorded
 * publication, at or under ten seconds at the 95th percentile, and no sample above thirty.
 */
const BUDGET = { p95: 10_000, max: 30_000 } as const;
/**
 * Held to both bounds on a developer's machine, and stated against the reference configuration that
 * docs/testing.md declares; recorded only on a shared CI runner, whose speed varies from run to run
 * by more than a budget can absorb - W-D, as STR-063's navigation budget is
 * (`apps/service/src/test/budget.ts`). `CI` is the variable GitHub Actions sets to `true`.
 */
const BINDS = process.env['CI'] !== 'true';

/**
 * **The declared reference document** (PUB-102): 30 chapters, each placing one component of 100
 * blocks, in a cycle of twenty - a figure, a table of a header row and four rows of three cells, a
 * numbered equation displayed on its own and a paragraph with a footnote, each once, and sixteen
 * paragraphs of prose of about 300 characters. So 3,000 blocks: 150 figures, 150 tables, 150
 * equations, 150 footnotes and 2,400 paragraphs of prose besides, set to about 300 pages under the
 * default layout and theme, measured by the page count below.
 */
const CHAPTERS = 30;
const BLOCKS_PER_COMPONENT = 100;
/**
 * Measured at 311 pages under Typst 0.15.1 and the default theme's first version. The range lets the
 * engine or the theme move it a little, and fails a change that makes it another document.
 */
const PAGES = { least: 270, most: 330 } as const;
/**
 * The publishes measured, after one to warm the worker, which is reported and held to the maximum
 * alone: PUB-102 allows no measured sample above thirty seconds, the first among them. With ten
 * samples the nearest-rank 95th percentile is the tenth, the slowest, so the p95 bound holds every
 * sample to ten seconds; a larger count would let the slowest one past it.
 */
const SAMPLES = 10;

/** An equation in the one form the MathML reader writes, with the words it is spoken by. */
const MATHML = withAlternative(
  '<math xmlns="http://www.w3.org/1998/Math/MathML">' +
    '<mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></math>',
  'E equals m c squared',
);
const PROSE =
  'Set the tray level before each run, check the reading against the reference weight, and write ' +
  'down what the gauge says. Ada and Grace agreed that a reading off by more than a tenth is taken ' +
  'again, and that the press is not started until two readings in a row agree with each other.';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const paragraph = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const cell = (id: string, value: string) => ({
  content: [paragraph(id, text(value))],
  colspan: 1,
  rowspan: 1,
});

/** The block at `index` of a component, by its place in the cycle of twenty. */
const block = (index: number, image: string) => {
  const id = `b${index}`;
  switch (index % 20) {
    case 0:
      return {
        type: 'figure',
        id,
        asset: image,
        imageStyle: 'figure',
        caption: [text(`The tray at step ${index}`)],
        alternative: { kind: 'inherited' },
      };
    case 5:
      return {
        type: 'table',
        id,
        style: 'table',
        caption: [text(`Readings at step ${index}`)],
        headerRows: 1,
        headerColumns: 0,
        rows: ['Site', 'North', 'South', 'East', 'West'].map((site, row) => ({
          cells: ['Morning', 'Noon', 'Evening'].map((time, column) =>
            cell(`${id}r${row}c${column}`, row === 0 ? time : `${site} ${row * 3 + column}.5`),
          ),
        })),
      };
    case 10:
      return { type: 'equation', id, mathml: MATHML, numbered: true };
    case 15:
      return paragraph(id, text(PROSE), {
        type: 'footnote',
        id: `${id}n`,
        anchor: { kind: 'span' },
        content: [paragraph(`${id}p`, text('Grace takes the second reading.'))],
      });
    default:
      return paragraph(id, text(PROSE));
  }
};

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
const seconds = (ms: number) => Number((ms / 1000).toFixed(2));

describe('PUB-102 publishes the 300-page reference document within the budget', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let ada: string;
  let document: { id: string; version: string };
  const log: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
  let handlers: Parameters<typeof processNext>[0]['handlers'];
  // The configuration the budget was measured on, recorded beside the result (PUB-102).
  const configuration = {
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    // The logical CPUs the machine has, whatever a container or runner lets this process use.
    cpus: cpus().length,
    // How many of them this process may run on at once: a container's or a runner's limit, where set.
    parallelism: availableParallelism(),
    memoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)),
    node: process.version,
    typst: TYPST_RELEASE.version,
    postgres: '',
    // Always [0, 0, 0] on Windows, which is still a value.
    loadavg: loadavg().map((load) => Number(load.toFixed(2))),
    // Which bounds this run was held to, so a result read later says what it proved.
    held: BINDS ? 'the p95 and the maximum' : 'neither bound: recorded only, on a shared CI runner',
  };

  beforeAll(async () => {
    const fonts = await loadPinnedFonts();
    const typst = createTypst({ binary: typstBinaryPath(), fonts });
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
    // The publish job alone: nothing but the publish runs inside the measured span. The conformance
    // report joins a publication after it is recorded, as a job of its own (ADR-0030), so it is no
    // part of what PUB-102 measures.
    handlers = { publish: publishJob({ db: worker, stores, typst, fonts }) };
    const image = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .png()
      .toBuffer();
    // Seeded through the store, not through the editor: what is measured is publishing a document
    // this size, not building one.
    document = await service.withTenant(tenant, async (trx: TenantTransaction) => {
      configuration.postgres = (
        await trx
          .selectNoFrom((eb) =>
            eb.fn<string>('current_setting', [eb.val('server_version')]).as('v'),
          )
          .executeTakeFirstOrThrow()
      ).v;
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
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
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
      const kept = await (await stores.forTenant(trx, tenant)).put(image, 'image/png');
      const asset = await createArtifact(trx, {
        spaceId: general,
        author: ada,
        substance: {
          kind: 'asset',
          content: {
            schemaVersion: 1,
            object: kept.key,
            format: 'png',
            bytes: image.length,
            width: 800,
            height: 400,
            orientation: 1,
            colour: 'rgb',
            alpha: false,
            depth: 8,
            resolution: null,
            alternative: { text: 'A blue tray', language: 'en-GB' },
          },
        },
      });
      const base = {
        numbered: true,
        matter: 'body' as const,
        pageBreak: 'none' as const,
        values: {},
      };
      const nodes: OutlineNode[] = [];
      for (let chapter = 1; chapter <= CHAPTERS; chapter += 1) {
        const title = `Procedure ${chapter}`;
        const made = await createComponent(trx, {
          spaceId: general,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version);
        if (substance.kind !== 'component') throw new Error('not a component');
        const content = {
          schemaVersion: 1,
          title,
          language: 'en-GB',
          direction: 'ltr',
          content: Array.from({ length: BLOCKS_PER_COMPONENT }, (_, at) => block(at, asset.id)),
        } as unknown as ContentDocument;
        const recorded = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: ada,
          substance: { ...substance, content },
        });
        if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
        nodes.push({
          type: 'section',
          id: nodeId(),
          title: [text(`Chapter ${chapter}`)],
          ...base,
          children: [
            {
              type: 'reference',
              id: nodeId(),
              component: made.version.artifactId,
              mode: { kind: 'latest' },
              ...base,
              children: [],
            },
          ],
        });
      }
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The reference manual',
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
      return { id: made.version.artifactId, version: recorded.version.id };
    });
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  /**
   * One publish, from asking for it to the publication recorded - what PUB-102 measures - timed, and
   * the request's and the job's parts beside it. Answers the request.
   */
  const publish = async () => {
    const started = performance.now();
    const request = await service.withTenant(tenant, async (trx) => {
      const answer = await requestPublication(trx, {
        documentId: document.id,
        version: document.version,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });
    const requested = performance.now();
    const outcome = await processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 120_000,
      log,
    });
    const recorded = performance.now();
    if (outcome !== 'done') {
      const row = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('publication_request')
          .select('failures')
          .where('id', '=', request)
          .executeTakeFirstOrThrow(),
      );
      throw new Error(`The publish was ${outcome}: ${JSON.stringify(row.failures).slice(0, 500)}`);
    }
    return {
      request,
      total: recorded - started,
      asking: requested - started,
      job: recorded - requested,
    };
  };

  it('PUB-102 publishes the declared 300-page reference document to a recorded PDF at or under ten seconds at p95, no sample above thirty, recording the configuration beside the result', async ({
    task,
  }) => {
    // The first publish, which warms the worker, reads the document it made: the reference document
    // is what the budget is stated against, so its size is measured, not assumed.
    const first = await publish();
    const row = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication as p')
        .innerJoin('publication_output as o', 'o.publication_id', 'p.id')
        .select(['o.object_key', 'o.format'])
        .where('p.request_id', '=', first.request)
        .executeTakeFirstOrThrow(),
    );
    expect(row.format).toBe('pdf');
    const pdf = await (
      await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant))
    ).get(row.object_key);
    const read = await readPdf(pdf);
    // Read off the PDF rather than off how the document was built: its pages, and each part a reader
    // is told it holds, each structure element counted once however many pages it reaches.
    const reference = {
      pages: read.pages,
      bytes: pdf.length,
      chapters: CHAPTERS,
      components: CHAPTERS,
      figures: read.elements['Figure'],
      tables: read.elements['Table'],
      equations: read.elements['Formula'],
      footnotes: read.elements['Note'],
      paragraphs: read.elements['P'],
      layout: 'the default layout and theme',
    };
    expect(reference).toMatchObject({
      figures: 150,
      tables: 150,
      equations: 150,
      footnotes: 150,
    });
    expect(read.pages).toBeGreaterThanOrEqual(PAGES.least);
    expect(read.pages).toBeLessThanOrEqual(PAGES.most);

    const samples: Awaited<ReturnType<typeof publish>>[] = [];
    for (let index = 0; index < SAMPLES; index += 1) samples.push(await publish());
    const totals = samples.map((each) => each.total);
    const measured = {
      samples: SAMPLES,
      warmUpSeconds: seconds(first.total),
      p50Seconds: seconds(percentile(totals, 50)),
      p95Seconds: seconds(percentile(totals, 95)),
      maxSeconds: seconds(Math.max(...totals)),
      // Of which, asking for the publish, and the job running to the recorded publication.
      requestSeconds: samples.map((each) => seconds(each.asking)),
      jobSeconds: samples.map((each) => seconds(each.job)),
    };
    // What the JSON reporter writes beside this result in `.trace-results/worker.json`: the
    // configuration, the document and the measurement - before the budget is held to them, so a
    // failing run records its numbers too.
    Object.assign(task.meta, { publishingBudget: { configuration, reference, measured } });
    console.info(
      `Publishing budget report\n${JSON.stringify({ configuration, reference, measured }, null, 2)}`,
    );
    expect(configuration.cpu.trim()).not.toBe('');
    expect(configuration.postgres).not.toBe('');

    if (BINDS) {
      // Nearest rank over ten samples: the 95th percentile is the maximum (SAMPLES).
      expect(percentile(totals, 95)).toBeLessThanOrEqual(BUDGET.p95);
      expect(Math.max(...totals)).toBeLessThanOrEqual(BUDGET.max);
      // The warm-up is a measured sample too, and PUB-102 allows none above thirty seconds.
      expect(first.total).toBeLessThanOrEqual(BUDGET.max);
    }
  }, 900_000);
});
