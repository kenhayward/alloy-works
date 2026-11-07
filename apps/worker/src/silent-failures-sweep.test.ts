import {
  backgroundWork,
  createTenant,
  findRole,
  grant,
  listInbox,
  migrate,
  prepareDatabase,
  recordBackgroundWork,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepSilentFailuresEverywhere } from './sweep.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('silent failures told to administrators by the worker (the DG plan, DGe4)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let tenant: Tenant;
  let ada = '';

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    ada = await service.withTenant(tenant, async (trx) => {
      const { id } = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'ada',
          email: 'ada@example.test',
          email_verified: true,
          display_name: 'Ada',
          kind: 'user',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: id,
      });
      return id;
    });
  });

  afterAll(async () => {
    await service.close();
    await worker.close();
    await db.drop();
  });

  const told = () =>
    service.withTenant(tenant, async (trx) =>
      (await listInbox(trx, ada, { limit: 100 })).notifications
        .filter((each) => each.kind === 'diagnostics')
        .map((each) => each.diagnostics),
    );

  it('ADM-037 tells an administrator in their inbox of background work failing, once, from the records Diagnostics reads', async () => {
    await service.withTenant(tenant, (trx) =>
      recordBackgroundWork(trx, {
        work: 'sweepDates',
        startedAt: new Date(),
        finishedAt: new Date(),
        outcome: 'failed',
        failure: 'database_unavailable',
      }),
    );
    expect(await sweepSilentFailuresEverywhere(worker, quiet)).toBe(1);
    expect(await sweepSilentFailuresEverywhere(worker, quiet)).toBe(0);
    expect(await told()).toEqual([{ kind: 'work_failing', subject: 'sweepDates' }]);
    // The sweep is background work of its own, recorded as it ran.
    expect(
      (await service.withTenant(tenant, (trx) => backgroundWork(trx))).find(
        (each) => each.work === 'sweepSilentFailuresEverywhere',
      ),
    ).toMatchObject({ outcome: 'succeeded' });
  });
});
