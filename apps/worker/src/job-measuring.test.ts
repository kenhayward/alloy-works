import type { Job, JobQueue, Measured, Tenant, TenantDatabase } from '@alloy-works/db';
import { JOB_CAPABILITIES } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { JobRefused } from './refusal.js';
import { processNext, type JobHandler } from './worker.js';

const ACME = {
  id: 'acme',
  schema: 't_acme',
  role: 't_acme_role',
  name: 'Acme',
} as unknown as Tenant;
const quiet = { info() {}, warn() {}, error() {} };

/** A queue holding one job, which is claimed once. */
function queueOf(kind: string): JobQueue {
  let job: Job | undefined = {
    id: 'j1',
    tenantId: 'acme',
    kind,
    subjectId: null,
    attempts: 1,
    maxAttempts: 3,
  };
  return {
    abandoned: async () => [],
    claim: async () => {
      const claimed = job;
      job = undefined;
      return claimed;
    },
    complete: async () => {},
    fail: async () => 'retry',
  } as unknown as JobQueue;
}

const db = { tenant: async () => ACME } as unknown as TenantDatabase;

async function measure(kind: string, run: JobHandler['run']) {
  const recorded: { tenant: string; capability: string; measured: Measured }[] = [];
  await processNext({
    queue: queueOf(kind),
    db,
    handlers: { [kind]: { run, failed: async () => {} } },
    workerId: 'w1',
    leaseMs: 60_000,
    log: quiet,
    measuring: {
      record: (tenant, capability, measured) =>
        recorded.push({ tenant: tenant.id, capability, measured }),
    },
  });
  return recorded;
}

describe("the worker's jobs measured by their kind of work (the DG plan, DG-C)", () => {
  it('counts a job under its kind of work, a failure as the server failing and a refusal as the input', async () => {
    expect(await measure('publish', async () => {})).toEqual([
      {
        tenant: 'acme',
        capability: 'Publishing work',
        measured: expect.objectContaining({ status: 200, refused: false }),
      },
    ]);
    const failing = await measure('embed', async () => {
      throw new Error('down');
    });
    expect(failing[0]).toMatchObject({ capability: 'Indexing', measured: { status: 500 } });
    const refused = await measure('import', async () => {
      throw new JobRefused('unreadable', 'the file could not be read');
    });
    expect(refused[0]).toMatchObject({ capability: 'Importing', measured: { status: 422 } });
  });

  it('names each kind of work as a capability is named', () => {
    for (const capability of Object.values(JOB_CAPABILITIES)) {
      expect(capability).toMatch(/^[A-Z][A-Za-z ]{0,63}$/);
    }
  });
});
