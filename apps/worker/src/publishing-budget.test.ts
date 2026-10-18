import { arch, availableParallelism, cpus, loadavg, platform, release, totalmem } from 'node:os';
import {
  createJobQueue,
  createTenant,
  migrate,
  prepareDatabase,
  requestPublication,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { readPdf } from './testing/pdf.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { checkJob } from './jobs/check.js';
import { CHAPTERS, PAGES, seedReferenceDocument } from './testing/reference-document.js';
import { publishJob } from './jobs/publish.js';
import { suiteChecker } from './testing/verapdf.js';
import { TYPST_RELEASE } from './typst-release.js';
import { createTypst, typstBinaryPath } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

/**
 * PUB-102's budget: a publish of the reference document, from the request to the recorded
 * publication, at or under ten seconds at the 95th percentile, and no sample above thirty.
 */
const BUDGET = { p95: 10_000, max: 30_000 } as const;
/**
 * PUB-102's other bound: the conformance report (PUB-091) joins the publication within five minutes of
 * its recording - from the request finished, by the database's clock, to its `publication_check` row.
 */
const REPORT_WITHIN = 300_000;
/**
 * Held to both bounds on a developer's machine, and stated against the reference configuration that
 * docs/testing.md declares; recorded only where `CI` is `true`, a shared runner whose speed varies
 * from run to run by more than a budget can absorb - W-D, as STR-063's navigation budget is
 * (`apps/service/src/test/budget.ts`). CI itself leaves this file out (`vitest.config.ts`).
 */
const BINDS = process.env['CI'] !== 'true';

/**
 * The publishes measured, after one to warm the worker, which is reported and held to the maximum
 * alone: PUB-102 allows no measured sample above thirty seconds, the first among them. With ten
 * samples the nearest-rank 95th percentile is the tenth, the slowest, so the p95 bound holds every
 * sample to ten seconds; a larger count would let the slowest one past it.
 */
const SAMPLES = 10;

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
  /** The `check_pdf` job over the run's warm veraPDF, as the worker's own is warm after its first. */
  let check: JobHandler;
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
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    // The publish job alone: nothing but the publish runs inside the measured span. The conformance
    // report joins a publication after it is recorded, as a job of its own (ADR-0030), so it is no
    // part of what PUB-102 measures.
    handlers = { publish: publishJob({ db: worker, stores, typst, fonts }) };
    check = checkJob({ db: worker, stores, checker: suiteChecker });
    // The reference document (PUB-102), seeded through the store, not through the editor.
    const seeded = await seedReferenceDocument(service, tenant, stores);
    ada = seeded.ada;
    document = seeded.document;
    configuration.postgres = seeded.postgres;
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

  /**
   * The check a publish queued, run at once outside the measured span, as a free worker takes it:
   * veraPDF over the publication's PDF, its report kept. Answers how long after the publication was
   * recorded its report joined it, by the database's clock - the request's `finished_at`, which the
   * sweep's five minutes are counted from, to the `publication_check` row's `checked_at`.
   */
  const checked = async (request: string) => {
    const outcome = await processNext({
      queue,
      db: worker,
      handlers: { check_pdf: check },
      workerId: 'worker-1',
      leaseMs: 120_000,
      log,
    });
    if (outcome !== 'done') throw new Error(`The check was ${outcome}`);
    const row = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication as p')
        .innerJoin('publication_request as r', 'r.id', 'p.request_id')
        .innerJoin('publication_check as c', 'c.publication_id', 'p.id')
        .select(['r.finished_at', 'c.checked_at', 'c.compliant'])
        .where('p.request_id', '=', request)
        .executeTakeFirstOrThrow(),
    );
    return {
      afterRecording: row.checked_at.getTime() - row.finished_at!.getTime(),
      compliant: row.compliant,
    };
  };

  /** A queued check completed without asking veraPDF anything, outside the measured span. */
  const passedOver = async () => {
    const skip: JobHandler = { run: async () => {}, failed: async () => {} };
    const outcome = await processNext({
      queue,
      db: worker,
      handlers: { check_pdf: skip },
      workerId: 'worker-1',
      leaseMs: 120_000,
      log,
    });
    if (outcome !== 'done') throw new Error(`The check was ${outcome}`);
  };

  it('PUB-102 publishes the declared 300-page reference document to a recorded PDF at or under ten seconds at p95, no sample above thirty, its conformance report joining it within five minutes, recording the configuration beside the result', async ({
    task,
  }) => {
    // The first publish, which warms the worker, reads the document it made: the reference document
    // is what the budget is stated against, so its size is measured, not assumed.
    const first = await publish();
    // Its check, which starts the run's veraPDF where nothing has yet: the worker's is cold for its
    // first check too.
    const firstReport = await checked(first.request);
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
    for (let index = 0; index < SAMPLES; index += 1) {
      samples.push(await publish());
      // Outside the measured span, and before the next publish is asked for, which the check queued
      // ahead of it would otherwise run inside: the last sample's checked by the warm veraPDF, and the
      // others' passed over unchecked, since a check of 311 pages takes several seconds and each would
      // tell no more than the last.
      if (index < SAMPLES - 1) await passedOver();
    }
    const lastReport = await checked(samples[SAMPLES - 1]!.request);
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
      // From a publication recorded to its conformance report joining it, by the database's clock,
      // its check taken at once by a free worker: the warm-up's, veraPDF's first, and the last
      // sample's, with veraPDF warm.
      reportSeconds: {
        first: seconds(firstReport.afterRecording),
        warm: seconds(lastReport.afterRecording),
      },
      reportsCompliant: firstReport.compliant && lastReport.compliant,
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
      // And every report joins its publication within five minutes of its recording.
      for (const each of [firstReport, lastReport]) {
        expect(each.afterRecording).toBeLessThanOrEqual(REPORT_WITHIN);
      }
    }
    // The reference document is published as PDF/UA-1 that veraPDF passes, every time (PUB-103).
    expect(measured.reportsCompliant).toBe(true);
  }, 900_000);
});
