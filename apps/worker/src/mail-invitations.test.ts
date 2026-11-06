import { randomUUID } from 'node:crypto';
import {
  createTenant,
  invite,
  migrate,
  prepareDatabase,
  setMailChannel,
  startClosing,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import type { MailRequest } from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sendMail } from './mail.js';
import type { Mailer } from './mailer.js';
import { sweepClosures } from './sweep.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('invitations and closure notices from the mail loop (the EM plan, EM-T, EM-U and EM-V)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let admin: pg.Client;
  let acme: Tenant;
  let ada = '';
  let sent: MailRequest[] = [];
  const mailer: Mailer = (request) => {
    sent.push(request);
    return Promise.resolve({ type: 'sent', latencyMs: 3 });
  };

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(acme, work, { actorKind: 'person', actor: ada });

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
  });

  beforeEach(async () => {
    sent = [];
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme Production' },
      hostnames: ['acme.alloy.test'].map((each) => `${randomUUID().slice(0, 8)}.${each}`),
    });
    ada = (
      await service.withTenant(
        acme,
        (trx) =>
          trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: 'ada@example.test',
              email_verified: true,
              display_name: 'Ada',
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        { actorKind: 'system' },
      )
    ).id;
  });

  afterAll(async () => {
    await admin?.end();
    await service?.close();
    await worker?.close();
    await db?.drop();
  });

  it('IAM-089 mails an invitation with a link to the environment’s sign-in and no token', async () => {
    await as((trx) =>
      invite(trx, { email: 'grace@example.test', external: false, invitedBy: ada }),
    );
    expect(await sendMail(worker, mailer, quiet)).toBe(1);
    const [host] = await worker.hostnames(acme.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'grace@example.test',
      fromName: 'Acme Production',
      subject: 'You have been invited to Alloy Works',
      relay: { kind: 'platform' },
    });
    expect(sent[0]!.text).toContain(`\nhttps://${host}/\n`);
    expect(sent[0]!.text).not.toMatch(/[?#=]|Ada/);
  });

  it('ADM-055 sends a closing environment its notices alone, by the operator’s relay, and 7 days out again', async () => {
    await as((trx) =>
      setMailChannel(trx, {
        enabled: true,
        relay: 'own',
        host: 'smtp.acme.test',
        port: 587,
        username: null,
        fromAddress: 'docs@acme.test',
        fromName: null,
        by: ada,
      }),
    );
    // A test waiting: a closing environment sends nothing but its notices (EM-T).
    await as((trx) =>
      sql`insert into email_delivery (purpose, principal_id) values ('test', ${ada})`.execute(trx),
    );
    await as((trx) => startClosing(trx, acme, { declined: true }));
    await sendMail(worker, mailer, quiet);
    expect(sent.map((mail) => [mail.subject, mail.relay])).toEqual([
      ['An environment you use is closing', { kind: 'platform' }],
    ]);
    expect(sent[0]!.text).not.toMatch(/https?:/);

    await admin.query(
      `update platform.tenant set grace_ends_at = now() + interval '6 days' where id = $1`,
      [acme.id],
    );
    await sweepClosures(worker, quiet);
    await sweepClosures(worker, quiet);
    await sendMail(worker, mailer, quiet);
    expect(sent.map((mail) => mail.subject)).toEqual([
      'An environment you use is closing',
      'An environment you use is deleted within a week',
    ]);
    const waiting = await as((trx) =>
      trx.selectFrom('email_delivery').select('state').where('purpose', '=', 'test').execute(),
    );
    expect(waiting).toEqual([{ state: 'pending' }]);
  });
});
