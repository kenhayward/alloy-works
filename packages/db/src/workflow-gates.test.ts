import { randomUUID } from 'node:crypto';
import { SEED_WORKFLOW, type ContentDocument, type WorkflowBody } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact } from './archival.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
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
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { defineWorkflow, moveArtifact, workflowStanding } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const words = (value: string) => [{ type: 'text' as const, value, marks: [] }];

/** The seed with its gate asking for `approvals`, authors allowed or not. */
const gated = (approvals: number, notAuthor = true): WorkflowBody => ({
  ...SEED_WORKFLOW,
  transitions: SEED_WORKFLOW.transitions.map((each) =>
    each.gate === undefined ? each : { ...each, gate: { ...each.gate, approvals, notAuthor } },
  ),
});

describe('gates, approvals and revisions (workflow.md; the WF2 plan, Task 1)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let lin = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (title = 'Calibrate the scale') =>
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

  const revise = (version: StoredVersion, text: string, author = ada) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author,
        substance: {
          ...substance,
          content: {
            ...(version.content as ContentDocument),
            content: [{ type: 'paragraph', id: 'b1', style: 'body', content: words(text) }],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const submit = (version: StoredVersion) =>
    as((trx) =>
      moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      }),
    );

  const decide = (
    version: StoredVersion,
    by: string,
    decision: 'approved' | 'rejected' = 'approved',
    options: { reason?: string; may?: boolean } = {},
  ) =>
    as((trx) =>
      decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision,
        reason: options.reason,
        by,
        may: () => options.may ?? true,
      }),
    );

  const standing = (version: StoredVersion) =>
    as(async (trx) => (await workflowStanding(trx, version.artifactId))!);

  const events = (artifactId: string, kinds: readonly string[]) =>
    as(async (trx) => {
      const { rows } = await sql<{ kind: string; detail: Record<string, unknown> }>`
        select kind, detail from audit_event where subject = ${artifactId}
          and kind = any(${kinds}::text[]) order by sequence`.execute(trx);
      return rows.map((row) => [row.kind, row.detail]);
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
    await as(async (trx) => {
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
      lin = await person('Lin');
    });
  });

  afterEach(() => define(SEED_WORKFLOW));

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LIF-003 seeds Approve as a gate, which no plain move takes', async () => {
    const made = await component();
    await submit(made);
    expect(await standing(made)).toMatchObject({
      state: { key: 'in_review' },
      definition: { version: 2 },
      gates: [{ transition: 'approve', count: 0, required: 1, approvedBy: [] }],
    });
    expect(
      await as((trx) =>
        moveArtifact(trx, {
          artifactId: made.artifactId,
          kind: 'component',
          transition: 'approve',
          from: 'in_review',
          by: grace,
          may: () => true,
        }),
      ),
    ).toEqual({ answer: 'transition.gated' });
  });

  it('LIF-008 LIF-009 LIF-036 passes a component’s gate at the second distinct approver, recording who, when, which version and which gate', async () => {
    await define(gated(2));
    const made = await component();
    await submit(made);
    expect(await decide(made, grace)).toMatchObject({
      answer: 'approved',
      standing: { state: { key: 'in_review' }, gates: [{ count: 1, required: 2 }] },
    });
    expect(await decide(made, grace)).toEqual({ answer: 'approval.given' });
    expect(await decide(made, lin)).toMatchObject({
      answer: 'passed',
      revision: 1,
      standing: { state: { key: 'approved' }, revision: { number: 1, versionId: made.id } },
    });
    const rows = await as((trx) =>
      trx
        .selectFrom('workflow_approval')
        .select(['version_id', 'transition', 'decision', 'by', 'at'])
        .where('artifact_id', '=', made.artifactId)
        .orderBy('id')
        .execute(),
    );
    expect(rows.map(({ at: _, ...row }) => row)).toEqual([
      { version_id: made.id, transition: 'approve', decision: 'approved', by: grace },
      { version_id: made.id, transition: 'approve', decision: 'approved', by: lin },
    ]);
    expect(rows.every((row) => row.at instanceof Date)).toBe(true);
    expect(
      await events(made.artifactId, [
        'approval.given',
        'workflow.transitioned',
        'revision.designated',
      ]),
    ).toEqual([
      ['workflow.transitioned', expect.objectContaining({ transition: 'submit' })],
      ['approval.given', { kind: 'component', transition: 'approve', count: 1, required: 2 }],
      ['approval.given', { kind: 'component', transition: 'approve', count: 2, required: 2 }],
      ['workflow.transitioned', expect.objectContaining({ transition: 'approve', to: 'approved' })],
      ['revision.designated', { kind: 'component', transition: 'approve', revision: 1 }],
    ]);
  });

  it('LIF-010 refuses an approval by anyone who recorded a version since the last revision, where the gate says so', async () => {
    const made = await component();
    const edited = await revise(made, 'Zero it first.', grace);
    await submit(edited);
    expect(await decide(edited, ada)).toEqual({ answer: 'approval.author' });
    expect(await decide(edited, grace)).toEqual({ answer: 'approval.author' });
    expect(await decide(edited, lin)).toMatchObject({ answer: 'passed' });

    await define(gated(1, false));
    const other = await component();
    await submit(other);
    expect(await decide(other, ada)).toMatchObject({ answer: 'passed' });
  });

  it('starts the count again when the artifact is saved during review, and refuses an approval of a version since replaced', async () => {
    await define(gated(2));
    const made = await component();
    await submit(made);
    await decide(made, grace);
    const saved = await revise(made, 'Zero it first.');
    expect((await standing(made)).gates).toEqual([
      { transition: 'approve', count: 0, required: 2, approvedBy: [] },
    ]);
    expect(await decide(made, lin)).toMatchObject({ answer: 'version.moved' });
    expect(await decide(saved, lin)).toMatchObject({ answer: 'approved' });
    expect(await decide(saved, grace)).toMatchObject({ answer: 'passed' });
  });

  it('LIF-051 LIF-052 LIF-074 rejects to the declared state, the reason required and kept, audited as a gate rejected', async () => {
    const made = await component();
    await submit(made);
    expect(await decide(made, grace, 'rejected')).toEqual({ answer: 'reason.required' });
    expect(await decide(made, grace, 'rejected', { reason: 'Name the weights.' })).toMatchObject({
      answer: 'rejected',
      standing: { state: { key: 'draft' } },
    });
    const row = await as((trx) =>
      trx
        .selectFrom('workflow_approval')
        .select(['decision', 'reason', 'by', 'version_id'])
        .where('artifact_id', '=', made.artifactId)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({
      decision: 'rejected',
      reason: 'Name the weights.',
      by: grace,
      version_id: made.id,
    });
    expect(await events(made.artifactId, ['gate.rejected'])).toEqual([
      ['gate.rejected', { kind: 'component', transition: 'approve', to: 'draft' }],
    ]);
  });

  it('refuses a decision by whoever may not approve, on an archived artifact, or out of the gate’s state', async () => {
    const made = await component();
    expect(await decide(made, grace)).toMatchObject({ answer: 'state.moved' });
    await submit(made);
    expect(await decide(made, grace, 'approved', { may: false })).toEqual({
      answer: 'permission.refused',
      permission: 'approve',
    });
    await as((trx) => archiveArtifact(trx, made.artifactId, ada));
    expect(await decide(made, grace)).toEqual({ answer: 'artifact.archived' });
  });

  it('VER-012 VER-013 VER-014 VER-015 designates a revision as a gate passes, numbered from 1; later versions carry its number; none designated is revision 0', async () => {
    const made = await component();
    expect((await standing(made)).revision).toBeNull();
    expect(made).toMatchObject({ revision: 0, version: 1 });
    await submit(made);
    await decide(made, grace);
    const designation = await as((trx) =>
      trx
        .selectFrom('revision_designation')
        .select(['version_id', 'revision_no', 'transition', 'by'])
        .where('artifact_id', '=', made.artifactId)
        .executeTakeFirstOrThrow(),
    );
    expect(designation).toEqual({
      version_id: made.id,
      revision_no: 1,
      transition: 'approve',
      by: grace,
    });
    const next = await revise(made, 'Zero it first.');
    expect(next).toMatchObject({ revision: 1, version: 1 });
    expect((await standing(made)).state.key).toBe('draft');
    await submit(next);
    expect(await decide(next, grace)).toMatchObject({ answer: 'passed', revision: 2 });
    expect((await standing(made)).revision).toMatchObject({ number: 2, versionId: next.id });
  });

  it('designates a version once: approved again unchanged, it keeps its revision', async () => {
    const made = await component();
    await submit(made);
    await decide(made, grace);
    await as((trx) =>
      moveArtifact(trx, {
        artifactId: made.artifactId,
        kind: 'component',
        transition: 'reopen',
        from: 'approved',
        reason: 'One more look.',
        by: ada,
        may: () => true,
      }),
    );
    await submit(made);
    expect(await decide(made, lin)).toMatchObject({ answer: 'passed', revision: 1 });
    expect((await standing(made)).revision).toMatchObject({ number: 1, versionId: made.id });
  });
});
