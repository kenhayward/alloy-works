import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { sweepImports } from './imports.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, enqueueJob, type JobQueue } from './queue.js';
import type { TenantTransaction } from './tables.js';
import { requestTenantExport, tenantExportsDue } from './tenant-export.js';
import { createServiceIdentity } from './service-identities.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { resumeTenant, suspendTenant, TenantStateRefused } from './tenant-lifecycle.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createWebhookSubscription, recordAttempt, sweepWebhookDeliveries } from './webhooks.js';

const HOST = 'lifecycle.alloy.test';
const OPERATOR = { actorKind: 'vendor' } as const;

describe("a tenant's state (the TL plan, TLa)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let other: Tenant;
  let service: TenantDatabase;
  let steward: TenantDatabase;
  let queue: JobQueue;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Sandbox' },
      hostnames: ['sandbox.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    steward = createTenantDatabase(db.stewardUrl);
    queue = createJobQueue(db.workerUrl);
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await steward?.close();
    await service?.close();
    await db?.drop();
  });

  const suspend = (reason = 'A contract has lapsed') =>
    steward.withTenant(tenant, (trx) => suspendTenant(trx, tenant, reason), OPERATOR);
  const resume = () => steward.withTenant(tenant, (trx) => resumeTenant(trx, tenant), OPERATOR);
  const stateNow = async () => (await service.resolveHostname(HOST))?.state;

  /** Every row of every table but the log, read as text: whether anything moved. */
  const everyRow = (trx: TenantTransaction) =>
    sql<{ digest: string }>`
      select md5(string_agg(t.table_name || ':' || t.rows, ',' order by t.table_name)) as digest
        from (
          select c.table_name,
                 (xpath('/row/c/text()', query_to_xml(format(
                   'select coalesce(md5(string_agg(to_jsonb(r)::text, %L order by to_jsonb(r)::text)), %L) as c from %I.%I r',
                   ',', '', c.table_schema, c.table_name), false, true, '')))[1]::text as rows
            from information_schema.tables c
           where c.table_schema = current_schema()
             and c.table_type = 'BASE TABLE'
             and c.table_name not in ('audit_event', 'audit_label', 'schema_migration')
        ) t`.execute(trx);

  it('ADM-028 suspends a tenant, keeps the reason, and lifting leaves every row as it was', async () => {
    const before = (await service.withTenant(tenant, everyRow)).rows[0]!.digest;
    expect(await stateNow()).toBe('active');

    await suspend('A contract has lapsed');
    expect(await stateNow()).toBe('suspended');
    const held = await service.withTenant(tenant, (trx) =>
      sql<{ kind: string; detail: { reason: string }; actor_kind: string }>`
        select kind, detail, actor_kind from audit_event
         where kind = 'tenant.suspended' order by sequence desc limit 1`.execute(trx),
    );
    expect(held.rows[0]).toMatchObject({
      actor_kind: 'vendor',
      detail: { reason: 'A contract has lapsed' },
    });

    await resume();
    expect(await stateNow()).toBe('active');
    const lifted = await service.withTenant(tenant, (trx) =>
      sql<{ detail: { suspendedSeconds: number } }>`
        select detail from audit_event
         where kind = 'tenant.resumed' order by sequence desc limit 1`.execute(trx),
    );
    expect(lifted.rows[0]?.detail.suspendedSeconds).toBeGreaterThanOrEqual(0);
    expect((await service.withTenant(tenant, everyRow)).rows[0]!.digest).toBe(before);
  });

  it('refuses a change a state does not allow, and records nothing', async () => {
    await expect(resume()).rejects.toBeInstanceOf(TenantStateRefused);
    await suspend();
    await expect(suspend()).rejects.toBeInstanceOf(TenantStateRefused);
    const events = await service.withTenant(tenant, (trx) =>
      sql<{ count: number }>`select count(*)::int as count from audit_event
        where kind = 'tenant.suspended'`.execute(trx),
    );
    await resume();
    expect(events.rows[0]?.count).toBe(2);
  });

  it("will not let a tenant's own role, the service or a worker change a state", async () => {
    await suspend();
    try {
      for (const url of [db.serviceUrl, db.workerUrl]) {
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
          await client.query(`set role ${client.escapeIdentifier(tenant.role)}`);
          await expect(
            client.query(`select platform.change_tenant_state($1, 'active', null)`, [tenant.id]),
          ).rejects.toThrow(/may not change/);
          await expect(
            client.query(`select platform.change_tenant_state($1, 'suspended', null)`, [other.id]),
          ).rejects.toThrow(/may not change/);
          await client.query('reset role');
          await expect(
            client.query(`select platform.change_tenant_state($1, 'active', null)`, [tenant.id]),
          ).rejects.toThrow();
          await expect(
            client.query(`update platform.tenant set state = 'active' where id = $1`, [tenant.id]),
          ).rejects.toThrow();
        } finally {
          await client.end();
        }
      }
      expect(await stateNow()).toBe('suspended');
    } finally {
      await resume();
    }
  });

  it('fails no abandoned job in a suspended tenant until the suspension lifts', async () => {
    const subject = randomUUID();
    await service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', subject));
    const job = await queue.claim({ workerId: 'w', leaseMs: 1, kinds: ['sample_pdf'] });
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `update platform.job set attempts = max_attempts, locked_until = now() - interval '1 minute'
          where id = $1`,
        [job!.id],
      );
    } finally {
      await admin.end();
    }
    await suspend();
    try {
      expect(await queue.abandoned()).toEqual([]);
    } finally {
      await resume();
    }
    expect((await queue.abandoned()).map((one) => one.id)).toContain(job!.id);
  });

  /** Moves a suspension's start back, as though that long had passed. */
  const suspendedFor = async (hours: number) => {
    await suspend();
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `update platform.tenant set state_since = now() - make_interval(hours => $2)
          where id = $1`,
        [tenant.id, hours],
      );
    } finally {
      await admin.end();
    }
    await resume();
  };

  const newPerson = (trx: TenantTransaction) =>
    trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ada-${randomUUID()}`,
        email: null,
        display_name: 'Ada',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  it('ADM-028 does not disable a subscription for days a suspension took from its failing', async () => {
    const { delivery } = await service.withTenant(tenant, async (trx) => {
      const { id: ada } = await newPerson(trx);
      const identity = await createServiceIdentity(trx, {
        name: 'Failing courier',
        description: '',
        by: ada,
      });
      const made = await createWebhookSubscription(trx, {
        id: randomUUID(),
        serviceIdentity: identity.id,
        url: 'https://receiver.example.test/failing',
        description: 'Failing feed',
        eventTypes: ['artifact.archived'] as never,
        sealed: 'sealed-for-the-test',
        by: ada,
      });
      const id = randomUUID();
      await sql`insert into webhook_delivery
          (id, subscription_id, type, sequence, payload, attempts, first_attempt_at)
        values (${id}, ${made.id}, 'artifact.archived', 'audit:9', '{}'::jsonb, 1, now())`.execute(
        trx,
      );
      await recordAttempt(trx, id, { kind: 'failed', failure: 'unreachable', latencyMs: 1 });
      // Failing for 73 hours by the clock, its last attempt 14 hours back, so it is no quiet endpoint.
      await sql`update webhook_subscription set failing_since = now() - interval '73 hours'
        where id = ${made.id}`.execute(trx);
      await sql`update webhook_attempt set at = now() - interval '14 hours'
        where delivery_id = ${id}`.execute(trx);
      return { delivery: id };
    });
    await suspendedFor(13);
    const answer = await service.withTenant(tenant, (trx) =>
      recordAttempt(trx, delivery, { kind: 'failed', failure: 'unreachable', latencyMs: 1 }),
    );
    expect(answer.disabled).toBeUndefined();
  });

  it('ADM-028 leaves a proposal and a finished export as long to run as when it was suspended', async () => {
    const { imported, exported } = await service.withTenant(tenant, async (trx) => {
      const { id: ada } = await newPerson(trx);
      const space = await sql<{ id: string }>`select id from space limit 1`.execute(trx);
      const made = await sql<{ id: string }>`
        insert into import (space_id, importer, file_name, file_type, levels)
        values (${space.rows[0]!.id}, ${ada}, 'notes.docx', 'docx', '{}'::jsonb)
        returning id`.execute(trx);
      const old = await requestTenantExport(trx, ada);
      await sql`update import set state = 'proposed', touched_at = now() - interval '25 days'
        where id = ${made.rows[0]!.id}`.execute(trx);
      await sql`update tenant_export set state = 'done', object_key = 'k', sha256 = 'x', finished_at = now() - interval '5 days'
        where id = ${old.id}`.execute(trx);
      return { imported: made.rows[0]!.id, exported: old.id };
    });
    await suspendedFor(240);
    const swept = await service.withTenant(tenant, (trx) => sweepImports(trx, async () => {}));
    expect(swept).toEqual({ warned: 0, swept: 0 });
    const due = await service.withTenant(tenant, (trx) => tenantExportsDue(trx));
    expect(due.map((one) => one.id)).not.toContain(exported);
    const still = await service.withTenant(tenant, (trx) =>
      sql<{ state: string }>`select state from import where id = ${imported}`.execute(trx),
    );
    expect(still.rows[0]?.state).toBe('proposed');
  });

  it('leaves another tenant running', async () => {
    await suspend();
    try {
      expect((await service.resolveHostname('sandbox.alloy.test'))?.state).toBe('active');
    } finally {
      await resume();
    }
  });

  it('holds a job through a suspension and runs it after, and lists the tenant for no sweep', async () => {
    const subject = randomUUID();
    await service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', subject));
    await suspend();
    const claim = () => queue.claim({ workerId: 'w', leaseMs: 60_000, kinds: ['sample_pdf'] });
    try {
      expect(await claim()).toBeUndefined();
      expect((await service.liveTenants()).map((one) => one.id)).not.toContain(tenant.id);
      // What migrations must still reach.
      expect((await service.tenants()).map((one) => one.id)).toContain(tenant.id);
    } finally {
      await resume();
    }
    const job = await claim();
    expect(job?.subjectId).toBe(subject);
    await queue.complete(job!);
    expect((await service.liveTenants()).map((one) => one.id)).toContain(tenant.id);
  });

  it('ADM-028 keeps a webhook mid-retry through a suspension longer than its day of trying', async () => {
    const delivery = randomUUID();
    const settled = randomUUID();
    await service.withTenant(tenant, async (trx) => {
      const { id: ada } = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: `ada-${randomUUID()}`,
          email: null,
          display_name: 'Ada',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const identity = await createServiceIdentity(trx, {
        name: 'Courier',
        description: '',
        by: ada,
      });
      const made = await createWebhookSubscription(trx, {
        id: randomUUID(),
        serviceIdentity: identity.id,
        url: 'https://receiver.example.test/hooks',
        description: 'Courier feed',
        eventTypes: ['artifact.archived'] as never,
        sealed: 'sealed-for-the-test',
        by: ada,
      });
      // Tried for 23 hours, and nearly 30 days old: an hour from giving up, a day from being swept.
      for (const [id, state, sequence] of [
        [delivery, 'pending', 'audit:1'],
        [settled, 'delivered', 'audit:2'],
      ] as const) {
        await sql`insert into webhook_delivery
            (id, subscription_id, type, sequence, payload, state, attempts, first_attempt_at, created_at)
          values (${id}, ${made.id}, 'artifact.archived', ${sequence}, '{}'::jsonb, ${state}, 3,
            now() - interval '23 hours', now() - interval '29 days')`.execute(trx);
      }
    });
    const row = (id: string) =>
      service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('webhook_delivery')
          .select(['state', 'created_at'])
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    const settledBefore = await row(settled);

    await suspend();
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      // Two days have passed.
      await admin.query(
        `update platform.tenant set state_since = now() - interval '2 days' where id = $1`,
        [tenant.id],
      );
    } finally {
      await admin.end();
    }
    await resume();

    await service.withTenant(tenant, (trx) =>
      recordAttempt(trx, delivery, { kind: 'failed', failure: 'unreachable', latencyMs: 1 }),
    );
    expect((await row(delivery))?.state).toBe('pending');
    await service.withTenant(tenant, (trx) => sweepWebhookDeliveries(trx));
    expect(await row(delivery)).toBeDefined();
    // Only what was still waiting: a delivery already done keeps its own age.
    expect((await row(settled))?.created_at).toEqual(settledBefore?.created_at);
  });
});
