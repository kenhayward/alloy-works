import { randomUUID } from 'node:crypto';
import { SEED_WORKFLOW, type WorkflowBody } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact } from './archival.js';
import { whatWaits } from './attention.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { readDates, recordEffected, recordLapses, setDates } from './dates.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { defineWorkflow, latestRevisionsOf, moveArtifact, workflowStanding } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const DAY = 86_400_000;
const day = (at: Date) => at.toISOString().slice(0, 10);

describe('effective and review-by dates (workflow.md; the WF5 plan, Task 1)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let ivy = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });
  const asSystem = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });

  const component = (title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const approve = (version: StoredVersion) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
      const passed = await decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        may: () => true,
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });

  const edit = (version: StoredVersion) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: randomUUID(), marks: [] }],
              },
            ],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const date = (
    version: StoredVersion,
    dates: { effective?: Date; offset?: number; reviewBy?: string; owner?: string },
  ) =>
    as((trx) =>
      setDates(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        effective:
          dates.effective === undefined
            ? null
            : { at: dates.effective, offset: dates.offset ?? 60 },
        reviewBy: dates.reviewBy ?? null,
        owner: dates.owner ?? null,
        by: ada,
      }),
    );

  const events = (artifactId: string, kinds: readonly string[]) =>
    as(async (trx) => {
      const { rows } = await sql<{
        kind: string;
        actor_kind: string | null;
        detail: Record<string, unknown>;
      }>`
        select kind, actor_kind, detail from audit_event where subject = ${artifactId}
          and kind = any(${kinds}::text[]) order by sequence`.execute(trx);
      return rows.map((row) => [row.kind, row.actor_kind, row.detail]);
    });

  const define = (body: WorkflowBody) =>
    as(async (trx) => {
      const saved = await defineWorkflow(trx, { kind: 'component', body, by: ada });
      if (saved.answer !== 'defined' && saved.answer !== 'unchanged') throw new Error(saved.answer);
    });

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
    await service.withTenant(tenant, async (trx) => {
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      ivy = await person('Ivy');
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
        [ivy, 'Reader'],
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

  afterEach(() => define(SEED_WORKFLOW));

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LIF-015 LIF-016 sets an effective date apart from approval, and a review-by date with its owner, as audited acts', async () => {
    const made = await component('Calibrate the scale');
    const effective = new Date('2026-12-01T08:00:00.000Z');
    expect(
      await date(made, { effective, offset: 60, reviewBy: '2027-06-30', owner: grace }),
    ).toMatchObject({
      answer: 'set',
      dates: { effective: { at: effective, offset: 60 }, reviewBy: '2027-06-30', owner: grace },
    });
    // The same again changes nothing.
    expect(
      (await date(made, { effective, offset: 60, reviewBy: '2027-06-30', owner: grace })).answer,
    ).toBe('unchanged');
    expect(await events(made.artifactId, ['dates.set'])).toEqual([
      [
        'dates.set',
        'person',
        {
          kind: 'component',
          effectiveAt: '2026-12-01T09:00:00.000+01:00',
          reviewBy: '2027-06-30',
          owner: grace,
        },
      ],
    ]);
    await as((trx) => archiveArtifact(trx, made.artifactId, ada));
    expect((await date(made, { reviewBy: '2027-07-01' })).answer).toBe('artifact.archived');
  });

  it('LIF-060 fixes a future effective date as the revision is approved, serves it only from that instant, and records its taking effect once, by nobody', async () => {
    const made = await component('Weigh the sample');
    await approve(made);
    const next = await edit(made);
    const effective = new Date(Date.now() + 2 * DAY);
    await date(made, { effective });
    await approve(next);
    const served = (now: Date) =>
      as(async (trx) =>
        (await latestRevisionsOf(trx, [made.artifactId], now)).get(made.artifactId),
      );
    // Approved, and still revision 1 that a reference takes, until the date.
    expect(await served(new Date())).toMatchObject({ number: 1, versionId: made.id });
    const after = new Date(effective.getTime() + 1000);
    expect(await served(after)).toMatchObject({ number: 2, versionId: next.id });
    // Fixed: a later date set changes nothing of the revision approved.
    await date(made, { effective: new Date(Date.now() + 10 * DAY) });
    expect(await served(after)).toMatchObject({ number: 2 });

    expect(await asSystem((trx) => recordEffected(trx, new Date()))).toBe(0);
    expect(await asSystem((trx) => recordEffected(trx, after))).toBe(1);
    expect(await asSystem((trx) => recordEffected(trx, after))).toBe(0);
    expect(await events(made.artifactId, ['revision.effective'])).toEqual([
      [
        'revision.effective',
        'system',
        {
          kind: 'component',
          revision: 2,
          version: next.id,
          effectiveAt: effective.toISOString(),
        },
      ],
    ]);
  });

  it('LIF-060 takes a revision effective as it is approved where its date has passed or none is set', async () => {
    const made = await component('Label the tray');
    await date(made, { effective: new Date(Date.now() - DAY) });
    await approve(made);
    expect(
      await as(async (trx) =>
        (await latestRevisionsOf(trx, [made.artifactId])).get(made.artifactId),
      ),
    ).toMatchObject({ number: 1 });
  });

  it('LIF-017 prompts the owner on Home from the days the workflow says before review falls due, and nobody else', async () => {
    await define({ ...SEED_WORKFLOW, review: { remind: 10, lapse: { kind: 'visibility' } } });
    const soon = await component('Due soon');
    const later = await component('Due later');
    const now = new Date();
    await date(soon, { reviewBy: day(new Date(now.getTime() + 5 * DAY)), owner: ivy });
    await date(later, { reviewBy: day(new Date(now.getTime() + 40 * DAY)), owner: ivy });
    const waiting = (who: string) =>
      as(async (trx) =>
        (await whatWaits(trx, who, 20, now)).items.filter((each) => each.kind === 'review_due'),
      );
    expect(await waiting(ivy)).toEqual([
      {
        kind: 'review_due',
        artifact: { id: soon.artifactId, kind: 'component', title: 'Due soon' },
        reviewBy: day(new Date(now.getTime() + 5 * DAY)),
      },
    ]);
    expect(await waiting(ada)).toEqual([]);
  });

  it('LIF-059 LIF-018 acts on a lapsed review once, as the workflow declares: shown alone, moved, or escalated to a person', async () => {
    const now = new Date();
    const yesterday = day(new Date(now.getTime() - DAY));
    const lapse = async (title: string, policy: WorkflowBody['review']) => {
      await define({ ...SEED_WORKFLOW, review: policy });
      const made = await component(title);
      await date(made, { reviewBy: yesterday, owner: ada });
      expect(await asSystem((trx) => recordLapses(trx, now))).toBe(1);
      expect(await asSystem((trx) => recordLapses(trx, now))).toBe(0);
      return made;
    };

    const shown = await lapse('Shown alone', { remind: 30, lapse: { kind: 'visibility' } });
    expect(await events(shown.artifactId, ['review.lapsed'])).toEqual([
      ['review.lapsed', 'system', { kind: 'component', reviewBy: yesterday, action: 'visibility' }],
    ]);
    expect((await as((trx) => workflowStanding(trx, shown.artifactId)))!.state.key).toBe('draft');

    const movedOne = await lapse('Moved', { remind: 30, lapse: { kind: 'move', to: 'in_review' } });
    expect((await as((trx) => workflowStanding(trx, movedOne.artifactId)))!.state.key).toBe(
      'in_review',
    );
    expect(await events(movedOne.artifactId, ['workflow.transitioned', 'review.lapsed'])).toEqual([
      [
        'workflow.transitioned',
        'system',
        expect.objectContaining({ transition: null, to: 'in_review' }),
      ],
      ['review.lapsed', 'system', expect.objectContaining({ action: 'move', to: 'in_review' })],
    ]);

    const escalated = await lapse('Escalated', {
      remind: 30,
      lapse: { kind: 'escalate', to: grace },
    });
    const overdue = (who: string) =>
      as(async (trx) =>
        (await whatWaits(trx, who, 20, now)).items.filter((each) => each.kind === 'review_overdue'),
      );
    expect(await overdue(grace)).toEqual([
      {
        kind: 'review_overdue',
        artifact: { id: escalated.artifactId, kind: 'component', title: 'Escalated' },
        reviewBy: yesterday,
      },
    ]);
    expect(await overdue(ada)).toEqual([]);
    // A new review date starts again: the escalation stands no longer.
    await date(escalated, { reviewBy: day(new Date(now.getTime() + 90 * DAY)), owner: ada });
    expect(await overdue(grace)).toEqual([]);
    expect(
      (await as((trx) => readDates(trx, [escalated.artifactId]))).get(escalated.artifactId),
    ).toMatchObject({ owner: ada });
  });
});
