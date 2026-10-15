import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  SEED_DOCUMENT_WORKFLOW,
  SEED_WORKFLOW,
  type ContentDocument,
  type OutlineDocument,
  type ReferenceNode,
  type TransitionCondition,
  type WorkflowBody,
  type WorkflowKind,
} from '@alloy-works/domain';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import { makeSuggestion, rejectSuggestion } from './suggestions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { resolveThread, startThread } from './threads.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { defineWorkflow, moveArtifact, workflowStanding } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const words = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: blockIdentifierFrom(randomBytes(16)),
  component,
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});

/** `body` with the transition `key` requiring `requires`. */
const requiring = (
  body: WorkflowBody,
  key: string,
  requires: TransitionCondition[],
): WorkflowBody => ({
  ...body,
  transitions: body.transitions.map((each) => (each.key === key ? { ...each, requires } : each)),
});

describe('what a transition requires (workflow.md; the WF3 plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';
  let elsewhere = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (title: string, where = space) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: where,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const content = (version: StoredVersion, text: string): ContentDocument => ({
    ...(version.content as ContentDocument),
    content: [{ type: 'paragraph', id: 'b1', style: 'body', content: words(text) }],
  });

  const revise = (version: StoredVersion, text: string) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: { ...substance, content: content(version, text) },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const documentOf = (components: readonly string[]) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const outline: OutlineDocument = {
        ...(made.version.content as OutlineDocument),
        nodes: components.map(reference),
      };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const define = (kind: WorkflowKind, body: WorkflowBody) =>
    as(async (trx) => {
      const saved = await defineWorkflow(trx, { kind, body, by: ada });
      if (saved.answer !== 'defined' && saved.answer !== 'unchanged') throw new Error(saved.answer);
    });

  const submit = (version: StoredVersion, kind: WorkflowKind = 'component') =>
    as((trx) =>
      moveArtifact(trx, {
        artifactId: version.artifactId,
        kind,
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      }),
    );

  const decide = (
    version: StoredVersion,
    kind: WorkflowKind = 'component',
    decision: 'approved' | 'rejected' = 'approved',
  ) =>
    as((trx) =>
      decideGate(trx, {
        artifactId: version.artifactId,
        kind,
        transition: 'approve',
        version: version.id,
        decision,
        reason: decision === 'rejected' ? 'Not yet.' : undefined,
        by: grace,
        may: () => true,
      }),
    );

  const thread = (version: StoredVersion) =>
    as(async (trx) => {
      const started = await startThread(trx, {
        on: version.artifactId,
        version: version.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'Is this the right tray?' }],
        author: grace,
      });
      if (started.answer !== 'done') throw new Error(started.answer);
      return started.thread;
    });

  const approvals = (artifactId: string) =>
    as((trx) =>
      trx
        .selectFrom('workflow_approval')
        .select('decision')
        .where('artifact_id', '=', artifactId)
        .execute(),
    );

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
      elsewhere = (await createSpace(trx, `Elsewhere ${randomUUID()}`)).id;
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
      // Grace approves in the space and may not read elsewhere, where Ada authors too.
      for (const [who, role, where] of [
        [ada, 'Author', space],
        [ada, 'Author', elsewhere],
        [grace, 'Approver', space],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: where },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterEach(async () => {
    await define('component', SEED_WORKFLOW);
    await define('document', SEED_DOCUMENT_WORKFLOW);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LIF-004 COL-066 holds a move while a suggestion is unresolved or a thread open, recording nothing', async () => {
    await define('component', requiring(SEED_WORKFLOW, 'submit', ['suggestions', 'threads']));
    const made = await revise(await component('Calibrate the scale'), 'Set the tray.');
    const suggested = await as((trx) =>
      makeSuggestion(trx, {
        component: made.artifactId,
        version: made.id,
        proposed: content(made, 'Set the tray level.'),
        by: grace,
      }),
    );
    if (suggested.answer !== 'made') throw new Error(suggested.answer);
    const open = await thread(made);

    expect(await submit(made)).toEqual({
      answer: 'conditions.unmet',
      unmet: [
        { condition: 'suggestions', count: 1, names: [], unreadable: 0 },
        { condition: 'threads', count: 1, names: [], unreadable: 0 },
      ],
    });
    expect((await as((trx) => workflowStanding(trx, made.artifactId)))!.state.key).toBe('draft');

    await as((trx) => rejectSuggestion(trx, { suggestion: suggested.suggestion, by: ada }));
    expect(await submit(made)).toMatchObject({
      answer: 'conditions.unmet',
      unmet: [{ condition: 'threads', count: 1 }],
    });
    await as((trx) => resolveThread(trx, { thread: open, by: grace }));
    expect(await submit(made)).toMatchObject({ answer: 'moved' });
  });

  it('LIF-004 holds every approval at a gate while a condition is unmet, recording none, and never a rejection', async () => {
    await define('component', requiring(SEED_WORKFLOW, 'approve', ['threads']));
    const made = await component('Weigh the sample');
    await submit(made);
    const open = await thread(made);

    expect(await decide(made)).toMatchObject({
      answer: 'conditions.unmet',
      unmet: [{ condition: 'threads', count: 1 }],
    });
    expect(await approvals(made.artifactId)).toEqual([]);
    // Sent back with the thread still open: a rejection is never held.
    expect(await decide(made, 'component', 'rejected')).toMatchObject({ answer: 'rejected' });

    await as((trx) => resolveThread(trx, { thread: open, by: grace }));
    await submit(made);
    expect(await decide(made)).toMatchObject({ answer: 'passed' });
  });

  it("LIF-004 counts a document's open threads, its own and every component's, read by the approver or not", async () => {
    await define('document', requiring(SEED_DOCUMENT_WORKFLOW, 'submit', ['threads']));
    const hidden = await component('Hidden method', elsewhere);
    const shown = await component('Shown method');
    const document = await documentOf([shown.artifactId, hidden.artifactId]);
    await thread(hidden);
    await thread(shown);

    expect(await submit(document, 'document')).toEqual({
      answer: 'conditions.unmet',
      unmet: [{ condition: 'threads', count: 2, names: [], unreadable: 0 }],
    });
  });

  it('LIF-039 requires every component a document assembles at an approved revision, naming those that are not and counting those its approver may not read', async () => {
    await define('document', requiring(SEED_DOCUMENT_WORKFLOW, 'approve', ['components']));
    const approved = await component('Approved method');
    await submit(approved);
    expect(await decide(approved)).toMatchObject({ answer: 'passed' });
    const draft = await component('Draft method');
    const hidden = await component('Hidden method', elsewhere);

    const document = await documentOf([approved.artifactId, draft.artifactId, hidden.artifactId]);
    await submit(document, 'document');
    expect(await decide(document, 'document')).toEqual({
      answer: 'conditions.unmet',
      unmet: [{ condition: 'components', count: 1, names: ['Draft method'], unreadable: 1 }],
    });
    expect(await approvals(document.artifactId)).toEqual([]);

    // Edited since its revision, the approved component is no longer at one.
    await revise(approved, 'Measured again.');
    const only = await documentOf([approved.artifactId]);
    await submit(only, 'document');
    expect(await decide(only, 'document')).toMatchObject({
      answer: 'conditions.unmet',
      unmet: [{ condition: 'components', count: 1, names: ['Approved method'], unreadable: 0 }],
    });

    const fresh = await component('Fresh method');
    await submit(fresh);
    await decide(fresh);
    const passing = await documentOf([fresh.artifactId]);
    await submit(passing, 'document');
    expect(await decide(passing, 'document')).toMatchObject({ answer: 'passed' });
  });
});
