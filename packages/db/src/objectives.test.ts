import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { backupRecord, recordServiceProbe, serviceAvailability } from './objectives.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('the objectives measured: the service probed, backups and drills recorded (the DG plan, pre-flight 1 and 2)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: pg.Pool;
  let admin: pg.Pool;
  let tenant: Tenant;

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
    worker = new pg.Pool({ connectionString: db.workerUrl });
    admin = new pg.Pool({ connectionString: db.adminUrl });
  }, 120_000);

  afterAll(async () => {
    await worker?.end();
    await admin?.end();
    await service?.close();
    await db?.drop();
  });

  it('records a minute probed, up if any probe in it was, and an environment reads the minutes since a time', async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute, 30));
    await recordServiceProbe(worker, at(0), true);
    await recordServiceProbe(worker, at(1), false);
    await recordServiceProbe(worker, at(1), true);
    await recordServiceProbe(worker, at(2), false);
    await recordServiceProbe(worker, at(3), true);
    const read = await service.withTenant(tenant, (trx) =>
      serviceAvailability(trx, new Date(Date.UTC(2026, 10, 1, 0, 1))),
    );
    expect(read).toEqual({
      firstProbe: new Date(Date.UTC(2026, 10, 1, 0, 0)),
      probed: 3,
      up: 2,
    });
  });

  it("keeps the record closed to an environment's own role but through its definers", async () => {
    await expect(
      service.withTenant(tenant, (trx) => sql`select * from platform.service_probe`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(tenant, (trx) =>
        sql`insert into platform.backup_run (class, act, started_at, finished_at, outcome)
            values ('databases', 'backup', now(), now(), 'succeeded')`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('reads the latest backup and drill of each class, and when each last succeeded', async () => {
    const run = (cls: string, act: string, started: string, seconds: number, outcome: string) =>
      admin.query(
        `insert into platform.backup_run (class, act, started_at, finished_at, outcome)
         values ($1, $2, $3::timestamptz, $3::timestamptz + make_interval(secs => $4), $5)`,
        [cls, act, started, seconds, outcome],
      );
    await run('databases', 'backup', '2026-11-05T02:30:00Z', 60, 'succeeded');
    await run('databases', 'backup', '2026-11-06T02:30:00Z', 70, 'failed');
    await run('objects', 'backup', '2026-11-06T02:31:00Z', 300, 'succeeded');
    await run('databases', 'drill', '2026-11-01T03:00:00Z', 900, 'succeeded');
    const record = await service.withTenant(tenant, (trx) => backupRecord(trx));
    expect(record).toEqual([
      {
        class: 'databases',
        act: 'backup',
        lastStartedAt: new Date('2026-11-06T02:30:00Z'),
        lastSeconds: 70,
        lastOutcome: 'failed',
        succeededAt: new Date('2026-11-05T02:31:00Z'),
      },
      {
        class: 'databases',
        act: 'drill',
        lastStartedAt: new Date('2026-11-01T03:00:00Z'),
        lastSeconds: 900,
        lastOutcome: 'succeeded',
        succeededAt: new Date('2026-11-01T03:15:00Z'),
      },
      {
        class: 'objects',
        act: 'backup',
        lastStartedAt: new Date('2026-11-06T02:31:00Z'),
        lastSeconds: 300,
        lastOutcome: 'succeeded',
        succeededAt: new Date('2026-11-06T02:36:00Z'),
      },
    ]);
  });
});
