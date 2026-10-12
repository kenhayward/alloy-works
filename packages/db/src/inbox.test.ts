import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import {
  deleteNotification,
  digestBoundary,
  foldDigests,
  listInbox,
  markRead,
  setCadences,
  sweepNotifications,
  titlesFor,
} from './inbox.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { addComment, editComment, resolveThread, startThread } from './threads.js';
import { recordVersion, substanceOf } from './versions.js';

const said = (value: string) => [{ text: value }];
const DAY = 86_400_000;

describe('the inbox', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let ivy = '';
  let clinical = '';
  let quality = '';

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  /** A component in a space, by Ada, holding one paragraph. */
  const component = async (space = clinical) => {
    const made = await tenant((trx) =>
      createComponent(trx, {
        spaceId: space,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return tenant(async (trx) => {
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
  };
  const started = async (parts: unknown, space = clinical, by = ada) => {
    const version = await component(space);
    const answer = await tenant((trx) =>
      startThread(trx, {
        on: version.artifactId,
        version: version.id,
        anchor: { kind: 'component' },
        parts,
        author: by,
      }),
    );
    if (answer.answer !== 'done') throw new Error(answer.answer);
    return { ...answer, artifact: version.artifactId };
  };
  const inbox = (who: string) => tenant((trx) => listInbox(trx, who, { limit: 100 }));
  const held = (who: string) =>
    tenant((trx) =>
      trx.selectFrom('notification_held').selectAll().where('recipient', '=', who).execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await tenant(async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      ivy = await person('ivy', 'Ivy');
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada authors both; Grace reviews Clinical alone; Ivy reads nothing.
      for (const [who, role, space] of [
        [ada, 'Author', clinical],
        [ada, 'Author', quality],
        [grace, 'Reviewer', clinical],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('COL-015 tells a person a comment names who may read what it is on, and tells one who may not nothing, saying so to its author', async () => {
    const thread = await started([{ text: 'Over to ' }, { mention: grace }, { mention: ivy }]);
    expect(thread.untold).toEqual([ivy]);
    expect((await inbox(grace)).notifications[0]).toMatchObject({
      kind: 'mention',
      actor: { id: ada, name: 'Ada' },
      thread: thread.thread,
      artifact: thread.artifact,
    });
    expect((await inbox(ivy)).notifications).toEqual([]);
    // A mention an edit adds tells its person; one already there tells nobody again.
    const before = (await inbox(grace)).notifications.length;
    await tenant((trx) =>
      editComment(trx, {
        thread: thread.thread,
        comment: thread.comment,
        parts: [{ text: 'Still over to ' }, { mention: grace }],
        author: ada,
      }),
    );
    expect((await inbox(grace)).notifications).toHaveLength(before);
  });

  it('tells an earlier commenter of a reply naming them where their mentions are never told', async () => {
    const thread = await started(said('Is this right?'), clinical, grace);
    await tenant((trx) => setCadences(trx, grace, { mention: 'never' }));
    try {
      const before = (await inbox(grace)).notifications.length;
      await tenant((trx) =>
        addComment(trx, {
          thread: thread.thread,
          parts: [{ text: 'Yes, ' }, { mention: grace }],
          author: ada,
        }),
      );
      const now = (await inbox(grace)).notifications;
      expect(now).toHaveLength(before + 1);
      expect(now[0]).toMatchObject({ kind: 'reply', thread: thread.thread });
    } finally {
      await tenant((trx) => setCadences(trx, grace, { mention: 'at_once' }));
    }
  });

  it('COL-063 COL-036 lists a person’s notifications newest first, unread marked, holding identifiers and never the text', async () => {
    const thread = await started(said('Is this right?'), clinical, grace);
    await tenant((trx) =>
      addComment(trx, { thread: thread.thread, parts: said('Yes.'), author: ada }),
    );
    const listed = await inbox(grace);
    const reply = listed.notifications[0]!;
    expect(reply).toMatchObject({ kind: 'reply', thread: thread.thread, readAt: null });
    expect(listed.unread).toBeGreaterThan(0);
    expect(await tenant((trx) => markRead(trx, grace, reply.id))).toBe(true);
    expect(await tenant((trx) => markRead(trx, ada, reply.id))).toBe(false);
    const after = await inbox(grace);
    expect(after.unread).toBe(listed.unread - 1);
    expect(after.notifications[0]!.readAt).toBeInstanceOf(Date);
    // Nothing a notification holds can carry a comment's words.
    const { rows } = await tenant((trx) =>
      sql<{ column_name: string }>`select column_name from information_schema.columns
        where table_schema = current_schema() and table_name = 'notification'
        order by column_name`.execute(trx),
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'actor',
      'artifact_id',
      'at',
      'counts',
      'id',
      'kind',
      'read_at',
      'recipient',
      'thread_id',
    ]);
    // A title is the reader's alone, read when asked.
    const titles = await tenant((trx) => titlesFor(trx, grace, [thread.artifact]));
    expect(titles.get(thread.artifact)).toBe('Install the printer');
    expect((await tenant((trx) => titlesFor(trx, ivy, [thread.artifact]))).size).toBe(0);
  });

  it('COL-034 tells each kind at once, in the day’s digest, or never, by the person’s choice', async () => {
    await tenant((trx) => setCadences(trx, grace, { mention: 'never', reply: 'daily' }));
    try {
      const before = (await inbox(grace)).notifications.length;
      const thread = await started([{ text: 'Over to ' }, { mention: grace }]);
      expect((await inbox(grace)).notifications).toHaveLength(before);
      await tenant((trx) =>
        addComment(trx, { thread: thread.thread, parts: said('Seen.'), author: grace }),
      );
      await tenant((trx) =>
        addComment(trx, { thread: thread.thread, parts: said('Thanks.'), author: ada }),
      );
      expect((await inbox(grace)).notifications).toHaveLength(before);
      expect(await held(grace)).toEqual([
        expect.objectContaining({ kind: 'reply', thread_id: thread.thread }),
      ]);
    } finally {
      await tenant((trx) => setCadences(trx, grace, { mention: 'at_once', reply: 'at_once' }));
      await tenant((trx) => trx.deleteFrom('notification_held').execute());
    }
  });

  it('COL-035 COL-053 folds a person’s day into one digest of counts and identifiers at 07:00 UTC, deciding again what they may read', async () => {
    const thread = await started(said('Is this right?'), clinical, grace);
    await tenant((trx) =>
      addComment(trx, { thread: thread.thread, parts: said('Yes.'), author: ada }),
    );
    // Resolutions are daily by default: held, not told at once.
    await tenant((trx) => resolveThread(trx, { thread: thread.thread, by: ada }));
    // And an event on something Grace may not read, which the fold drops.
    const hidden = await started(said('Calibrate?'), quality);
    await tenant((trx) =>
      trx
        .insertInto('notification_held')
        .values({
          recipient: grace,
          kind: 'mention',
          actor: ada,
          thread_id: hidden.thread,
          artifact_id: hidden.artifact,
        })
        .execute(),
    );
    expect(await held(grace)).toHaveLength(2);
    // Before the boundary after them, nothing is folded.
    expect(await tenant((trx) => foldDigests(trx, new Date()))).toBe(0);
    const tomorrow = digestBoundary(new Date(Date.now() + DAY));
    expect(await tenant((trx) => foldDigests(trx, tomorrow))).toBe(1);
    expect(await held(grace)).toEqual([]);
    const digest = (await inbox(grace)).notifications.find((each) => each.kind === 'digest')!;
    expect(digest).toMatchObject({
      actor: null,
      thread: null,
      artifact: null,
      at: tomorrow,
      counts: {
        mention: 0,
        reply: 0,
        resolution: 1,
        threads: [thread.thread],
        artifacts: [thread.artifact],
      },
    });
    // Folded once: a second fold at the same boundary finds nothing.
    expect(await tenant((trx) => foldDigests(trx, tomorrow))).toBe(0);
  });

  it('folds at the latest 07:00 UTC at or before the moment it is asked', () => {
    expect(digestBoundary(new Date('2026-10-12T07:00:00Z'))).toEqual(
      new Date('2026-10-12T07:00:00Z'),
    );
    expect(digestBoundary(new Date('2026-10-12T06:59:59Z'))).toEqual(
      new Date('2026-10-11T07:00:00Z'),
    );
    expect(digestBoundary(new Date('2026-10-12T23:00:00Z'))).toEqual(
      new Date('2026-10-12T07:00:00Z'),
    );
  });

  it('COL-062 sweeps a notification at 90 days, and lets its recipient alone delete it', async () => {
    await started([{ text: 'Over to ' }, { mention: grace }]);
    const [mine] = (await inbox(grace)).notifications;
    expect(await tenant((trx) => deleteNotification(trx, ada, mine!.id))).toBe(false);
    expect(await tenant((trx) => deleteNotification(trx, grace, mine!.id))).toBe(true);
    expect((await inbox(grace)).notifications.map((each) => each.id)).not.toContain(mine!.id);

    const thread = await started(said('Old news'), clinical, grace);
    const old = await tenant((trx) =>
      trx
        .insertInto('notification')
        .values({
          recipient: grace,
          kind: 'reply',
          actor: ada,
          thread_id: thread.thread,
          artifact_id: thread.artifact,
          at: new Date(Date.now() - 91 * DAY),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    const kept = (await inbox(grace)).notifications.length;
    expect(await tenant((trx) => sweepNotifications(trx, new Date()))).toBe(1);
    const left = (await inbox(grace)).notifications;
    expect(left).toHaveLength(kept - 1);
    expect(left.map((each) => each.id)).not.toContain(old.id);
  });
});
