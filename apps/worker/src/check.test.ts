import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  createComponent,
  createDocument,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  readPublication,
  recordPublication,
  recordVersion,
  requestPublication,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, queryAs, type TestDatabase } from '@alloy-works/db/testing';
import {
  blockIdentifierFrom,
  defaultNumberingScheme,
  type ContentDocument,
  type OutlineDocument,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { checkJob } from './jobs/check.js';
import { publishJob } from './jobs/publish.js';
import { sweepUncheckedPublications } from './sweep.js';
import { suiteChecker } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';
import type { Checker } from './verapdf.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };

/** A PDF the pinned Typst makes without PDF/UA-1 and without a title: untagged, as veraPDF must fail. */
async function untagged(): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'aw-untagged-'));
  try {
    await writeFile(join(directory, 'main.typ'), '#set text(lang: "en")\nA sentence.\n');
    await promisify(execFile)(
      typstBinaryPath(),
      ['compile', '--root', directory, '--ignore-system-fonts', 'main.typ', 'out.pdf'],
      { cwd: directory, env: {}, timeout: 30_000 },
    );
    return await readFile(join(directory, 'out.pdf'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("checking a publication's PDF with veraPDF, after it is recorded", () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let publish: JobHandler;
  let ada: string;
  let general: string;
  const log: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

  /** veraPDF as the suite runs it, counting what it is asked to check and keeping its last report. */
  let asked = 0;
  let lastReport = '';
  const counting: Checker = {
    check: async (pdf) => {
      asked += 1;
      const verdict = await suiteChecker.check(pdf);
      lastReport = verdict.report;
      return verdict;
    },
    close: async () => {},
  };

  const work = (
    over: { checker?: Checker; stores?: ObjectStores; workerId?: string; leaseMs?: number } = {},
  ) =>
    processNext({
      queue,
      db: worker,
      handlers: {
        publish,
        check_pdf: checkJob({
          db: worker,
          stores: over.stores ?? stores,
          checker: over.checker ?? counting,
        }),
      },
      workerId: over.workerId ?? 'worker-1',
      leaseMs: over.leaseMs ?? 60_000,
      log,
    });

  /** A document of one section holding one component's paragraph, asked to be published as a PDF. */
  const requested = () =>
    service.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Calibration',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content: ContentDocument = {
        schemaVersion: 1,
        title: 'Calibration',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: 'Set the tray before every run.', marks: [] }],
          },
        ],
      };
      const component = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { ...substance, content },
      });
      if (component.answer !== 'recorded') throw new Error(component.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const outline: OutlineDocument = {
        ...(document.version.content as OutlineDocument),
        nodes: [
          {
            type: 'section',
            id: nodeId(),
            title: [{ type: 'text', value: 'Method', marks: [] }],
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
      const answer = await requestPublication(trx, {
        documentId: version.version.artifactId,
        version: version.version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  /** Ada's publication of this request, published by the `publish` job. */
  const publicationOf = (request: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('publication')
        .select('id')
        .where('request_id', '=', request)
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const checkOf = async (publication: string) =>
    (await service.withTenant(tenant, (trx) => readPublication(trx, publication)))!.outputs.find(
      (each) => each.format === 'pdf',
    )!.check;

  /** The checks the platform holds for this publication: whether each is finished, and its tries. */
  const checkJobsOf = async (publication: string) =>
    (
      await queryAs(
        db.adminUrl,
        `select finished_at is not null as finished, attempts, locked_by from platform.job
          where kind = 'check_pdf' and subject_id = $1 order by id`,
        [publication],
      )
    ).rows as { finished: boolean; attempts: number; locked_by: string | null }[];

  /** A publication recorded as the `publish` job records one, over these bytes as its PDF. */
  const recordedOver = async (pdf: Buffer) => {
    const request = await requested();
    // Recorded here in the job's stead, so its job is taken away: only the check it queues is left.
    await queryAs(db.adminUrl, 'delete from platform.job where subject_id = $1', [request]);
    const store = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const stored = await store.put(pdf, 'application/pdf');
    return service.withTenant(tenant, async (trx) => {
      const id = await recordPublication(trx, {
        requestId: request,
        pipelineVersion: '13',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 13,
            key: stored.key,
            sha256: stored.sha256,
            bytes: stored.size,
          },
        ],
      });
      return id!;
    });
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
    publish = publishJob({ db: worker, stores, typst, fonts });
    await service.withTenant(tenant, async (trx: TenantTransaction) => {
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
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('PUB-091 records a publication with its check queued in the same transaction, and keeps what veraPDF found of its PDF: PDF/UA-1, passed', async () => {
    const request = await requested();

    expect(await work()).toBe('done');
    const publication = await publicationOf(request);
    // Recorded, and not yet checked: the check is a job of its own, queued as it was recorded.
    expect(await checkJobsOf(publication)).toEqual([
      { finished: false, attempts: 0, locked_by: null },
    ]);
    expect(await checkOf(publication)).toBeNull();

    expect(await work()).toBe('done');

    expect(await checkJobsOf(publication)).toMatchObject([{ finished: true, attempts: 1 }]);
    expect(await checkOf(publication)).toEqual({
      checker: 'verapdf',
      checkerVersion: '1.30.2',
      profile: 'ua1',
      compliant: true,
      failedRules: [],
      report: {
        key: expect.stringMatching(new RegExp(`^${tenant.role}/sha256/[0-9a-f]{64}$`)),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        bytes: expect.any(Number),
      },
      checkedAt: expect.any(Date),
    });
  }, 120_000);

  it("PUB-091 retains veraPDF's whole report with the publication, byte for byte, in the tenant's store by its hash", async () => {
    const publication = await recordedOver(await untagged());

    expect(await work()).toBe('done');

    const check = (await checkOf(publication))!;
    const store = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const kept = await store.get(check.report.key);
    // The very report the summary was read from, not a summary of it.
    expect(kept.equals(Buffer.from(lastReport, 'utf8'))).toBe(true);
    expect(check.report).toEqual({
      key: `${tenant.role}/sha256/${check.report.sha256}`,
      sha256: createHash('sha256').update(kept).digest('hex'),
      bytes: kept.byteLength,
    });
    const report = JSON.parse(kept.toString('utf8')) as {
      report: { jobs: { validationResult: { compliant: boolean; profileName: string }[] }[] };
    };
    expect(report.report.jobs[0]!.validationResult[0]).toMatchObject({
      compliant: false,
      profileName: 'PDF/UA-1 validation profile',
    });
  }, 120_000);

  it('PUB-091 keeps a PDF that fails PDF/UA-1 as checked and not compliant, naming each rule it failed', async () => {
    const publication = await recordedOver(await untagged());

    expect(await work()).toBe('done');

    const check = await checkOf(publication);
    expect(check).toMatchObject({ checker: 'verapdf', profile: 'ua1', compliant: false });
    // 5-1 is PDF/UA-1's own identification, missing from any PDF not made to the standard, and each
    // rule is named with veraPDF's words for it.
    expect(check!.failedRules).toContainEqual({
      clause: '5',
      test: 1,
      description: expect.stringMatching(/PDF\/UA/),
    });
    expect(check!.failedRules.length).toBeGreaterThan(1);
  }, 120_000);

  it('PUB-091 checks a publication whose worker died after recording it: the check stays queued and the next worker takes it', async () => {
    const request = await requested();
    // The publish runs, and its worker goes before taking anything else: nothing but the record was
    // done, and the check it queued waits, unclaimed.
    expect(await work()).toBe('done');
    const publication = await publicationOf(request);
    expect(await checkJobsOf(publication)).toEqual([
      { finished: false, attempts: 0, locked_by: null },
    ]);
    // Another worker takes the check and dies holding it: its lease runs out with nothing recorded.
    const held = await queue.claim({ workerId: 'worker-gone', leaseMs: 1_000 });
    expect(held).toMatchObject({ kind: 'check_pdf', subjectId: publication });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await checkOf(publication)).toBeNull();

    // The next worker finds it and checks it.
    expect(await work({ workerId: 'worker-2' })).toBe('done');

    expect(await checkJobsOf(publication)).toMatchObject([
      { finished: true, attempts: 2, locked_by: 'worker-2' },
    ]);
    expect(await checkOf(publication)).toMatchObject({ compliant: true });
  }, 120_000);

  it('checks a publication once: a second run finds it checked, asks veraPDF nothing and records nothing', async () => {
    const publication = await recordedOver(await untagged());
    expect(await work()).toBe('done');
    const first = await checkOf(publication);
    const before = asked;

    // Its job run again - its lease ran out after it recorded, say, and another worker took it.
    await queryAs(
      db.adminUrl,
      "insert into platform.job (tenant_id, kind, subject_id) values ($1, 'check_pdf', $2)",
      [tenant.id, publication],
    );
    expect(await work()).toBe('done');

    expect(asked).toBe(before);
    expect(await checkOf(publication)).toEqual(first);
    const { rows } = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${tenant.schema}.publication_check where publication_id = $1`,
      [publication],
    );
    expect(rows).toEqual([{ n: 1 }]);
  }, 120_000);

  it('tries a check again when veraPDF could not run, recording nothing until it does', async () => {
    const publication = await recordedOver(await untagged());
    const broken: Checker = {
      check: async () => {
        throw new Error('veraPDF could not start: spawn /opt/verapdf/verapdf ENOENT');
      },
      close: async () => {},
    };
    const eager: JobQueue = {
      ...queue,
      fail: (job, reason) => queue.fail(job, reason, { retryInMs: 0 }),
    };

    expect(
      await processNext({
        queue: eager,
        db: worker,
        handlers: { check_pdf: checkJob({ db: worker, stores, checker: broken }) },
        workerId: 'worker-1',
        leaseMs: 60_000,
        log,
      }),
    ).toBe('retry');
    expect(await checkOf(publication)).toBeNull();

    expect(await work()).toBe('done');
    expect(await checkOf(publication)).toMatchObject({ compliant: false });
  }, 120_000);

  it('checks only the bytes the publication recorded, and tries again where the store answers others', async () => {
    const publication = await recordedOver(await untagged());
    const other = Buffer.from('%PDF-1.7\n% not the publication\n%%EOF\n', 'latin1');
    const lying: ObjectStores = {
      forTenant: async (trx, owner) => ({
        ...(await stores.forTenant(trx, owner)),
        get: async () => other,
      }),
    };
    const before = asked;
    const eager: JobQueue = {
      ...queue,
      fail: (job, reason) => queue.fail(job, reason, { retryInMs: 0 }),
    };

    expect(
      await processNext({
        queue: eager,
        db: worker,
        handlers: { check_pdf: checkJob({ db: worker, stores: lying, checker: counting }) },
        workerId: 'worker-1',
        leaseMs: 60_000,
        log,
      }),
    ).toBe('retry');
    expect(asked).toBe(before);
    expect(await checkOf(publication)).toBeNull();

    expect(await work()).toBe('done');
    expect(await checkOf(publication)).toMatchObject({ compliant: false });
  }, 120_000);

  // Last in the file: it leaves nothing queued, but asks the sweep of every publication in the tenant.
  it('PUB-091 queues a check again, from the sweep, for a publication whose check gave up, and none for one checked, one whose check is still queued, or one recorded under five minutes ago', async () => {
    const broken: Checker = {
      check: async () => {
        throw new Error('veraPDF could not start: spawn /opt/verapdf/verapdf ENOENT');
      },
      close: async () => {},
    };
    const eager: JobQueue = {
      ...queue,
      fail: (job, reason) => queue.fail(job, reason, { retryInMs: 0 }),
    };
    const failing = () =>
      processNext({
        queue: eager,
        db: worker,
        handlers: { check_pdf: checkJob({ db: worker, stores, checker: broken }) },
        workerId: 'worker-1',
        leaseMs: 60_000,
        log,
      });
    const sweep = (at: Date) => sweepUncheckedPublications(worker, queue, log, at);

    const gaveUp = await recordedOver(await untagged());
    // Every attempt the queue allows, and the last gives up: nothing retries it, and its page would
    // say it is not yet checked for ever.
    expect(await failing()).toBe('retry');
    expect(await failing()).toBe('retry');
    expect(await failing()).toBe('failed');
    expect(await checkOf(gaveUp)).toBeNull();
    const checked = await recordedOver(await untagged());
    expect(await work()).toBe('done');
    const queued = await recordedOver(await untagged());

    // Under five minutes after it was recorded, its check is still within ADR-0030's bound.
    expect(await sweep(new Date())).toEqual({ queued: 0, left: 0 });
    expect(await checkJobsOf(gaveUp)).toHaveLength(1);

    // Five minutes on, the sweep queues one check, for the publication whose check gave up.
    const later = new Date(Date.now() + 6 * 60_000);
    expect(await sweep(later)).toEqual({ queued: 1, left: 0 });
    expect(await checkJobsOf(gaveUp)).toMatchObject([
      { finished: false, attempts: 3 },
      { finished: false, attempts: 0, locked_by: null },
    ]);
    expect(await checkJobsOf(checked)).toHaveLength(1);
    expect(await checkJobsOf(queued)).toHaveLength(1);
    // The next sweep finds that check waiting, and queues no other.
    expect(await sweep(later)).toEqual({ queued: 0, left: 0 });

    // And the check queued again is done, as is the one that was waiting all along.
    while ((await work()) !== 'idle') {
      // Each job in turn.
    }
    expect(await checkOf(gaveUp)).toMatchObject({ compliant: false });
    expect(await checkOf(queued)).toMatchObject({ compliant: false });
    expect(await sweep(later)).toEqual({ queued: 0, left: 0 });
  }, 120_000);

  /** Whether the publication's PDF is recorded as one whose check was given up for good (0041). */
  const gaveUpOn = async (publication: string) =>
    (await service.withTenant(tenant, (trx) => readPublication(trx, publication)))!.outputs.find(
      (each) => each.format === 'pdf',
    )!.checkGaveUp;

  // After the sweep's first test, as it is: each asks the sweep of every publication in the tenant.
  it('PUB-091 leaves a publication whose check has given up three times, queueing no more, and records that it could not be checked', async () => {
    const broken: Checker = {
      check: async () => {
        throw new Error('veraPDF could not start: spawn /opt/verapdf/verapdf ENOENT');
      },
      close: async () => {},
    };
    const eager: JobQueue = {
      ...queue,
      fail: (job, reason) => queue.fail(job, reason, { retryInMs: 0 }),
    };
    /** One check, all three of its attempts, each failing: the check gives up. */
    const givesUp = async () => {
      for (const outcome of ['retry', 'retry', 'failed']) {
        expect(
          await processNext({
            queue: eager,
            db: worker,
            handlers: { check_pdf: checkJob({ db: worker, stores, checker: broken }) },
            workerId: 'worker-1',
            leaseMs: 60_000,
            log,
          }),
        ).toBe(outcome);
      }
    };
    const later = new Date(Date.now() + 6 * 60_000);
    const sweep = () => sweepUncheckedPublications(worker, queue, log, later);

    const never = await recordedOver(await untagged());
    await givesUp();
    expect(await sweep()).toEqual({ queued: 1, left: 0 });
    await givesUp();
    expect(await sweep()).toEqual({ queued: 1, left: 0 });
    expect(await gaveUpOn(never)).toBe(false);
    await givesUp();

    // Three checks, each given up after its last attempt: the sweep queues no fourth, and records
    // that the publication could not be checked, for its page to say so.
    expect(await sweep()).toEqual({ queued: 0, left: 1 });
    expect(await checkJobsOf(never)).toHaveLength(3);
    expect(await checkOf(never)).toBeNull();
    expect(await gaveUpOn(never)).toBe(true);
    // And every sweep after it passes it over.
    expect(await sweep()).toEqual({ queued: 0, left: 0 });
    expect(await work()).toBe('idle');
  }, 120_000);

  it('PUB-091 checks the publications recorded before checks were queued, from the first sweep after, a hundred a sweep in each tenant', async () => {
    const pdf = await untagged();
    // Recorded before 0040, when nothing queued a check: a publication with a PDF and no check_pdf
    // job at all, as `recordedOver` leaves one once its queued check is taken away.
    const before: string[] = [];
    for (let n = 0; n < 101; n++) before.push(await recordedOver(pdf));
    await queryAs(
      db.adminUrl,
      "delete from platform.job where kind = 'check_pdf' and subject_id = any($1::uuid[])",
      [before],
    );
    const later = new Date(Date.now() + 6 * 60_000);
    const sweep = () => sweepUncheckedPublications(worker, queue, log, later);

    // The first sweep queues a hundred, the oldest first; the next the one left over; then none.
    expect(await sweep()).toEqual({ queued: 100, left: 0 });
    const queuedFirst = (
      await queryAs(
        db.adminUrl,
        "select subject_id from platform.job where kind = 'check_pdf' and subject_id = any($1::uuid[])",
        [before],
      )
    ).rows.map((row: { subject_id: string }) => row.subject_id);
    expect(queuedFirst.sort()).toEqual(before.slice(0, 100).sort());
    expect(await sweep()).toEqual({ queued: 1, left: 0 });
    expect(await sweep()).toEqual({ queued: 0, left: 0 });

    while ((await work()) !== 'idle') {
      // Each check in turn.
    }
    for (const publication of before) {
      expect(await checkOf(publication)).toMatchObject({ compliant: false });
    }
  }, 300_000);
});
