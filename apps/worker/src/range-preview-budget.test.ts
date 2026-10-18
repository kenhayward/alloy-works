import {
  claimLock,
  createJobQueue,
  createTenant,
  migrate,
  prepareDatabase,
  readRangePage,
  readRangePreview,
  refreshRangePreview,
  requestRangePreview,
  saveIteration,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import type { ContentDocument } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { createWarmPool, rangePreviewJob, type WarmPool } from './jobs/range-preview.js';
import {
  PAGES,
  seedReferenceDocument,
  type ReferenceDocument,
} from './testing/reference-document.js';
import { machine } from './testing/machine.js';
import { typstBinaryPath } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

/**
 * CNT-151's budget (the R22 plan, R22-C): a saved edit reflected in the range preview within one
 * second of the save being recorded, and no measured sample above two, in the 300-page reference
 * document - from the iteration's commit to the range's pages recorded, ready to read. Held on every
 * run, CI's reference runner among them, and recorded beside the machine it ran on.
 */
const BUDGET = { p95: 1_000, max: 2_000 } as const;
const SAMPLES = 10;
const SESSION = '33333333-3333-4333-8333-333333333333';

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

/** A PNG's width and height, from its header. */
const sizeOf = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

describe('the warm range preview of the 300-page reference document (the R22 plan)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let pool: WarmPool;
  let handlers: Record<string, JobHandler>;
  let seeded: ReferenceDocument;
  let range = '';
  let sequence = 0;
  const logged: string[] = [];
  const said = (details: object, message: string) => {
    const { err } = details as { err?: unknown };
    logged.push(
      `${message}: ${err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : JSON.stringify(details)}`,
    );
  };
  const log: WorkerLog = { info: () => {}, warn: said, error: said };
  const configuration = { ...machine(), postgres: '' };

  beforeAll(async () => {
    const fonts = await loadPinnedFonts();
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
    pool = createWarmPool();
    handlers = {
      range: rangePreviewJob({ db: worker, stores, fonts, binary: typstBinaryPath(), pool }),
    };
    seeded = await seedReferenceDocument(service, tenant, stores);
    configuration.postgres = seeded.postgres;
  }, 180_000);

  afterAll(async () => {
    await pool?.close();
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  const chapter = () => seeded.chapters[14]!;
  const work = async () => {
    const outcome = await processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 120_000,
      log,
    });
    if (outcome !== 'done') throw new Error(`The range job was ${outcome}: ${logged.join('; ')}`);
  };
  const read = () => service.withTenant(tenant, (trx) => readRangePreview(trx, range, seeded.ada));

  /** The chapter with a sentence more in its fifth paragraph, as the editor would save it. */
  const edited = (said: string): ContentDocument => {
    const { content } = chapter();
    return {
      ...content,
      content: content.content.map((block, at) =>
        at === 4 && block.type === 'paragraph'
          ? {
              ...block,
              content: [...block.content, { type: 'text', value: ` ${said}`, marks: [] }],
            }
          : block,
      ),
    } as ContentDocument;
  };
  /** A save the session records, as the editor's is: the iteration committed. */
  const save = async (said: string) => {
    sequence += 1;
    const at = sequence;
    await service.withTenant(tenant, async (trx) => {
      const saved = await saveIteration(trx, {
        artifactId: chapter().component,
        principal: seeded.ada,
        session: SESSION,
        sequence: at,
        openedFrom: chapter().version,
        content: edited(said),
      });
      if (saved.answer !== 'accepted') throw new Error(saved.answer);
    });
  };

  it('shows the occurrence being edited and a page either side, as PNG images, its author’s saved edit among them', async () => {
    await service.withTenant(tenant, async (trx) => {
      const claimed = await claimLock(trx, {
        artifactId: chapter().component,
        principal: seeded.ada,
        session: SESSION,
      });
      if (claimed.answer !== 'claimed') {
        throw new Error(claimed.answer);
      }
    });
    const asked = await service.withTenant(tenant, (trx) =>
      requestRangePreview(trx, {
        documentId: seeded.document.id,
        version: seeded.document.version,
        node: chapter().node,
        session: SESSION,
        requester: seeded.ada,
      }),
    );
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    range = asked.range.id;
    await work();
    const first = (await read())!;
    expect(first.made).toBe(first.wanted);
    expect(first.pages).toBeGreaterThanOrEqual(PAGES.least);
    expect(first.pages).toBeLessThanOrEqual(PAGES.most);
    // Chapter fifteen of thirty, about halfway through: its pages and one either side, about a
    // thirtieth of the document's body.
    expect(first.range!.to - first.range!.from).toBeGreaterThanOrEqual(2);
    expect(first.range!.to - first.range!.from).toBeLessThan(first.pages! / 10);
    expect(first.range!.from).toBeGreaterThan(first.pages! / 3);
    expect(first.range!.to).toBeLessThan((first.pages! * 2) / 3);
    const png = (await service.withTenant(tenant, (trx) =>
      readRangePage(trx, range, seeded.ada, first.range!.from),
    ))!;
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(sizeOf(png).height).toBeGreaterThan(sizeOf(png).width);
    // Somebody else's range is not theirs to read.
    expect(
      await service.withTenant(tenant, (trx) =>
        readRangePage(trx, range, '00000000-0000-4000-8000-000000000000', first.range!.from),
      ),
    ).toBeUndefined();

    // A saved edit is what the pages show next.
    await save('Grace replaced the seal.');
    await service.withTenant(tenant, (trx) => refreshRangePreview(trx, range, seeded.ada));
    await work();
    const next = (await read())!;
    expect(next).toMatchObject({ made: 2, sequence: 1 });
    expect(next.range).toEqual(first.range);
  }, 120_000);

  it('reflects a saved edit in the range preview within one second of the save, none above two, on the 300-page reference document', async ({
    task,
  }) => {
    const measured: number[] = [];
    // One more than measured, to warm what a long-lived worker already holds warm.
    for (let at = 0; at <= SAMPLES; at += 1) {
      await save(`Reading ${at} taken again.`);
      const saved = performance.now();
      await service.withTenant(tenant, (trx) => refreshRangePreview(trx, range, seeded.ada));
      await work();
      const shown = performance.now() - saved;
      const now = (await read())!;
      expect(now.sequence).toBe(sequence);
      if (at > 0) measured.push(Math.round(shown));
    }
    const result = {
      budget: BUDGET,
      samples: measured,
      p95: percentile(measured, 95),
      max: Math.max(...measured),
    };
    Object.assign(task.meta, { rangePreviewBudget: { configuration, result } });
    console.info(`CNT-151 range preview: ${JSON.stringify({ configuration, result })}`);
    expect(result.p95, JSON.stringify(result)).toBeLessThanOrEqual(BUDGET.p95);
    expect(result.max, JSON.stringify(result)).toBeLessThanOrEqual(BUDGET.max);
  }, 300_000);
});
