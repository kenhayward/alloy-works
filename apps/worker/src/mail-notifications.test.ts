import { randomUUID } from 'node:crypto';
import {
  createComponent,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  prepareDatabase,
  recordVersion,
  setMailChannel,
  startThread,
  substanceOf,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import type { BlockNode, ContentDocument, MailRequest } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sendMail } from './mail.js';
import type { Mailer } from './mailer.js';
import type { WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('notifications by email from the mail loop (the EM plan, EM-E and EM-Q)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let acme: Tenant;
  let ada = '';
  let grace = '';
  let clinical = '';
  let sent: MailRequest[] = [];
  const mailer: Mailer = (request) => {
    sent.push(request);
    return Promise.resolve({ type: 'sent', latencyMs: 3 });
  };

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(acme, work, { actorKind: 'system' });
  const due = () => as((trx) => sql`update email_delivery set next_at = now()`.execute(trx));

  const person = (name: string) =>
    as(async (trx) => {
      const made = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: randomUUID(),
          email: `${name.toLowerCase()}@example.test`,
          email_verified: true,
          display_name: name,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return made.id;
    });

  /** Ada comments on her component in Clinical, naming Grace. */
  const adaMentionsGrace = async () => {
    const made = await as((trx) =>
      createComponent(trx, {
        spaceId: clinical,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    await as(async (trx) => {
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const block: BlockNode = {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'text', value: 'Set the tray.', marks: [] }],
      };
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          ...substance,
          content: { ...substance.content, content: [block] } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      const started = await startThread(trx, {
        on: next.version.artifactId,
        version: next.version.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'The tray jams, over to ' }, { mention: grace }],
        author: ada,
      });
      if (started.answer !== 'done') throw new Error(started.answer);
    });
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme Production' },
      hostnames: ['docs.acme.test', 'acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    ada = await person('Ada');
    grace = await person('Grace');
    await as(async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Reviewer'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      await setMailChannel(trx, {
        enabled: true,
        relay: 'platform',
        host: null,
        port: null,
        username: null,
        fromAddress: null,
        fromName: null,
        by: ada,
      });
    });
  });

  beforeEach(async () => {
    sent = [];
    await as((trx) => trx.deleteFrom('email_delivery').execute());
  });

  afterAll(async () => {
    await service.close();
    await worker.close();
    await db.drop();
  });

  it('COL-064 COL-036 tells a person by email of a notification, with its link and none of its content', async () => {
    await adaMentionsGrace();
    // Held five minutes, in case it is read by then (EM-H).
    expect(await sendMail(worker, mailer, quiet)).toBe(0);
    await due();
    expect(await sendMail(worker, mailer, quiet)).toBe(1);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail).toMatchObject({
      to: 'grace@example.test',
      fromName: 'Acme Production',
      subject: 'Somebody mentioned you in a comment',
    });
    // The first of its addresses in order, at the scheme it is reached by.
    expect(mail!.text).toContain('\nhttps://acme.alloy.test/#/inbox\n');
    expect(`${mail!.subject}\n${mail!.text}`).not.toMatch(/printer|tray|jams|Ada|Clinical/i);
  });

  it('COL-053 mails a digest of counts alone, at the port the worker is told', async () => {
    await as((trx) =>
      sql`insert into notification (recipient, kind, counts)
          values (${grace}, 'digest', ${JSON.stringify({
            mention: 2,
            reply: 0,
            resolution: 1,
            round: 0,
            threads: [],
            artifacts: [],
          })}::jsonb)`.execute(trx),
    );
    await due();
    await sendMail(worker, mailer, quiet, { scheme: 'http', port: 8088 });
    expect(sent.map((each) => each.subject)).toEqual(['Your daily digest']);
    expect(sent[0]!.text).toContain('Mentions of you: 2\nThreads you are in resolved: 1\n');
    expect(sent[0]!.text).toContain('\nhttp://acme.alloy.test:8088/#/inbox\n');
  });

  it('drops a notification’s mail where the environment has no address to link to', async () => {
    await adaMentionsGrace();
    await due();
    const nowhere: TenantDatabase = { ...worker, hostnames: () => Promise.resolve([]) };
    await sendMail(nowhere, mailer, quiet);
    expect(sent).toEqual([]);
    expect(
      await as((trx) => trx.selectFrom('email_delivery').select(['dropped_reason']).execute()),
    ).toEqual([{ dropped_reason: 'no_hostname' }]);
  });
});
