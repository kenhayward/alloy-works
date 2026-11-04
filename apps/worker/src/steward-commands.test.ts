import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSteward } from './steward-commands.js';

const HOST = 'steward.alloy.test';

describe("the operator's command line (the TL plan, TL-P)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let steward: TenantDatabase;
  let service: TenantDatabase;
  const lines: string[] = [];
  const run = (...argv: string[]) =>
    runSteward(argv, { db: steward, out: (line) => lines.push(line) });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    steward = createTenantDatabase(db.stewardUrl);
    service = testTenantDatabase(db.serviceUrl);
  }, 120_000);

  afterAll(async () => {
    await steward?.close();
    await service?.close();
    await db?.drop();
  });

  it('ADM-028 suspends and resumes a tenant named by its id, recording the reason', async () => {
    expect(await run('suspend', '--tenant', tenant.id, '--reason', 'Unpaid since March')).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('suspended');
    const { rows } = await service.withTenant(tenant, (trx) =>
      sql<{ actor_kind: string; detail: { reason: string } }>`
        select actor_kind, detail from audit_event where kind = 'tenant.suspended'`.execute(trx),
    );
    expect(rows).toEqual([{ actor_kind: 'vendor', detail: { reason: 'Unpaid since March' } }]);

    expect(await run('resume', '--tenant', tenant.id)).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('active');
  });

  it('ADM-030 closes a tenant at a contract\'s end with a notice, and only the operator cancels it', async () => {
    expect(await run('close', '--tenant', tenant.id)).toBe(2);
    expect(await run('close', '--tenant', tenant.id, '--notice', 'Contract 7 ended')).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('closing');
    const { rows } = await service.withTenant(tenant, (trx) =>
      sql<{ actor_kind: string; detail: { notice: string } }>`
        select actor_kind, detail from audit_event where kind = 'tenant.closing'`.execute(trx),
    );
    expect(rows[0]).toMatchObject({ actor_kind: 'vendor', detail: { notice: 'Contract 7 ended' } });
    expect(await run('cancel', '--tenant', tenant.id)).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('active');
  });

  it('refuses a suspension with no reason, an unknown tenant, a command it does not know and a change that does not apply', async () => {
    expect(await run('suspend', '--tenant', tenant.id)).toBe(2);
    expect(await run('suspend', '--tenant', tenant.id, '--reason', 'x'.repeat(2001))).toBe(2);
    expect(await run('suspend', '--tenant', 'nobody', '--reason', 'x')).toBe(1);
    expect(await run('drop', '--tenant', tenant.id)).toBe(2);
    expect(await run('resume', '--tenant', tenant.id)).toBe(1);
    expect(lines.join('\n')).toMatch(/is active/);
    expect((await service.resolveHostname(HOST))?.state).toBe('active');
  });
});
