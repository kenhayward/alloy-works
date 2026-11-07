import { createHash } from 'node:crypto';
import {
  createTenant,
  migrate,
  prepareDatabase,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepIntegrityEverywhere } from './sweep.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("integrity re-verified against the tenant's own store (the DG plan, DG-K)", () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let worker: TenantDatabase;
  let stores: ObjectStores;
  let tenant: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await store.setUp(db.adminUrl, tenant);
    worker = testTenantDatabase(db.workerUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
  });

  afterAll(async () => {
    await worker.close();
    await store.drop();
    await db.drop();
  });

  /** An audit export done, its bytes put in the store, with the hash its row records. */
  const exported = async (bytes: Buffer, recorded: string) => {
    const put = await worker.withTenant(tenant, async (trx) =>
      (await stores.forTenant(trx, tenant)).put(bytes, 'application/zip'),
    );
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into "${tenant.schema}".audit_export (snapshot, state, object_key, sha256, bytes, finished_at)
       values (pg_current_snapshot(), 'done', $1, $2, $3, now()) returning id`,
      [put.key, recorded, put.size],
    );
    return { id: rows[0]!.id as string, key: put.key };
  };
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

  it('reads each object once, telling an object missing from bytes changed, and audits both', async () => {
    const intact = Buffer.from('an intact export');
    const changed = Buffer.from('an export whose bytes changed');
    const lost = Buffer.from('an export whose object is lost');
    const kept = await exported(intact, sha(intact));
    const edited = await exported(changed, sha(Buffer.from('the bytes it was written with')));
    const gone = await exported(lost, sha(lost));
    await worker.withTenant(tenant, async (trx) =>
      (await stores.forTenant(trx, tenant)).remove(gone.key),
    );

    // Three exports, so one a night; three nights check them all, and a second sweep a night none.
    const nights = [1, 2, 3].map((n) => new Date(Date.UTC(2026, 10, n, 2)));
    const results = [];
    for (const night of nights) {
      results.push(await sweepIntegrityEverywhere(worker, stores, quiet, night));
      expect(await sweepIntegrityEverywhere(worker, stores, quiet, night)).toEqual({
        checked: 0,
        failed: 0,
      });
    }
    expect(results.reduce((sum, each) => sum + each.failed, 0)).toBe(2);

    const { rows } = await queryAs(
      db.adminUrl,
      `select item, ok, failure from "${tenant.schema}".integrity_check where class = 'audit_export'
       order by item`,
    );
    expect(rows).toEqual(
      [
        { item: kept.id, ok: true, failure: null },
        { item: edited.id, ok: false, failure: 'hash_mismatch' },
        { item: gone.id, ok: false, failure: 'object_missing' },
      ].sort((a, b) => a.item.localeCompare(b.item)),
    );
    const { rows: events } = await queryAs(
      db.adminUrl,
      `select detail ->> 'failure' as failure from "${tenant.schema}".audit_event
       where kind = 'integrity.failed' and detail ->> 'class' = 'audit_export' order by sequence`,
    );
    expect(events.map((each) => each.failure as string).sort()).toEqual([
      'hash_mismatch',
      'object_missing',
    ]);
  });
});
