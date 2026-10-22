import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  failImport,
  readImport,
  recordProposal,
  type ImportFailure,
  type ImportFileType,
  type StoredImport,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { AuditContext, ImportLevels, ProposedPart, ReportEntry } from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';

/** What a read in its thread answers: the proposal, or why there is none. */
export type ThreadAnswer =
  | {
      readonly ok: true;
      readonly parts: readonly ProposedPart[];
      readonly report: readonly ReportEntry[];
      readonly title: string | null;
      readonly language: string | null;
    }
  | {
      readonly ok: false;
      readonly refusal: 'unreadable' | 'unsafe' | 'tooLarge' | 'timeout' | 'memory';
    };

/** A read's budget (IM-C): past its time the thread is ended, past its memory the thread dies. */
export interface ImportBudget {
  readonly timeMs: number;
  readonly memoryMb: number;
}

export const IMPORT_BUDGET: ImportBudget = { timeMs: 60_000, memoryMb: 512 };

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
}): JobHandler {
  const read = deps.read ?? readInThread;

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
      const answer = await read(
        { bytes: new Uint8Array(bytes), type: found.fileType, levels: found.levels },
        deps.budget,
      );
      if (!answer.ok) {
        await fail(tenant, store, found, FAILURES[answer.refusal]);
        // Refused on its merits: the same file fails the same way every time (issue #146).
        throw new JobRefused('import_refused', 'The file could not be read into a proposal');
      }
      await deps.db.withTenant(
        tenant,
        (trx) => recordProposal(trx, found.id, answer),
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
