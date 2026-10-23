import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  failImport,
  holdImportImage,
  holdObject,
  readImport,
  recordProposal,
  releaseObject,
  type ImportFailure,
  type ImportFileType,
  type StoredImport,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  createReport,
  type AuditContext,
  type ImportIdentity,
  type ImportLevels,
  type ImportReference,
  type ProposedPart,
  type ReportEntry,
} from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';
import { checkImage, type Decode } from './ingest.js';

/** What a read in its thread answers: the proposal, or why there is none. */
export type ThreadAnswer =
  | {
      readonly ok: true;
      readonly parts: readonly ProposedPart[];
      readonly anchors: Readonly<Record<string, string>>;
      readonly report: readonly ReportEntry[];
      readonly title: string | null;
      readonly language: string | null;
      readonly references: readonly ImportReference[];
      readonly identities: readonly ImportIdentity[];
      /** The images inside, each named in the parts by its placeholder until it is an asset. */
      readonly images: readonly {
        readonly placeholder: string;
        readonly format: 'png' | 'jpeg';
        readonly bytes: Uint8Array;
      }[];
      readonly properties: Readonly<Record<string, string>>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'unreadable' | 'unsafe' | 'tooLarge' | 'timeout' | 'memory';
    };

/**
 * A read's budget (IM-C): past its time, its images' checks counted in, the thread is ended or the
 * import failed; past its memory the thread dies; past its images, the rest are left out and said.
 */
export interface ImportBudget {
  readonly timeMs: number;
  readonly memoryMb: number;
  readonly images?: number;
}

/** The most images one import holds. */
export const IMPORT_MAX_IMAGES = 200;

export const IMPORT_BUDGET: ImportBudget = {
  timeMs: 60_000,
  memoryMb: 512,
  images: IMPORT_MAX_IMAGES,
};

/** Where the thread's script is: beside this file, as it is run, built or as written. */
const SCRIPT = new URL(
  import.meta.url.endsWith('.ts') ? './import-read.ts' : './import-read.js',
  import.meta.url,
);

/** The file read and broken out in a thread of its own, within the budget. */
export function readInThread(
  input: {
    readonly bytes: Uint8Array;
    readonly type: ImportFileType;
    readonly levels: ImportLevels;
  },
  budget: ImportBudget = IMPORT_BUDGET,
): Promise<ThreadAnswer> {
  return new Promise((resolve, reject) => {
    const thread = new Worker(SCRIPT, {
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: budget.memoryMb, maxYoungGenerationSizeMb: 64 },
    });
    let settled = false;
    const settle = (answer: ThreadAnswer | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void thread.terminate();
      if (answer instanceof Error) reject(answer);
      else resolve(answer);
    };
    const timer = setTimeout(() => settle({ ok: false, refusal: 'timeout' }), budget.timeMs);
    thread.on('message', (answer: ThreadAnswer) => settle(answer));
    thread.on('error', (error: Error & { code?: string }) =>
      settle(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? { ok: false, refusal: 'memory' } : error),
    );
    thread.on('exit', (code) => settle(new Error(`The read's thread ended with ${code}`)));
  });
}

/** Each refusal as the import records it: the file's fault, by code (IMP-042). */
const FAILURES: Readonly<Record<Extract<ThreadAnswer, { ok: false }>['refusal'], ImportFailure>> = {
  unreadable: 'file_unreadable',
  unsafe: 'file_unsafe',
  tooLarge: 'file_too_large',
  timeout: 'file_too_large',
  memory: 'file_too_large',
};

/** The job acts as the system, for whoever imported the file (the AU1 plan, AU1-D). */
const forImporter = (found: StoredImport): AuditContext => ({
  actorKind: 'system',
  requestedBy: found.importer,
});

/**
 * **The `import` job** (the IM plan, IM-C): the import's file read back from the store and held to
 * its hash, read and broken out in a thread within its budget, and the proposal written; or, where
 * the file is at fault, the import failed with nothing left of it (IMP-042) and the job finished.
 */
