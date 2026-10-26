import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  applyReturn,
  failReturn,
  loadFactsFor,
  readReturn,
  type ReturnedFiles,
  type ReturnFailure,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { decide, type AuditContext } from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';
import { IMPORT_BUDGET, type ImportBudget } from './import.js';

/** What a read in its thread answers: each file's units, or why the file is refused whole. */
export type ReturnThreadAnswer =
  | { readonly ok: true; readonly target: string | null; readonly files: ReturnedFiles }
  | {
      readonly ok: false;
      readonly refusal:
        'malformed' | 'unsafe' | 'not_xliff' | 'duplicate' | 'unsupported' | 'timeout' | 'memory';
    };

const SCRIPT = new URL(
  import.meta.url.endsWith('.ts') ? './xliff-read.ts' : './xliff-read.js',
  import.meta.url,
);

/** The file read in a thread of its own, within an import's budget (XL-F). */
export function readReturnInThread(
  bytes: Uint8Array,
  budget: ImportBudget = IMPORT_BUDGET,
): Promise<ReturnThreadAnswer> {
  return new Promise((resolve, reject) => {
    const thread = new Worker(SCRIPT, {
      workerData: { bytes },
      resourceLimits: { maxOldGenerationSizeMb: budget.memoryMb, maxYoungGenerationSizeMb: 64 },
    });
    let settled = false;
    const settle = (answer: ReturnThreadAnswer | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void thread.terminate();
      if (answer instanceof Error) reject(answer);
      else resolve(answer);
    };
    const timer = setTimeout(() => settle({ ok: false, refusal: 'timeout' }), budget.timeMs);
    thread.on('message', (answer: ReturnThreadAnswer) => settle(answer));
    thread.on('error', (error: Error & { code?: string }) =>
      settle(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? { ok: false, refusal: 'memory' } : error),
    );
    thread.on('exit', (code) => settle(new Error(`The read's thread ended with ${code}`)));
  });
}

/** Each refusal as the return records it: the file's fault, by code. */
const FAILURES: Readonly<
  Record<Extract<ReturnThreadAnswer, { ok: false }>['refusal'], ReturnFailure>
> = {
  malformed: 'file_unreadable',
  unsafe: 'file_unsafe',
  not_xliff: 'file_not_xliff',
  duplicate: 'file_unreadable',
  unsupported: 'file_unreadable',
  timeout: 'file_too_large',
  memory: 'file_too_large',
};

/**
 * **The `translation_return` job** (the XL plan, XL-F): a job's returned file read back from the store
 * and held to its hash, read in a thread within an import's budget, and applied for its uploader, who
 * must still edit each component; or, where the file is at fault, the return failed whole and the job
 * finished.
 */
export function translationReturnJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly budget?: ImportBudget;
}): JobHandler {
  const budget = deps.budget ?? IMPORT_BUDGET;
  /** The job acts as the system, for whoever returned the file (AU1-D). */
  const forUploader = (by: string): AuditContext => ({ actorKind: 'system', requestedBy: by });

  return {
    async run(tenant: Tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const { found, store } = await deps.db.withTenant(tenant, async (trx) => ({
        found: await readReturn(trx, id),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      // Nothing to do: another attempt already read it.
      if (!found || found.return.state !== 'reading') return;
      const by = found.return.by;
      const bytes = await store.get(found.return.objectKey);
      if (createHash('sha256').update(bytes).digest('hex') !== found.return.sha256) {
        // The store answered with other bytes than the key names: its fault, tried again.
        throw new Error('The stored bytes do not match their hash');
      }
      const answer = await readReturnInThread(new Uint8Array(bytes), budget);
      if (!answer.ok) {
        await deps.db.withTenant(
          tenant,
          (trx) => failReturn(trx, id, FAILURES[answer.refusal]),
          forUploader(by),
        );
        // Refused on its merits: the same file fails the same way every time.
        throw new JobRefused('translation_return_refused', 'The file could not be read');
      }
      await deps.db.withTenant(
        tenant,
        async (trx) => {
          const facts = await loadFactsFor(
            trx,
            by,
            found.job.items.map((item) => item.component),
          );
          await applyReturn(trx, {
            id,
            target: answer.target,
            files: answer.files,
            mayEdit: async (component) => {
              const known = facts.get(component);
              return known !== undefined && decide('edit', known).allowed;
            },
          });
        },
        forUploader(by),
      );
    },

    /** The last attempt failed for the store's or the database's reasons: never left reading. */
    async failed(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const by = await deps.db.withTenant(
        tenant,
        async (trx) => (await readReturn(trx, id))?.return.by,
      );
      if (by === undefined) return;
      await deps.db.withTenant(
        tenant,
        (trx) => failReturn(trx, id, 'reading_failed'),
        forUploader(by),
      );
    },
  };
}
