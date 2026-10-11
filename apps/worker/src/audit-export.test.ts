import {
  createJobQueue,
  createTenant,
  migrate,
  prepareDatabase,
  readAuditExport,
  recordEvent,
  requestAuditExport,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditExportJob } from './jobs/audit-export.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
const SPACE = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';

describe('an audit export, from the queue to the store', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let principal: string;

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await store.setUp(db.adminUrl, tenant);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
    handlers = { audit_export: auditExportJob({ db: worker, stores }) };
    principal = await service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  });

  afterAll(async () => {
    await queue.close();
    await worker.close();
    await service.close();
    await store.drop();
    await db.drop();
  });

  const work = () =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 60_000,
      log: quiet,
    });

  it("ADM-039 writes every event the export asked for into the tenant's own store, and records where", async () => {
    await service.withTenant(tenant, async (trx) => {
      for (let each = 0; each < 120; each += 1) {
        await recordEvent(
          trx,
          { kind: 'space.renamed', subject: { kind: 'space', id: SPACE }, space: SPACE },
          [{ role: 'space', text: `Name ${each}`, refersTo: SPACE }],
        );
      }
    });
    const asked = await service.withTenant(tenant, (trx) =>
      requestAuditExport(trx, principal, { kind: 'space.renamed' }),
    );
    expect(await work()).toBe('done');

    const row = (await service.withTenant(tenant, (trx) => readAuditExport(trx, asked.id)))!;
    expect(row).toMatchObject({ state: 'done', events: 120 });
    const kept = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const text = new TextDecoder().decode(await kept.get(row.key!));
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string });
    expect(lines).toHaveLength(120);
    expect(lines.every((line) => line.kind === 'space.renamed')).toBe(true);
    expect(row.bytes).toBe(new TextEncoder().encode(text).length);
  });
});