export function importJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly budget?: ImportBudget;
  readonly read?: typeof readInThread;
  readonly decode?: Decode;
}): JobHandler {
  const read = deps.read ?? readInThread;
  const budget = deps.budget ?? IMPORT_BUDGET;

  /**
   * Each image checked as an upload is (IM-C) and, where it passes, stored by its hash and held for the
   * import: no asset is made until it is accepted, so abandoning leaves nothing (IMP-008). Answers
   * whether each placeholder was kept, and how many were past the most an import holds; or
   * `timeout` where the checks ran past the read's time.
   */
  const held = async (
    tenant: Tenant,
    store: TenantStore,
    found: StoredImport,
    images: Extract<ThreadAnswer, { ok: true }>['images'],
    deadline: number,
  ): Promise<{ kept: Map<string, string | null>; past: number } | 'timeout'> => {
    const kept = new Map<string, string | null>();
    const most = budget.images ?? IMPORT_MAX_IMAGES;
    for (const [at, image] of images.entries()) {
      if (at >= most) {
        kept.set(image.placeholder, null);
        continue;
      }
      const bytes = Buffer.from(image.bytes);
      const left = deadline - Date.now();
      if (left <= 0) return 'timeout';
      let timer: NodeJS.Timeout | undefined;
      const checked = await Promise.race([
        checkImage(bytes, deps.decode),
        new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), left))),
      ]).finally(() => clearTimeout(timer));
      if (checked === 'timeout') return 'timeout';
      if (!checked.ok || checked.header.format !== image.format) {
        kept.set(image.placeholder, null);
        continue;
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const holding = await deps.db.withTenant(
        tenant,
        async (trx) => {
          await holdObject(trx, sha256);
          const stored = await store.put(bytes, `image/${image.format}`);
          const holds = await holdImportImage(trx, found.id, {
            placeholder: image.placeholder,
            key: stored.key,
            sha256,
            bytes: stored.size,
            header: checked.header,
          });
          // Abandoned meanwhile: the bytes let go, unless something else holds them.
          if (!holds) {
            await releaseObject(trx, { key: stored.key, sha256 }, (key) => store.remove(key));
          }
          return holds;
        },
        forImporter(found),
      );
      kept.set(image.placeholder, holding ? image.placeholder : null);
    }
    return { kept, past: Math.max(0, images.length - most) };
  };

  const fail = async (
    tenant: Tenant,
    store: TenantStore,
    found: StoredImport,
    failure: ImportFailure,
  ) => {
    await deps.db.withTenant(
      tenant,
      (trx) => failImport(trx, found.id, failure, (key) => store.remove(key)),
      forImporter(found),
    );
  };

  const load = (tenant: Tenant, id: string) =>
    deps.db.withTenant(tenant, async (trx) => ({
      found: await readImport(trx, id),
      store: await deps.stores.forTenant(trx, tenant),
    }));

  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const { found, store } = await load(tenant, job.subjectId);
      // Nothing to do: abandoned meanwhile, or another attempt already read it.
      if (!found || found.state !== 'reading') return;
      if (found.objectKey === null) {
        await fail(tenant, store, found, 'file_missing');
        throw new JobRefused('import_refused', 'The import has no file');
      }
      const bytes = await store.get(found.objectKey);
      if (createHash('sha256').update(bytes).digest('hex') !== found.sha256) {
        // The store answered with other bytes than the key names: its fault, tried again.
        throw new Error('The stored bytes do not match their hash');
      }
      const deadline = Date.now() + budget.timeMs;
      const answer = await read(
        { bytes: new Uint8Array(bytes), type: found.fileType, levels: found.levels },
        budget,
      );
      const images = answer.ok
        ? await held(tenant, store, found, answer.images, deadline)
        : undefined;
      if (!answer.ok || images === 'timeout') {
        await fail(tenant, store, found, FAILURES[answer.ok ? 'timeout' : answer.refusal]);
        // Refused on its merits: the same file fails the same way every time (issue #146).
        throw new JobRefused('import_refused', 'The file could not be read into a proposal');
      }
      const assets = images!.kept;
      const refused = [...assets.values()].filter((each) => each === null).length - images!.past;
      const report = createReport(answer.report);
      if (refused > 0) report.add('read', 'discarded', 'imageRefused', { count: refused });
      if (images!.past > 0) report.add('read', 'discarded', 'imageLimit', { count: images!.past });
      await deps.db.withTenant(
        tenant,
        (trx) =>
          recordProposal(trx, found.id, {
            ...answer,
            parts: placed(answer.parts, assets),
            report: report.entries,
          }),
        forImporter(found),
      );
    },

    /** The last attempt failed for the store's or the database's reasons: never left reading. */
    async failed(tenant, job) {
      if (job.subjectId === null) return;
      const { found, store } = await load(tenant, job.subjectId);
      if (found?.state !== 'reading') return;
      await fail(tenant, store, found, 'reading_failed');
    },
  };
}

/**
 * The parts with each image refused taken out: a figure an empty paragraph in its place, an image in
 * a run of text left out. A kept one names its placeholder, an asset version from acceptance.
 */
export function placed(
  parts: readonly ProposedPart[],
  assets: ReadonlyMap<string, string | null>,
): ProposedPart[] {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap((each) => {
        const node = each as Record<string, unknown> | null;
        const asset = typeof node?.['asset'] === 'string' ? node['asset'] : undefined;
        if (asset === undefined || !assets.has(asset)) return [walk(each)];
        const version = assets.get(asset);
        if (version) return [{ ...node, asset: version }];
        if (node!['type'] === 'figure') {
          return [{ type: 'paragraph', id: node!['id'], style: 'body', content: [] }];
        }
        return [];
      });
    }
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, walk(each)]));
  };
  return parts.map((part) => ({
    ...part,
    blocks: walk(part.blocks) as ProposedPart['blocks'],
    changes: walk(part.changes) as ProposedPart['changes'],
  }));
}
