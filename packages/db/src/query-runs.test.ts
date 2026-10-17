import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { dataPolicy, setDataPolicy } from './queryDefinitions.js';
import {
  giveQuerySlot,
  queryRunsBetween,
  queryUsage,
  recordQueryRun,
  sweepQueryRuns,
  takeQuerySlot,
} from './query-runs.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';

describe('query limits and cost (data.md, "Limits and cost"; the R18 plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada: string;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });
  const take = (leaseMs = 60_000) => as((trx) => takeQuerySlot(trx, { leaseMs }));
  const give = (slot: string) => as((trx) => giveQuerySlot(trx, slot));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    ada = await service.withTenant(
      tenant,
      async (trx) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
    );
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it("DAT-071 lets no more of a tenant's runs be in flight at once than its limit, four by default, and frees a slot once given back or lapsed", async () => {
    const held: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      const slot = await take();
      expect(slot).toBeDefined();
      held.push(slot!);
    }
    expect(await take()).toBeUndefined();
    await give(held.pop()!);
    const again = await take();
    expect(again).toBeDefined();
    held.push(again!);
    for (const slot of held) await give(slot);

    // An administrator lowers it; and a slot whose run never gave it back lapses with its lease.
    await as((trx) =>
      setDataPolicy(trx, { rows: null, bytes: null, seconds: null, concurrentRuns: 1 }),
    );
    expect((await as((trx) => dataPolicy(trx))).concurrentRuns).toBe(1);
    const lapsing = await take(200);
    expect(lapsing).toBeDefined();
    expect(await take()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const after = await take();
    expect(after).toBeDefined();
    await give(after!);
    await as((trx) =>
      setDataPolicy(trx, { rows: null, bytes: null, seconds: null, concurrentRuns: null }),
    );
    // Never past the product's ceiling.
    await expect(
      as((trx) =>
        setDataPolicy(trx, { rows: null, bytes: null, seconds: null, concurrentRuns: 17 }),
      ),
    ).rejects.toThrow();
  });

  it('DAT-053 records every run - its act, who, its query, its document, its cost and its outcome - and totals them by query and by document', async () => {
    const definition = randomUUID();
    const other = randomUUID();
    const document = randomUUID();
    const connection = randomUUID();
    const run = (over: Partial<Parameters<typeof recordQueryRun>[1]>) =>
      as((trx) =>
        recordQueryRun(trx, {
          act: 'resolve',
          principal: ada,
          connection,
          queryDefinition: definition,
          document,
          durationMs: 100,
          rows: 10,
          bytes: 1000,
          outcome: 'ran',
          failure: null,
          ...over,
        }),
      );
    const from = new Date(Date.now() - 1000);
    await run({});
    await run({ act: 'check', durationMs: 50, rows: 5, bytes: 500 });
    await run({ act: 'creation', outcome: 'failed', failure: 'timeout', rows: null, bytes: null });
    await run({
      act: 'sample',
      document: null,
      queryDefinition: other,
      outcome: 'throttled',
      failure: 'query_throttled',
      durationMs: 5000,
      rows: null,
      bytes: null,
    });
    const to = new Date(Date.now() + 1000);

    const usage = await as((trx) => queryUsage(trx, { from, to }));
    expect(usage.byQueryDefinition.find((each) => each.id === definition)).toMatchObject({
      runs: 3,
      failed: 1,
      throttled: 0,
      durationMs: 250,
      rows: 15,
      bytes: 1500,
    });
    expect(usage.byQueryDefinition.find((each) => each.id === other)).toMatchObject({
      runs: 1,
      throttled: 1,
    });
    expect(usage.byDocument).toEqual([
      expect.objectContaining({ id: document, runs: 3, durationMs: 250 }),
    ]);
    const runs = await as((trx) => queryRunsBetween(trx, { from, to }));
    expect(runs.map((each) => each.act)).toEqual(['resolve', 'check', 'creation', 'sample']);
    expect(runs[2]).toMatchObject({ outcome: 'failed', failure: 'timeout', document });
  });

  it('DAT-053 keeps a run for 13 months, and sweeps it after', async () => {
    const id = await as((trx) =>
      recordQueryRun(trx, {
        act: 'sample',
        principal: ada,
        connection: randomUUID(),
        queryDefinition: randomUUID(),
        document: null,
        durationMs: 1,
        rows: 1,
        bytes: 1,
        outcome: 'ran',
        failure: null,
      }),
    );
    expect(await as((trx) => sweepQueryRuns(trx))).toBe(0);
    await expect(
      as((trx) => trx.deleteFrom('query_run').where('id', '=', id).execute()),
    ).rejects.toThrow(/13 months/);
    // As if made 14 months ago: only the schema's owner may move a row's time.
    const client = new pg.Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      await client.query(
        `update "${tenant.schema}".query_run set at = now() - interval '14 months' where id = $1`,
        [id],
      );
    } finally {
      await client.end();
    }
    expect(await as((trx) => sweepQueryRuns(trx))).toBe(1);
  });
});
