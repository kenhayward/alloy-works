import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, type JobQueue } from './queue.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { advanceClosure, startClosing } from './tenant-lifecycle.js';
import { createStewardDatabase, type StewardDatabase } from './tenant-purge.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const REPORT = {
  schemaPresent: false,
  roles: 0,
  hostnames: 0,
  jobs: 0,
  objects: 0,
  credentialPresent: false,
  deliveredPresent: null,
};

describe('removing a tenant from the database (the TL plan, TLc)', () => {
  let db: TestDatabase;
  let admin: pg.Client;
  let steward: StewardDatabase;
  let operator: TenantDatabase;
  let worker: TenantDatabase;
  let service: TenantDatabase;
  let queue: JobQueue;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    steward = createStewardDatabase(db.stewardUrl);
    operator = createTenantDatabase(db.stewardUrl);
    worker = testTenantDatabase(db.workerUrl);
    service = testTenantDatabase(db.serviceUrl);
    queue = createJobQueue(db.stewardUrl);
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await service?.close();
    await worker?.close();
    await operator?.close();
    await steward?.close();
    await admin?.end();
    await db?.drop();
  });

  const makeTenant = async (name = 'Production') => {
    const id = db.newTenantId();
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    return { tenant, host: `${id}.alloy.test` };
  };

  /** Closed by the operator, its grace over, and moved on as the sweep moves it. */
  const toDeleting = async (tenant: Tenant, notice = 'Contract ended') => {
    await operator.withTenant(tenant, (trx) => startClosing(trx, tenant, { notice }), {
      actorKind: 'vendor',
    });
    await admin.query(
      `update platform.tenant set grace_ends_at = now() - interval '1 second' where id = $1`,
      [tenant.id],
    );
    await worker.withTenant(tenant, (trx) => advanceClosure(trx, tenant), { actorKind: 'system' });
  };

  it('IAM-086 removes the schema and both roles with no more than the steward holds', async () => {
    const { tenant } = await makeTenant();
    const { rows } = await admin.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
      `select rolsuper, rolcreaterole from pg_roles where rolname = 'aw_steward'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolcreaterole: true });
    await toDeleting(tenant);
    await steward.removeHostnames(tenant);
    await steward.dropTenantDatabase(tenant);
    expect(await steward.whatRemains(tenant)).toEqual({
      schemaPresent: false,
      roles: 0,
      hostnames: 0,
      jobs: 0,
    });
  });

  it('runs again, having been stopped anywhere, and leaves a neighbour with a similar id', async () => {
    const { tenant } = await makeTenant();
    const neighbour = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: `${tenant.id}x`, name: 'Next door' },
      hostnames: [`${tenant.id}x.alloy.test`],
    });
    await toDeleting(tenant);
    await steward.dropTenantDatabase(tenant);
    await steward.dropTenantDatabase(tenant);
    expect((await steward.whatRemains(tenant)).schemaPresent).toBe(false);
    const profile = await service.withTenant(neighbour, (trx) =>
      trx.selectFrom('profile').select('display_name').executeTakeFirst(),
    );
    expect(profile?.display_name).toBe('Next door');
  });

  it('LIF-066 will not remove a tenant that is not being deleted, whatever asks', async () => {
    const { tenant } = await makeTenant();
    await expect(steward.dropTenantDatabase(tenant)).rejects.toThrow(/not being deleted/);
    expect((await steward.whatRemains(tenant)).schemaPresent).toBe(true);
    await operator.withTenant(tenant, (trx) => startClosing(trx, tenant, { notice: 'N' }), {
      actorKind: 'vendor',
    });
    await expect(steward.dropTenantDatabase(tenant)).rejects.toThrow(/not being deleted/);
    await expect(steward.recordDeleted(tenant, REPORT)).rejects.toThrow(/not being deleted/);
    expect((await steward.whatRemains(tenant)).schemaPresent).toBe(true);
  });

  it('IAM-086 keeps migrating, bootstrapping and making tenants after a purge', async () => {
    const { tenant } = await makeTenant();
    await toDeleting(tenant);
    await steward.removeHostnames(tenant);
    await steward.dropTenantDatabase(tenant);
    await migrate(db.migratorUrl);
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    expect(await service.tenant(tenant.id)).toBeUndefined();
    expect((await service.tenants()).map((each) => each.id)).not.toContain(tenant.id);
    await steward.recordDeleted(tenant, REPORT);
    await migrate(db.migratorUrl);
    const { tenant: later } = await makeTenant('Later');
    expect((await service.tenants()).map((each) => each.id)).toContain(later.id);
  });

  it('IAM-086 keeps a record naming nobody: the dates, the report, and no reason or job', async () => {
    const MARKER = 'Grace-Hopper-marker';
    const { tenant } = await makeTenant();
    await toDeleting(tenant, MARKER);
    await steward.removeHostnames(tenant);
    await steward.dropTenantDatabase(tenant);
    await steward.recordDeleted(tenant, REPORT);
    const record = await steward.record(tenant.id);
    expect(record).toMatchObject({ state: 'deleted', report: REPORT });
    expect(record?.deletedAt).toBeInstanceOf(Date);
    expect(record?.deletionBeganAt).toBeInstanceOf(Date);
    const { rows: tables } = await admin.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'platform'`,
    );
    for (const { tablename } of tables) {
      const { rows } = await admin.query<{ n: number }>(
        `select count(*)::int as n from platform.${tablename} r where r::text like $1`,
        [`%${MARKER}%`],
      );
      expect(rows[0]!.n, tablename).toBe(0);
    }
    const { rows: jobs } = await admin.query(`select 1 from platform.job where tenant_id = $1`, [
      tenant.id,
    ]);
    expect(jobs).toEqual([]);
  });

  it('claims a purge only while its tenant is being deleted', async () => {
    // What earlier tests' purges left on the queue.
    for (;;) {
      const left = await queue.claim({ workerId: 's', leaseMs: 60_000, kinds: ['tenant_purge'] });
      if (!left) break;
      await queue.complete(left);
    }
    const { tenant } = await makeTenant();
    await admin.query(
      `insert into platform.job (tenant_id, kind, max_attempts) values ($1, 'tenant_purge', 10)`,
      [tenant.id],
    );
    const claim = () => queue.claim({ workerId: 's', leaseMs: 60_000, kinds: ['tenant_purge'] });
    expect(await claim()).toBeUndefined();
    await toDeleting(tenant);
    expect((await claim())?.tenantId).toBe(tenant.id);
  });

  it('IAM-086 queues a purge as deletion begins, ten attempts of it', async () => {
    const { tenant } = await makeTenant();
    await toDeleting(tenant);
    const { rows } = await admin.query(
      `select max_attempts from platform.job where tenant_id = $1 and kind = 'tenant_purge'`,
      [tenant.id],
    );
    expect(rows).toEqual([{ max_attempts: 10 }]);
  });

  it('IAM-086 queues again a purge that gave up, and says when one is past the day', async () => {
    const { tenant } = await makeTenant();
    await toDeleting(tenant);
    await admin.query(
      `update platform.job set attempts = max_attempts, locked_until = now() - interval '1 second'
        where tenant_id = $1 and kind = 'tenant_purge'`,
      [tenant.id],
    );
    await admin.query(
      `update platform.tenant set state_since = now() - interval '25 hours' where id = $1`,
      [tenant.id],
    );
    const { requeued, overdue } = await steward.requeueStuckPurges();
    expect(requeued).toBeGreaterThanOrEqual(1);
    expect(overdue).toContain(tenant.id);
    const { rows } = await admin.query(
      `select 1 from platform.job
        where tenant_id = $1 and kind = 'tenant_purge' and failed_at is null and attempts = 0`,
      [tenant.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('puts a purge off without spending an attempt', async () => {
    const { tenant } = await makeTenant();
    await toDeleting(tenant);
    await admin.query(
      `update platform.job set run_after = now() - interval '1 second' where tenant_id = $1`,
      [tenant.id],
    );
    const job = await queue.claim({ workerId: 's', leaseMs: 60_000, kinds: ['tenant_purge'] });
    await queue.postpone(job!, 60_000);
    const { rows } = await admin.query<{ attempts: number; waits: boolean }>(
      `select attempts, run_after > now() as waits from platform.job where id = $1`,
      [job!.id],
    );
    expect(rows[0]).toEqual({ attempts: 0, waits: true });
  });
});
