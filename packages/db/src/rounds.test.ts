import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { invite } from './invitations.js';
import { listInbox } from './inbox.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { actOnRound, closeRound, openRound, readRound } from './rounds.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('review rounds', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let robot = '';
  let general = '';

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  const due = new Date(Date.now() + 7 * 86_400_000);
  const document = async () => {
    const made = await tenant((trx) =>
      createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version.artifactId;
  };
  const open = (on: string, reviewers = [grace], over: Record<string, unknown> = {}) =>
    tenant((trx) =>
      openRound(trx, {
        document: on,
        title: 'First review',
        scope: [],
        dueAt: due,
        baseline: null,
        reviewers,
        by: ada,
        ...over,
      }),
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
      const person = (subject: string, name: string, kind = 'user') =>
        trx
          .insertInto('principal')
          .values({
            issuer: kind === 'service' ? null : 'https://idp.example',
            subject: kind === 'service' ? null : subject,
            email: null,
            display_name: name,
            kind,
          } as never)
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      robot = await person('robot', 'Importer', 'service');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      // Grace reads General, so she is told of a round there.
      await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: grace },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('COL-028 opens a round naming its reviewers, its scope and its due date, kept against the version it opened on, and tells each reviewer', async () => {
    const on = await document();
    const opened = await open(on);
    if (opened.answer !== 'opened') throw new Error(opened.answer);
    expect(opened.round).toMatchObject({
      document: on,
      title: 'First review',
      scope: [],
      reviewers: [grace],
      baseline: null,
      closed: null,
      summary: { complete: 0, of: 1, everybody: false },
    });
    expect(opened.round.dueAt.getTime()).toBe(due.getTime());
    const told = await tenant((trx) => listInbox(trx, grace, { limit: 10 }));
    expect(told.notifications).toEqual([
      expect.objectContaining({
        kind: 'round',
        round: opened.round.id,
        artifact: on,
        thread: null,
      }),
    ]);
  });

  it('refuses a scope node the document does not have, a reviewer who is not a person, and no reviewer', async () => {
    const on = await document();
    expect(await open(on, [grace], { scope: ['z'.repeat(26)] })).toEqual({
      answer: 'scope.invalid',
      nodes: ['z'.repeat(26)],
    });
    expect(await open(on, [grace, robot])).toEqual({
      answer: 'reviewers.invalid',
      reviewers: [robot],
    });
    expect(await open(on, [])).toEqual({ answer: 'reviewers.invalid', reviewers: [] });
    // Nor one invited who has not yet accepted, whom withdrawing the invitation would remove.
    const invited = await tenant((trx) =>
      invite(trx, { email: 'ivy@example.com', external: false, invitedBy: ada }),
    );
    if (!('invited' in invited)) throw new Error(invited.refused);
    expect(await open(on, [grace, invited.invited.principalId])).toEqual({
      answer: 'reviewers.invalid',
      reviewers: [invited.invited.principalId],
    });
    // The caller's own decision on grants refuses before anything is recorded or anybody told.
    expect(await open(on, [grace], { unable: async () => 1 })).toEqual({
      answer: 'reviewers.unable',
      count: 1,
    });
  });

  it('COL-029 COL-032 COL-050 COL-057 records each reviewer starting, completing with nothing to say against the version they read, and reopening with who and when, each once, and nothing once closed', async () => {
    const on = await document();
    const opened = await open(on, [grace, ada]);
    if (opened.answer !== 'opened') throw new Error(opened.answer);
    const round = opened.round.id;
    const act = (
      reviewer: string,
      what: 'started' | 'completed' | 'reopened',
      outcome?: 'nothing_to_say',
    ) =>
      tenant((trx) =>
        actOnRound(trx, { round, reviewer, act: what, ...(outcome ? { outcome } : {}) }),
      );
    expect((await act(grace, 'started')).answer).toBe('done');
    expect((await act(grace, 'reopened')).answer).toBe('review.not_complete');
    const done = await act(grace, 'completed', 'nothing_to_say');
    if (done.answer !== 'done') throw new Error(done.answer);
    expect(done.round.summary.reviewers).toContainEqual(
      expect.objectContaining({ reviewer: grace, state: 'complete', outcome: 'nothing_to_say' }),
    );
    // Recorded against the version it was completed on (COL-050).
    expect(done.round.acts.at(-1)).toMatchObject({
      reviewer: grace,
      act: 'completed',
      outcome: 'nothing_to_say',
      version: opened.round.madeAgainst,
    });
    expect((await act(grace, 'completed')).answer).toBe('review.complete');
    const reopened = await act(grace, 'reopened');
    if (reopened.answer !== 'done') throw new Error(reopened.answer);
    // Recorded with who and when (COL-057).
    expect(reopened.round.acts.at(-1)).toMatchObject({
      reviewer: grace,
      act: 'reopened',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect((await tenant((trx) => readRound(trx, round)))!.summary.reviewers).toContainEqual({
      reviewer: grace,
      state: 'in_progress',
    });
    // Ada, never started, is not started: nothing read from silence (COL-058).
    expect((await tenant((trx) => readRound(trx, round)))!.summary.reviewers).toContainEqual({
      reviewer: ada,
      state: 'not_started',
    });
    const closed = await tenant((trx) => closeRound(trx, { round, by: ada }));
    expect(closed.answer).toBe('closed');
    expect((await tenant((trx) => closeRound(trx, { round, by: grace }))).answer).toBe('closed');
    expect((await act(grace, 'completed')).answer).toBe('round.closed');
  });

  it('COL-050 keeps every round, reviewer and act: the runtime role changes and removes none', async () => {
    for (const table of ['review_round', 'review_round_reviewer', 'review_round_event']) {
      await expect(
        tenant((trx) => sql`delete from ${sql.table(table)}`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      tenant((trx) => sql`update review_round set title = 'Other'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
