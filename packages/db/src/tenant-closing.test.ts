import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { placeHold, releaseHold } from './holds.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, enqueueJob, type JobQueue } from './queue.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { requestTenantExport, tenantExportsDue } from './tenant-export.js';
import {
  advanceClosure,
  cancelClosing,
  isRecentWholeExport,
  ownTenantState,
  startClosing,
  suspendTenant,
  TenantStateRefused,
} from './tenant-lifecycle.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SYSTEM = { actorKind: 'system' } as const;
const OPERATOR = { actorKind: 'vendor' } as const;

describe('closing a tenant (the TL plan, TLb)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let steward: TenantDatabase;
  let queue: JobQueue;
  let admin: pg.Client;
  let tenant: Tenant;
  let host = '';
  let ada = '';

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    steward = createTenantDatabase(db.stewardUrl);
    queue = createJobQueue(db.workerUrl);
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
    await queue?.close();
    await steward?.close();
    await worker?.close();
    await service?.close();
    await db?.drop();
  });

  /** Each test its own tenant, since each leaves it somewhere new. */
  beforeEach(async () => {
    const id = db.newTenantId();
    host = `${id}.alloy.test`;
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [host],
    });
    ada = (
      await service.withTenant(tenant, (trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
    ).id;
  });

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });
  const close = () => as((trx) => startClosing(trx, tenant, { declined: true }));
  const stateNow = async () => (await service.resolveHostname(host))?.state;
  const graceOver = () =>
    admin.query(
      `update platform.tenant set grace_ends_at = now() - interval '1 second' where id = $1`,
      [tenant.id],
    );
  const advance = () => worker.withTenant(tenant, (trx) => advanceClosure(trx, tenant), SYSTEM);
  const events = (kind: string) =>
    as((trx) =>
      sql<{ detail: Record<string, unknown>; actor_kind: string }>`
        select detail, actor_kind from audit_event where kind = ${kind} order by sequence`.execute(
        trx,
      ),
    ).then(({ rows }) => rows);

  it('ADM-030 begins 30 days of grace, audited with the answer about the export', async () => {
    await close();
    expect(await stateNow()).toBe('closing');
    const own = await as((trx) => ownTenantState(trx));
    const days = (own.graceEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThanOrEqual(30);
    expect(own.closingBy).toBe('person');
    expect((await events('tenant.closing'))[0]).toMatchObject({
      actor_kind: 'person',
      detail: { declined: true },
    });
  });

  it('ADM-029 records the export that was taken', async () => {
    const exported = await as((trx) => requestTenantExport(trx, ada));
    await as((trx) => startClosing(trx, tenant, { export: exported.id }));
    expect((await events('tenant.closing'))[0]?.detail).toMatchObject({ export: exported.id });
  });

  it('ADM-030 cancelling on the last day returns the tenant, and an export has its seven days again', async () => {
    const exported = await as((trx) => requestTenantExport(trx, ada));
    await as((trx) =>
      sql`update tenant_export set state = 'done', object_key = 'k', sha256 = 'x',
        finished_at = now() - interval '6 days' where id = ${exported.id}`.execute(trx),
    );
    await close();
    await admin.query(
      `update platform.tenant set state_since = now() - interval '29 days' where id = $1`,
      [tenant.id],
    );
    await as((trx) => cancelClosing(trx, tenant));
    expect(await stateNow()).toBe('active');
    expect(await events('tenant.closure_cancelled')).toHaveLength(1);
    expect((await as((trx) => tenantExportsDue(trx))).map((one) => one.id)).not.toContain(
      exported.id,
    );
  });

  it('will not let an administrator cancel what the operator began, and cancelling it returns to the suspension', async () => {
    await steward.withTenant(tenant, (trx) => suspendTenant(trx, tenant, 'Unpaid'), OPERATOR);
    await steward.withTenant(
      tenant,
      (trx) => startClosing(trx, tenant, { notice: 'N-1' }),
      OPERATOR,
    );
    expect(await stateNow()).toBe('closing');
    await expect(as((trx) => cancelClosing(trx, tenant))).rejects.toBeInstanceOf(
      TenantStateRefused,
    );
    expect(await stateNow()).toBe('closing');
    await steward.withTenant(tenant, (trx) => cancelClosing(trx, tenant), OPERATOR);
    expect(await stateNow()).toBe('suspended');
  });

  it("will not let a tenant's own role begin a closure for another, or a closure the grace has not reached end", async () => {
    await close();
    const client = new pg.Client({ connectionString: db.workerUrl });
    await client.connect();
    try {
      await expect(
        client.query(`select platform.change_tenant_state($1, 'deleting', null)`, [tenant.id]),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
    expect(await advance()).toBe('closing');
    expect(await stateNow()).toBe('closing');
    const other = db.newTenantId();
    const second = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: other, name: 'Sandbox' },
      hostnames: [`${other}.alloy.test`],
    });
    await expect(
      service.withTenant(
        second,
        (trx) =>
          sql`select platform.change_tenant_state(${tenant.id}, 'cancelled', null)`.execute(trx),
        { actorKind: 'person', actor: ada },
      ),
    ).rejects.toThrow(/may not change/);
  });

  it('ADM-030 begins deletion once the grace period is over and nothing is held, and says so', async () => {
    await close();
    await graceOver();
    expect(await advance()).toBe('deleting');
    expect(await stateNow()).toBe('deleting');
    expect(await events('tenant.closed')).toHaveLength(1);
  });

  it('LIF-066 keeps a tenant with a hold past its grace period, and begins deletion when the last is released', async () => {
    const spaces = await as((trx) =>
      sql<{ id: string }>`select id from space limit 1`.execute(trx),
    );
    const placed = await as((trx) =>
      placeHold(trx, {
        target: { space: spaces.rows[0]!.id },
        reason: 'A dispute',
        by: ada,
      }),
    );
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    await close();
    await graceOver();
    expect(await advance()).toBe('retained');
    expect(await stateNow()).toBe('retained');
    expect(await events('tenant.retained')).toHaveLength(1);
    // Asked again, it stays and says nothing new.
    expect(await advance()).toBe('retained');
    expect(await events('tenant.retained')).toHaveLength(1);

    await as((trx) => releaseHold(trx, { hold: placed.id, reason: 'Settled', by: ada }));
    expect(await advance()).toBe('deleting');
    expect(await stateNow()).toBe('deleting');
  });

  /** A whole export, finished the given number of days ago, and asked for then too. */
  const exportFinished = async (daysAgo: number) => {
    const made = await as((trx) => requestTenantExport(trx, ada));
    await admin.query(
      `update ${tenant.schema}.tenant_export
          set state = 'done', object_key = 'k', sha256 = 'x',
              requested_at = now() - make_interval(days => $1),
              finished_at = now() - make_interval(days => $1)
        where id = $2`,
      [daysAgo, made.id],
    );
    return made.id;
  };
  const finishedDaysAgo = async (id: string) => {
    const { rows } = await admin.query<{ days: number }>(
      `select extract(epoch from now() - finished_at) / 86400 as days
         from ${tenant.schema}.tenant_export where id = $1`,
      [id],
    );
    return Number(rows[0]!.days);
  };
  const closedDaysAgo = (days: number) =>
    admin.query(
      `update platform.tenant
          set state_since = now() - make_interval(days => $1),
              grace_ends_at = now() - make_interval(days => $1 - 30)
        where id = $2`,
      [days, tenant.id],
    );

  it('ADM-030 gives an export back the whole of a closure cancelled from retained', async () => {
    const spaces = await as((trx) =>
      sql<{ id: string }>`select id from space limit 1`.execute(trx),
    );
    await as((trx) =>
      placeHold(trx, { target: { space: spaces.rows[0]!.id }, reason: 'A dispute', by: ada }),
    );
    const before = await exportFinished(33);
    await close();
    await closedDaysAgo(31);
    expect(await advance()).toBe('retained');
    await as((trx) => cancelClosing(trx, tenant));
    expect(await finishedDaysAgo(before)).toBeCloseTo(2, 1);
  });

  it('ADM-030 gives an export taken during a closure its days, never a date to come', async () => {
    await close();
    await closedDaysAgo(20);
    const during = await exportFinished(10);
    await as((trx) => cancelClosing(trx, tenant));
    const days = await finishedDaysAgo(during);
    expect(days).toBeGreaterThanOrEqual(0);
    expect(days).toBeCloseTo(0, 1);
  });

  it('ADM-029 does not take an old export for a recent one, whatever a cancel did to its clock', async () => {
    const old = await exportFinished(5);
    await close();
    await closedDaysAgo(5);
    await as((trx) => cancelClosing(trx, tenant));
    expect(await as((trx) => isRecentWholeExport(trx, old, 24))).toBe(false);
    const fresh = await exportFinished(0);
    expect(await as((trx) => isRecentWholeExport(trx, fresh, 24))).toBe(true);
  });

  it('ADM-029 records an export taken during the closure, though a hold kept it past its grace', async () => {
    const spaces = await as((trx) =>
      sql<{ id: string }>`select id from space limit 1`.execute(trx),
    );
    const placed = await as((trx) =>
      placeHold(trx, { target: { space: spaces.rows[0]!.id }, reason: 'A dispute', by: ada }),
    );
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    await close();
    await closedDaysAgo(40);
    await exportFinished(35);
    expect(await advance()).toBe('retained');
    await as((trx) => releaseHold(trx, { hold: placed.id, reason: 'Settled', by: ada }));
    expect(await advance()).toBe('deleting');
    expect(await events('tenant.closed')).toMatchObject([{ detail: { exportTaken: true } }]);
  });

  it('ADM-028 keeps a suspension as it was through a closure given up, its reason and its time', async () => {
    const operator = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
      steward.withTenant(tenant, work, OPERATOR);
    await operator((trx) => suspendTenant(trx, tenant, 'Unpaid'));
    await admin.query(
      `update platform.tenant set state_since = now() - interval '10 days' where id = $1`,
      [tenant.id],
    );
    await operator((trx) => startClosing(trx, tenant, { notice: 'Contract 9 ended' }));
    await operator((trx) => cancelClosing(trx, tenant));
    expect(await stateNow()).toBe('suspended');
    const { rows } = await admin.query<{ state_reason: string; days: number }>(
      `select state_reason, extract(epoch from now() - state_since) / 86400 as days
         from platform.tenant where id = $1`,
      [tenant.id],
    );
    expect(rows[0]!.state_reason).toBe('Unpaid');
    expect(Number(rows[0]!.days)).toBeCloseTo(10, 1);
  });

  it('gives up on an export whose worker died while its tenant closes', async () => {
    await close();
    const kept = await as((trx) => requestTenantExport(trx, ada));
    await admin.query(
      `update platform.job set attempts = max_attempts, locked_until = now() - interval '1 second'
        where subject_id = $1`,
      [kept.id],
    );
    expect((await queue.abandoned()).map((job) => job.subjectId)).toContain(kept.id);
  });

  it('ADM-030 can still be cancelled while retained, since nothing has gone', async () => {
    const spaces = await as((trx) =>
      sql<{ id: string }>`select id from space limit 1`.execute(trx),
    );
    await as((trx) =>
      placeHold(trx, { target: { space: spaces.rows[0]!.id }, reason: 'A dispute', by: ada }),
    );
    await close();
    await graceOver();
    await advance();
    await as((trx) => cancelClosing(trx, tenant));
    expect(await stateNow()).toBe('active');
  });

  it('LIF-021 refuses a hold once deletion has begun, however late the gate heard', async () => {
    const spaces = await as((trx) =>
      sql<{ id: string }>`select id from space limit 1`.execute(trx),
    );
    await close();
    await graceOver();
    await advance();
    const late = await as((trx) =>
      placeHold(trx, { target: { space: spaces.rows[0]!.id }, reason: 'Too late', by: ada }),
    );
    expect(late.answer).toBe('environment_deleting');
    expect(await as((trx) => trx.selectFrom('legal_hold').selectAll().execute())).toEqual([]);
  });

  it('LIF-021 has a hold and the move to deletion take turns, so neither is lost', async () => {
    const spaces = await as((trx) =>
      sql<{ id: string }>`select id from space limit 1`.execute(trx),
    );
    await close();
    await graceOver();
    const [placed, moved] = await Promise.all([
      as((trx) =>
        placeHold(trx, { target: { space: spaces.rows[0]!.id }, reason: 'A race', by: ada }),
      ),
      advance(),
    ]);
    if (placed.answer === 'placed') expect(moved).toBe('retained');
    else {
      expect(placed.answer).toBe('environment_deleting');
      expect(moved).toBe('deleting');
    }
  });

  it('claims only the export for a tenant closing, and nothing once deletion has begun', async () => {
    // What earlier tests' exports left on the queue.
    for (;;) {
      const left = await queue.claim({ workerId: 'w', leaseMs: 60_000, kinds: ['tenant_export'] });
      if (!left) break;
      await queue.complete(left);
    }
    const kept = randomUUID();
    const other = randomUUID();
    await as(async (trx) => {
      await enqueueJob(trx, 'tenant_export', kept);
      await enqueueJob(trx, 'sample_pdf', other);
    });
    await close();
    const claim = (kinds: string[]) => queue.claim({ workerId: 'w', leaseMs: 60_000, kinds });
    expect(await claim(['sample_pdf'])).toBeUndefined();
    const job = await claim(['tenant_export']);
    expect(job?.subjectId).toBe(kept);
    await queue.complete(job!);
    await as((trx) => enqueueJob(trx, 'tenant_export', randomUUID()));
    await graceOver();
    await advance();
    expect(await claim(['tenant_export'])).toBeUndefined();
  });
});
