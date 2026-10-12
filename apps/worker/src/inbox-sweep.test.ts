import {
  createComponent,
  createTenant,
  digestBoundary,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  setCadences,
  startThread,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foldNotificationDigests, sweepOldNotifications } from './sweep.js';
import type { WorkerLog } from './worker.js';

const DAY = 86_400_000;
const silent: WorkerLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as WorkerLog;

describe('the inbox’s daily fold and its retention, in every tenant', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let tenants: Tenant[];

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenants = [];
    for (const [name, host] of [
      ['Production', 'acme.alloy.test'],
      ['Development', 'dev.acme.alloy.test'],
    ] as const) {
      tenants.push(
        await createTenant(db.adminUrl, db.migratorUrl, {
          organisation: { id: 'acme', name: 'Acme' },
          tenant: { id: db.newTenantId(), name },
          hostnames: [host],
        }),
      );
    }
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
  });

  afterAll(async () => {
    await service?.close();
    await worker?.close();
    await db?.drop();
  });

  /** In this tenant, a thread Ada started naming Grace, a reader, who is told of mentions daily. */
  const heldIn = (tenant: Tenant) =>
    service.withTenant(tenant, async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      const ada = await person('ada', 'Ada');
      const grace = await person('grace', 'Grace');
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      for (const who of [ada, grace]) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      await setCadences(trx, grace, { mention: 'daily' });
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const started = await startThread(trx, {
        on: made.version.artifactId,
        version: made.version.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'Over to ' }, { mention: grace }],
        author: ada,
      });
      if (started.answer !== 'done') throw new Error(started.answer);
      return grace;
    });
  const notificationsIn = (tenant: Tenant, recipient: string) =>
    service.withTenant(tenant, (trx) =>
      trx.selectFrom('notification').selectAll().where('recipient', '=', recipient).execute(),
    );

  it('COL-035 folds each tenant’s held events into digests at the boundary, as the worker, and COL-062 sweeps them at 90 days', async () => {
    const recipients = await Promise.all(tenants.map(heldIn));
    const tomorrow = digestBoundary(new Date(Date.now() + DAY));
    expect(await foldNotificationDigests(worker, silent, tomorrow)).toBe(2);
    for (const [index, tenant] of tenants.entries()) {
      expect(await notificationsIn(tenant, recipients[index]!)).toEqual([
        expect.objectContaining({ kind: 'digest', at: tomorrow }),
      ]);
    }
    expect(await foldNotificationDigests(worker, silent, tomorrow)).toBe(0);
    expect(await sweepOldNotifications(worker, silent, new Date(Date.now() + 89 * DAY))).toBe(0);
    expect(await sweepOldNotifications(worker, silent, new Date(Date.now() + 92 * DAY))).toBe(2);
    for (const [index, tenant] of tenants.entries()) {
      expect(await notificationsIn(tenant, recipients[index]!)).toEqual([]);
    }
  });
});
