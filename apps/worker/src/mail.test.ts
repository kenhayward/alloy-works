import { randomUUID } from 'node:crypto';
import {
  createTenant,
  createTenantDatabase,
  migrate,
  prepareDatabase,
  queueTestMail,
  resumeTenant,
  setMailChannel,
  setMailPassword,
  suspendTenant,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { TEST_MAIL, type MailAnswer, type MailRequest } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sendMail } from './mail.js';
import type { Mailer } from './mailer.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('the mail loop (the EM plan, EM-G, EM-L and EM-M)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let acme: Tenant;
  let globex: Tenant;
  const people = new Map<string, string>();
  let sent: MailRequest[] = [];
  let answer: (request: MailRequest) => Promise<MailAnswer | 'busy'> = () =>
    Promise.resolve({ type: 'sent', latencyMs: 3 });
  const mailer: Mailer = (request) => {
    sent.push(request);
    return answer(request);
  };

  const as = <T>(tenant: Tenant, work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });

  const stateOf = (tenant: Tenant, id: string) =>
    as(tenant, (trx) =>
      trx
        .selectFrom('email_delivery')
        .select(['state', 'attempts'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );

  const personIn = async (tenant: Tenant, name: string) => {
    const id = await as(tenant, async (trx) => {
      const made = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: randomUUID(),
          email: `${name}@example.test`,
          email_verified: true,
          display_name: name,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return made.id;
    });
    people.set(`${tenant.id}:${name}`, id);
    return id;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme Production' },
      hostnames: ['acme.alloy.test'],
    });
    globex = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'globex', name: 'Globex' },
      tenant: { id: db.newTenantId(), name: 'Globex Production' },
      hostnames: ['globex.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    await personIn(acme, 'ada');
    await personIn(globex, 'grace');
  });

  beforeEach(async () => {
    sent = [];
    answer = () => Promise.resolve({ type: 'sent', latencyMs: 3 });
    for (const tenant of [acme, globex]) {
      await as(tenant, async (trx) => {
        await trx.deleteFrom('email_delivery').execute();
        await trx.deleteFrom('mail_channel').execute();
      });
    }
  });

  afterAll(async () => {
    await service.close();
    await worker.close();
    await db.drop();
  });

  it('sends a test once to the verified address, by the operator’s relay with the tenant’s name, and records it sent', async () => {
    const ada = people.get(`${acme.id}:ada`)!;
    const id = await as(acme, (trx) => queueTestMail(trx, ada));
    expect(await sendMail(worker, mailer, quiet)).toBe(1);
    expect(sent).toEqual([
      {
        requestId: expect.any(String) as string,
        tenant: acme.id,
        id,
        relay: { kind: 'platform' },
        fromName: 'Acme Production',
        to: 'ada@example.test',
        subject: TEST_MAIL.subject,
        text: TEST_MAIL.text,
      },
    ]);
    expect(await stateOf(acme, id)).toEqual({ state: 'sent', attempts: 1 });
    expect(await sendMail(worker, mailer, quiet)).toBe(0);
  });

  it('sends by a tenant’s own relay, its password sealed, from its own address and name', async () => {
    const ada = people.get(`${acme.id}:ada`)!;
    await as(acme, async (trx) => {
      const channel = await setMailChannel(trx, {
        enabled: false,
        relay: 'own',
        host: 'mail.example.test',
        port: 465,
        username: 'news',
        fromAddress: 'news@example.test',
        fromName: 'Acme news',
        by: ada,
      });
      await setMailPassword(trx, channel.id, 'sealed-for-the-test', ada);
    });
    await as(acme, (trx) => queueTestMail(trx, ada));
    await sendMail(worker, mailer, quiet);
    expect(sent[0]).toMatchObject({
      relay: {
        kind: 'own',
        host: 'mail.example.test',
        port: 465,
        username: 'news',
        sealed: 'sealed-for-the-test',
        fromAddress: 'news@example.test',
      },
      fromName: 'Acme news',
    });
  });

  it('a black-holed relay delays only its own tenant', async () => {
    const ada = people.get(`${acme.id}:ada`)!;
    const grace = people.get(`${globex.id}:grace`)!;
    const stuck = [
      await as(acme, (trx) => queueTestMail(trx, ada)),
      await as(acme, (trx) => queueTestMail(trx, ada)),
    ];
    const other = await as(globex, (trx) => queueTestMail(trx, grace));
    answer = async (request) => {
      if (request.tenant === acme.id) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { type: 'failed', code: 'timeout', latencyMs: 300 };
      }
      return { type: 'sent', latencyMs: 3 };
    };
    await sendMail(worker, mailer, quiet);
    expect(await stateOf(globex, other)).toEqual({ state: 'sent', attempts: 1 });
    // Its pass ended at the first failure: the second waits untried, behind it.
    const tried = await Promise.all(stuck.map((id) => stateOf(acme, id)));
    expect(tried.map((each) => each.attempts).sort()).toEqual([0, 1]);
    expect(sent.filter((each) => each.tenant === acme.id)).toHaveLength(1);
    // And the next pass leaves it alone until its relay is due again: it takes no lane.
    const other2 = await as(globex, (trx) => queueTestMail(trx, grace));
    await sendMail(worker, mailer, quiet);
    expect(sent.filter((each) => each.tenant === acme.id)).toHaveLength(1);
    expect(await stateOf(globex, other2)).toEqual({ state: 'sent', attempts: 1 });
  });

  it('a suspended tenant’s mail waits without an attempt', async () => {
    const ada = people.get(`${acme.id}:ada`)!;
    const id = await as(acme, (trx) => queueTestMail(trx, ada));
    const steward = createTenantDatabase(db.stewardUrl);
    const operator = { actorKind: 'vendor' } as const;
    await steward.withTenant(acme, (trx) => suspendTenant(trx, acme, 'A test'), operator);
    try {
      await sendMail(worker, mailer, quiet);
      expect(sent).toEqual([]);
      expect(await stateOf(acme, id)).toEqual({ state: 'pending', attempts: 0 });
    } finally {
      await steward.withTenant(acme, (trx) => resumeTenant(trx, acme), operator);
      await steward.close();
    }
    await sendMail(worker, mailer, quiet);
    expect(await stateOf(acme, id)).toEqual({ state: 'sent', attempts: 1 });
  });

  it('sends the same id when a send is repeated after an unrecorded success', async () => {
    const ada = people.get(`${acme.id}:ada`)!;
    const id = await as(acme, (trx) => queueTestMail(trx, ada));
    // Sent, then the worker fell over before recording it.
    answer = () => Promise.reject(new Error('The worker fell over.'));
    await sendMail(worker, mailer, quiet);
    expect(await stateOf(acme, id)).toEqual({ state: 'pending', attempts: 0 });
    await as(acme, (trx) =>
      sql`update email_delivery set locked_until = now() - interval '1 second'`.execute(trx),
    );
    answer = () => Promise.resolve({ type: 'sent', latencyMs: 3 });
    await sendMail(worker, mailer, quiet);
    expect(sent.map((each) => each.id)).toEqual([id, id]);
    expect(new Set(sent.map((each) => each.requestId)).size).toBe(2);
    expect(await stateOf(acme, id)).toEqual({ state: 'sent', attempts: 1 });
  });
});
