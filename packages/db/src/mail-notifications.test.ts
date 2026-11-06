import type { AuditContext, BlockNode, ContentDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { deleteNotification, listInbox, markRead } from './inbox.js';
import {
  claimMail,
  dropMail,
  mailChannel,
  mailChoicesOf,
  recordMailAttempt,
  setMailChannel,
  setMailChoices,
} from './mail.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createServiceIdentity } from './service-identities.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { startThread } from './threads.js';
import { recordVersion, substanceOf } from './versions.js';

const SYSTEM: AuditContext = { actorKind: 'system' };
const LEASE_MS = 60_000;

describe('notifications by email (the EM plan, EM-F, EM-G, EM-H, EM-N and EM-W)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let ivy = '';
  let clinical = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const person = (name: string, kind: 'user' | 'external' = 'user') =>
    as(async (trx) => {
      const { id } = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: name,
          email: `${name}@example.test`,
          email_verified: true,
          display_name: name,
          kind,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    });

  const channelOn = (kindsOff: readonly ('mention' | 'reply' | 'digest')[] = []) =>
    as((trx) =>
      setMailChannel(trx, {
        enabled: true,
        relay: 'platform',
        host: null,
        port: null,
        username: null,
        fromAddress: null,
        fromName: null,
        kindsOff,
        by: ada,
      }),
    );

  /** A component in Clinical by Ada, and a thread on it naming `named`: each is told at once. */
  const mentioning = async (...named: string[]) => {
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
    const version = await as(async (trx) => {
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
      return next.version;
    });
    const started = await as((trx) =>
      startThread(trx, {
        on: version.artifactId,
        version: version.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'Over to ' }, ...named.map((each) => ({ mention: each }))],
        author: ada,
      }),
    );
    if (started.answer !== 'done') throw new Error(started.answer);
    return { thread: started.thread, artifact: version.artifactId };
  };

  const notificationsOf = (who: string) =>
    as(async (trx) => (await listInbox(trx, who, { limit: 100 })).notifications);
  const deliveries = () =>
    as((trx) =>
      trx
        .selectFrom('email_delivery')
        .select(['id', 'purpose', 'principal_id', 'notification_id', 'state', 'dropped_reason'])
        .select(sql<number>`extract(epoch from next_at - now())::float8`.as('held'))
        .orderBy('created_at')
        .execute(),
    );
  /** Every mail due now, its hold passed. */
  const due = () => as((trx) => sql`update email_delivery set next_at = now()`.execute(trx));
  const claim = () => as((trx) => claimMail(trx, 50, LEASE_MS));

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
    ada = await person('ada');
    grace = await person('grace');
    ivy = await person('ivy', 'external');
    await as(async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Reviewer'],
        [ivy, 'Reviewer'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  beforeEach(async () => {
    await as(async (trx) => {
      await trx.deleteFrom('email_delivery').execute();
      await trx.deleteFrom('mail_channel').execute();
      await trx.deleteFrom('notification_email_off').execute();
      await trx.updateTable('principal').set({ disabled_at: null, disabled_by: null }).execute();
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('queues a notification’s mail held five minutes, only while the channel is on', async () => {
    await mentioning(grace);
    expect(await deliveries()).toEqual([]);
    await channelOn();
    await mentioning(grace);
    const [one, ...rest] = await deliveries();
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ purpose: 'notification', principal_id: grace, state: 'pending' });
    expect(one!.held).toBeGreaterThan(290);
    expect((await claim()).claimed).toEqual([]);
  });

  it('never queues a mail to a service identity, nor for a notice of the channel itself', async () => {
    await channelOn();
    const robot = (
      await as((trx) => createServiceIdentity(trx, { name: 'Robot', description: '', by: ada }))
    ).id;
    await as((trx) =>
      sql`insert into notification (recipient, kind, actor, thread_id, artifact_id)
          select ${robot}, kind, actor, thread_id, artifact_id from notification
           where recipient = ${grace} limit 1`.execute(trx),
    );
    await as((trx) =>
      sql`insert into notification (recipient, kind) values (${grace}, 'mail')`.execute(trx),
    );
    expect(await deliveries()).toEqual([]);
    await as((trx) => sql`delete from notification where kind = 'mail'`.execute(trx));
  });

  it('claims a notification’s mail with its kind and the person’s language, and no content', async () => {
    await channelOn();
    await as((trx) =>
      sql`update principal set interface_language = 'en-XA' where id = ${grace}`.execute(trx),
    );
    await mentioning(grace);
    await due();
    const { claimed } = await claim();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      purpose: 'notification',
      to: 'grace@example.test',
      notification: { kind: 'mention' },
      language: 'en-XA',
    });
    expect(JSON.stringify(claimed[0])).not.toMatch(/printer|tray|Over to|ada/i);
    await as((trx) =>
      sql`update principal set interface_language = null where id = ${grace}`.execute(trx),
    );
  });

  it('drops a mail for a notification read within the hold, and removes one whose notification is removed', async () => {
    await channelOn();
    await mentioning(grace);
    await mentioning(grace);
    const [first, second] = await notificationsOf(grace);
    await as((trx) => markRead(trx, grace, first!.id));
    await as((trx) => deleteNotification(trx, grace, second!.id));
    await due();
    expect(await claim()).toMatchObject({ claimed: [], dropped: 1 });
    expect(await deliveries()).toEqual([
      expect.objectContaining({ state: 'dropped', dropped_reason: 'read' }),
    ]);
  });

  it('drops a mail unsent for a disabled person, or one from outside on a thread made internal', async () => {
    await channelOn();
    const one = await mentioning(grace, ivy);
    await as(async (trx) => {
      await sql`update principal set disabled_at = now(), disabled_by = 'person' where id = ${grace}`.execute(trx);
      await sql`insert into thread_internal (thread_id, marked_by) values (${one.thread}, ${ada})`.execute(
        trx,
      );
    });
    await due();
    expect(await claim()).toMatchObject({ claimed: [], dropped: 2 });
    expect(
      new Map((await deliveries()).map((each) => [each.principal_id, each.dropped_reason])),
    ).toEqual(
      new Map([
        [grace, 'disabled'],
        [ivy, 'no_longer_told'],
      ]),
    );
  });

  it('drops a mail of what the person may no longer read', async () => {
    await channelOn();
    await mentioning(grace);
    const reviewer = (await as((trx) => findRole(trx, 'Reviewer')))!.id;
    await as((trx) =>
      sql`delete from access_grant where principal_id = ${grace} and role_id = ${reviewer}`.execute(
        trx,
      ),
    );
    await due();
    await claim();
    expect(await deliveries()).toEqual([
      expect.objectContaining({ state: 'dropped', dropped_reason: 'no_longer_told' }),
    ]);
    await as(async (trx) =>
      grant(trx, {
        roleId: reviewer,
        subject: { principal: grace },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
  });

  it('COL-060 drops a mail of a kind the person or the environment turned off, and while the channel is off', async () => {
    expect(await as((trx) => mailChoicesOf(trx, grace))).toEqual({
      mention: true,
      reply: true,
      resolution: true,
      round: true,
      digest: true,
    });
    await channelOn(['reply']);
    await as((trx) => setMailChoices(trx, grace, { mention: false, digest: true }));
    expect(await as((trx) => mailChoicesOf(trx, grace))).toMatchObject({
      mention: false,
      digest: true,
    });
    await mentioning(grace);
    await due();
    await claim();
    await as((trx) => setMailChoices(trx, grace, { mention: true }));
    await as((trx) => setMailChannel(trx, { ...stillOn, kindsOff: ['mention'], by: ada }));
    await mentioning(grace);
    await due();
    await claim();
    await channelOn();
    await mentioning(grace);
    await as((trx) => setMailChannel(trx, { ...stillOn, enabled: false, by: ada }));
    await due();
    await claim();
    expect((await deliveries()).map((each) => each.dropped_reason)).toEqual([
      'opted_out',
      'environment_off',
      'channel_off',
    ]);
    expect((await as((trx) => mailChannel(trx)))!.kindsOff).toEqual([]);
  });

  it('COL-053 counts a digest’s mail only of the kinds left on, and sends none of nothing', async () => {
    await channelOn();
    const digest = (counts: object) =>
      as((trx) =>
        sql`insert into notification (recipient, kind, counts)
            values (${grace}, 'digest', ${JSON.stringify({ threads: [], artifacts: [], ...counts })}::jsonb)`.execute(
          trx,
        ),
      );
    await as((trx) => setMailChoices(trx, grace, { mention: false }));
    await digest({ mention: 2, reply: 1, resolution: 0, round: 0 });
    await digest({ mention: 3, reply: 0, resolution: 0, round: 0 });
    await due();
    const { claimed } = await claim();
    expect(claimed.map((each) => each.notification)).toEqual([
      { kind: 'digest', counts: { mention: 0, reply: 1, resolution: 0, round: 0 } },
    ]);
    expect((await deliveries()).map((each) => each.dropped_reason)).toEqual([null, 'opted_out']);
  });

  it('drops a mail its worker found no address for the environment for', async () => {
    await channelOn();
    await mentioning(grace);
    await due();
    const [one] = (await claim()).claimed;
    await as((trx) => dropMail(trx, one!.id, 'no_hostname', one!.lease));
    expect(await deliveries()).toEqual([
      expect.objectContaining({ state: 'dropped', dropped_reason: 'no_hostname' }),
    ]);
  });

  it('tells those who may configure once that a channel is failing, and never mails that', async () => {
    await channelOn();
    const administrator = (await as((trx) => findRole(trx, 'Administrator')))!.id;
    await as((trx) =>
      grant(trx, {
        roleId: administrator,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
    await as((trx) => sql`update principal set disabled_at = null, disabled_by = null`.execute(trx));
    const fail = async () => {
      await mentioning(grace);
      await due();
      const { claimed } = await claim();
      for (const each of claimed) {
        await as((trx) =>
          recordMailAttempt(
            trx,
            each.id,
            { kind: 'failed', failure: 'timeout', latencyMs: 30_000 },
            each.lease,
          ),
        );
      }
      await due();
    };
    await fail();
    await fail();
    const told = (await notificationsOf(ada)).filter((each) => each.kind === 'mail');
    expect(told).toHaveLength(1);
    expect((await notificationsOf(grace)).filter((each) => each.kind === 'mail')).toEqual([]);
    expect(
      (await deliveries()).filter((each) => each.principal_id === ada && each.purpose !== 'test'),
    ).toEqual([]);
    // A send clears it, and the next failure tells again.
    const { claimed } = await claim();
    await as((trx) =>
      recordMailAttempt(trx, claimed[0]!.id, { kind: 'sent', latencyMs: 10 }, claimed[0]!.lease),
    );
    expect((await as((trx) => mailChannel(trx)))!.failingSince).toBeNull();
    await fail();
    expect((await notificationsOf(ada)).filter((each) => each.kind === 'mail')).toHaveLength(2);
  });

  const stillOn = {
    enabled: true,
    relay: 'platform' as const,
    host: null,
    port: null,
    username: null,
    fromAddress: null,
    fromName: null,
  };
});
