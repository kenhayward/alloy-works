import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  SEED_DOCUMENT_WORKFLOW,
  SEED_WORKFLOW,
  SEED_WORKFLOW_1,
  type BlockNode,
  type ContentDocument,
  type OutlineDocument,
  type WorkflowBody,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact } from './archival.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument, editOutline } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { restoreVersion } from './restore.js';
import { findRole } from './roles.js';
import { searchWords, type SearchAnswer, type SearchOptions } from './search-words.js';
import { createSpace } from './spaces.js';
import { acceptSuggestion, makeSuggestion } from './suggestions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import {
  defineWorkflow,
  listWorkflows,
  moveArtifact,
  newestDefinition,
  workflowStanding,
  workflowVersion,
} from './workflow.js';

const ISSUER = 'https://idp.example';
const words = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: words(value),
});
/** WF1's workflow, without a gate: what these tests move under, as each kind's newest. */
const PLAIN = SEED_WORKFLOW_1;
/** PLAIN's version for each kind: after the seed's 2 components', after its 3 documents'. */
const plainVersion = { component: 3, document: 4 } as const;

const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };

function resultsOf(answer: SearchAnswer | 'baseline_not_found' | undefined) {
  if (answer === undefined || answer === 'baseline_not_found' || answer.outcome !== 'results') {
    throw new Error(`Expected results, not ${JSON.stringify(answer)}`);
  }
  return answer;
}

describe('workflow states and transitions (workflow.md; the WF1 plan, Task 1)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let other: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (title = 'Install the printer') =>
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

  const document = (title = 'Printer guide') =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const revise = (version: StoredVersion, text: string) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: {
          ...substance,
          content: { ...(version.content as ContentDocument), content: [para('b1', text)] },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const move = (
    version: StoredVersion,
    transition: string,
    from: string,
    options: { reason?: string; may?: boolean } = {},
  ) =>
    as((trx) =>
      moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: version.kind as 'component' | 'document',
        transition,
        from,
        reason: options.reason,
        by: ada,
        may: () => options.may ?? true,
      }),
    );

  /** Submitted and approved. */
  const approve = async (version: StoredVersion) => {
    expect(await move(version, 'submit', 'draft')).toMatchObject({ answer: 'moved' });
    expect(await move(version, 'approve', 'in_review')).toMatchObject({ answer: 'moved' });
  };

  const stateOf = (id: string) => as(async (trx) => (await workflowStanding(trx, id))?.state.key);

  const moves = (id: string) =>
    as(async (trx) => {
      const { rows } = await sql<{ kind: string; detail: Record<string, unknown> }>`
        select kind, detail from audit_event where subject = ${id}
          and kind = 'workflow.transitioned' order by sequence`.execute(trx);
      return rows.map((row) => row.detail);
    });

  const search = (query: string, options: SearchOptions = {}) =>
    as(async (trx) => resultsOf(await searchWords(trx, ada, query, options)));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Staging' },
      hostnames: ['staging.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await as(async (trx) => {
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      for (const kind of ['component', 'document'] as const) {
        await defineWorkflow(trx, { kind, body: PLAIN, by: ada });
      }
      for (const who of [ada, grace]) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
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

  it("LIF-001 LIF-002 LIF-054 seeds every tenant with each kind's workflow: version 1, and version 2 with its gate", async () => {
    const definitions = await service.withTenant(other, (trx) => listWorkflows(trx));
    expect(
      definitions.map((summary) => [summary.definition.kind, summary.definition.version]),
    ).toEqual([
      ['component', 2],
      ['document', 3],
      ['queryDefinition', 1],
    ]);
    for (const summary of definitions) {
      expect(summary.definition.body).toEqual(
        summary.definition.kind === 'document' ? SEED_DOCUMENT_WORKFLOW : SEED_WORKFLOW,
      );
      expect(summary.definition.by).toBeNull();
      // A query definition's workflow began at the gated seed (0098); the others at WF1's.
      if (summary.definition.kind === 'queryDefinition') continue;
      const first = await service.withTenant(other, (trx) =>
        workflowVersion(trx, summary.definition.kind, 1),
      );
      expect(first?.body).toEqual(SEED_WORKFLOW_1);
    }
  });

  it('LIF-007 starts a new component and document in the initial state, under the definition in force', async () => {
    for (const made of [await component(), await document()]) {
      const standing = await as((trx) => workflowStanding(trx, made.artifactId));
      expect(standing).toMatchObject({
        kind: made.kind,
        state: { key: 'draft', name: 'Draft', approved: false },
        definition: { version: plainVersion[made.kind as 'component' | 'document'] },
      });
      const rows = await as((trx) =>
        trx
          .selectFrom('workflow_transition as t')
          .innerJoin('workflow_definition as d', 'd.id', 't.definition_id')
          .select(['t.transition', 't.from_state', 't.to_state', 't.by', 'd.version_no'])
          .where('t.artifact_id', '=', made.artifactId)
          .execute(),
      );
      expect(rows).toEqual([
        {
          transition: null,
          from_state: null,
          to_state: 'draft',
          by: ada,
          version_no: plainVersion[made.kind as 'component' | 'document'],
        },
      ]);
    }
  });

  it('LIF-002 LIF-061 moves by a transition the caller may take, recording a required reason, and refuses one without it', async () => {
    const made = await component();
    expect(await move(made, 'submit', 'draft', { may: false })).toEqual({
      answer: 'permission.refused',
      permission: 'edit',
    });
    expect(await stateOf(made.artifactId)).toBe('draft');
    expect(await move(made, 'submit', 'draft')).toMatchObject({
      answer: 'moved',
      standing: { state: { key: 'in_review' } },
    });
    expect(await move(made, 'return', 'in_review')).toEqual({ answer: 'reason.required' });
    expect(await move(made, 'return', 'in_review', { reason: '   ' })).toEqual({
      answer: 'reason.required',
    });
    expect(await move(made, 'return', 'in_review', { reason: 'Name the tray.' })).toMatchObject({
      answer: 'moved',
    });
    expect(await move(made, 'approve', 'draft')).toEqual({ answer: 'transition.unknown' });
    const rows = await as((trx) =>
      trx
        .selectFrom('workflow_transition')
        .select(['transition', 'from_state', 'to_state', 'reason', 'version_id'])
        .where('artifact_id', '=', made.artifactId)
        .orderBy('id')
        .execute(),
    );
    expect(rows.slice(1)).toEqual([
      {
        transition: 'submit',
        from_state: 'draft',
        to_state: 'in_review',
        reason: null,
        version_id: made.id,
      },
      {
        transition: 'return',
        from_state: 'in_review',
        to_state: 'draft',
        reason: 'Name the tray.',
        version_id: made.id,
      },
    ]);
  });

  it('audits every transition: its kind, transition, states, definition version and whether a reason was given', async () => {
    const made = await document();
    await move(made, 'submit', 'draft');
    await move(made, 'return', 'in_review', { reason: 'Too short.' });
    expect(await moves(made.artifactId)).toEqual([
      {
        kind: 'document',
        transition: 'submit',
        from: 'draft',
        to: 'in_review',
        definition: 4,
        reason: false,
      },
      {
        kind: 'document',
        transition: 'return',
        from: 'in_review',
        to: 'draft',
        definition: 4,
        reason: true,
      },
    ]);
  });

  it('refuses a stale from-state and an archived artifact, by name', async () => {
    const made = await component();
    await move(made, 'submit', 'draft');
    expect(await move(made, 'submit', 'draft')).toMatchObject({ answer: 'state.moved' });
    await as((trx) => archiveArtifact(trx, made.artifactId, ada));
    expect(await move(made, 'approve', 'in_review')).toEqual({ answer: 'artifact.archived' });
    expect(await stateOf(made.artifactId)).toBe('in_review');
  });

  it('serialises a move with an archive racing it: the move, after, sees it archived', async () => {
    const made = await component();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let archived!: () => void;
    const holding = new Promise<void>((resolve) => (archived = resolve));
    const archiving = as(async (trx) => {
      await archiveArtifact(trx, made.artifactId, ada);
      archived();
      await gate;
    });
    await holding;
    const moving = move(made, 'submit', 'draft');
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await archiving;
    expect(await moving).toEqual({ answer: 'artifact.archived' });
  });

  it('LIF-007 LIF-054 applies a tightened permission at once, keeps a dropped state under the version it moved under, and keeps every version', async () => {
    const kept = await component('Kept in review');
    await move(kept, 'submit', 'draft');
    const tightened: WorkflowBody = {
      states: PLAIN.states.filter((each) => each.key !== 'in_review'),
      transitions: [
        {
          key: 'submit',
          name: 'Approve',
          from: 'draft',
          to: 'approved',
          permission: 'approve',
          reasonRequired: false,
        },
        {
          key: 'reopen',
          name: 'Reopen',
          from: 'approved',
          to: 'draft',
          permission: 'edit',
          reasonRequired: true,
        },
      ],
    };
    const defined = await as((trx) =>
      defineWorkflow(trx, { kind: 'component', body: tightened, by: ada }),
    );
    expect(defined).toMatchObject({ answer: 'defined', definition: { version: 4 } });
    try {
      // A draft's submit now needs approve, at once.
      const fresh = await component('Fresh draft');
      expect(await move(fresh, 'submit', 'draft', { may: false })).toEqual({
        answer: 'permission.refused',
        permission: 'approve',
      });
      expect(await move(fresh, 'submit', 'draft')).toMatchObject({
        answer: 'moved',
        standing: { state: { key: 'approved' }, definition: { version: 4 } },
      });
      // In review, which version 2 dropped: kept, and moved under version 1.
      expect(await as((trx) => workflowStanding(trx, kept.artifactId))).toMatchObject({
        state: { key: 'in_review', name: 'In review' },
        definition: { version: 3 },
      });
      expect(await move(kept, 'approve', 'in_review')).toMatchObject({ answer: 'moved' });
      expect((await moves(kept.artifactId)).at(-1)).toMatchObject({ definition: 3 });
      expect(await as((trx) => workflowVersion(trx, 'component', 1))).toMatchObject({
        body: PLAIN,
      });
      expect(await as((trx) => workflowVersion(trx, 'component', 5))).toBeUndefined();
      // The same body again changes nothing.
      expect(
        await as((trx) => defineWorkflow(trx, { kind: 'component', body: tightened, by: ada })),
      ).toMatchObject({ answer: 'unchanged', definition: { version: 4 } });
    } finally {
      await as((trx) => defineWorkflow(trx, { kind: 'component', body: PLAIN, by: ada }));
    }
  });

  it('LIF-001 refuses a body with an unreachable state or a duplicate key, saving nothing', async () => {
    const before = await as((trx) => newestDefinition(trx, 'document'));
    const answer = await as((trx) =>
      defineWorkflow(trx, {
        kind: 'document',
        body: {
          states: [...PLAIN.states, { key: 'lost', name: 'Lost' }],
          transitions: PLAIN.transitions,
        },
        by: ada,
      }),
    );
    expect(answer).toMatchObject({ answer: 'invalid', problems: [{ rule: 'state_unreachable' }] });
    expect((await as((trx) => newestDefinition(trx, 'document'))).version).toBe(before.version);
  });

  it('saves two definitions at once as two versions, each audited', async () => {
    const before = (await as((trx) => newestDefinition(trx, 'document'))).version;
    const renamed = (name: string): WorkflowBody => ({
      ...PLAIN,
      states: PLAIN.states.map((each) => (each.key === 'draft' ? { ...each, name } : each)),
    });
    const saved = await Promise.all(
      ['Working', 'Writing'].map((name) =>
        as((trx) => defineWorkflow(trx, { kind: 'document', body: renamed(name), by: grace })),
      ),
    );
    const versions = saved.map((each) => ('definition' in each ? each.definition.version : 0));
    expect(versions.sort()).toEqual([before + 1, before + 2]);
    const events = await as(async (trx) => {
      const { rows } = await sql<{ detail: unknown }>`
        select detail from audit_event where kind = 'workflow.defined' order by sequence`.execute(
        trx,
      );
      return rows.map((row) => row.detail);
    });
    expect(events.slice(-2)).toEqual([
      { kind: 'document', version: before + 1 },
      { kind: 'document', version: before + 2 },
    ]);
    await as((trx) => defineWorkflow(trx, { kind: 'document', body: PLAIN, by: ada }));
  });

  it('refuses a save based on a version another has since replaced, saving nothing', async () => {
    const before = (await as((trx) => newestDefinition(trx, 'component'))).version;
    const renamed: WorkflowBody = {
      ...PLAIN,
      states: PLAIN.states.map((each) =>
        each.key === 'draft' ? { ...each, name: 'Working' } : each,
      ),
    };
    const saved = await as((trx) =>
      defineWorkflow(trx, { kind: 'component', body: renamed, by: grace, basedOn: before }),
    );
    expect(saved).toMatchObject({ answer: 'defined', definition: { version: before + 1 } });
    const behind = await as((trx) =>
      defineWorkflow(trx, { kind: 'component', body: PLAIN, by: ada, basedOn: before }),
    );
    expect(behind).toEqual({ answer: 'behind', version: before + 1 });
    expect((await as((trx) => newestDefinition(trx, 'component'))).version).toBe(before + 1);
    await as((trx) => defineWorkflow(trx, { kind: 'component', body: PLAIN, by: ada }));
  });

  it('never moves a component under the document workflow', async () => {
    const made = await component();
    const documents = await as((trx) => newestDefinition(trx, 'document'));
    await expect(
      as((trx) =>
        trx
          .insertInto('workflow_transition')
          .values({
            artifact_id: made.artifactId,
            kind: 'component',
            from_state: 'draft',
            transition: 'submit',
            to_state: 'in_review',
            definition_id: documents.id,
            by: ada,
          })
          .execute(),
      ),
    ).rejects.toThrow(/foreign key/u);
  });

  it('keeps its moves inserted and never changed, and every row following the state before it', async () => {
    const made = await component();
    await expect(
      as((trx) =>
        trx
          .updateTable('workflow_transition')
          .set({ to_state: 'approved' })
          .where('artifact_id', '=', made.artifactId)
          .execute(),
      ),
    ).rejects.toThrow(/permission denied/u);
    const definition = await as((trx) => newestDefinition(trx, 'component'));
    await expect(
      as((trx) =>
        trx
          .insertInto('workflow_transition')
          .values({
            artifact_id: made.artifactId,
            kind: 'component',
            from_state: 'in_review',
            transition: 'approve',
            to_state: 'approved',
            definition_id: definition.id,
            by: ada,
          })
          .execute(),
      ),
    ).rejects.toThrow(/is in draft, not in_review/u);
  });

  describe('a save of an approved artifact starts a draft (WF-F)', () => {
    it('moves an approved component saved to draft, audited, naming the version approved', async () => {
      const made = await component();
      await approve(made);
      const saved = await revise(made, 'Unbox it.');
      expect(await stateOf(made.artifactId)).toBe('draft');
      expect((await moves(made.artifactId)).at(-1)).toEqual({
        kind: 'component',
        transition: null,
        from: 'approved',
        to: 'draft',
        definition: (await as((trx) => newestDefinition(trx, 'component'))).version,
        reason: false,
        approved: made.id,
      });
      const last = await as((trx) =>
        trx
          .selectFrom('workflow_transition')
          .select(['version_id', 'transition'])
          .where('artifact_id', '=', made.artifactId)
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow(),
      );
      expect(last).toEqual({ version_id: saved.id, transition: null });
      // A save in any other state leaves it.
      await revise(saved, 'Unbox it carefully.');
      expect(await stateOf(made.artifactId)).toBe('draft');
    });

    it('moves an approved document saved through its outline to draft', async () => {
      const made = await document();
      const placed = await component('Placed');
      await approve(made);
      const recorded = await as((trx) =>
        editOutline(trx, {
          artifactId: made.artifactId,
          openedFrom: made.id,
          author: ada,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'reference', component: placed.artifactId, mode: { kind: 'latest' } },
          },
        }),
      );
      expect(recorded.answer).toBe('recorded');
      expect(await stateOf(made.artifactId)).toBe('draft');
      expect((await moves(made.artifactId)).at(-1)).toMatchObject({
        from: 'approved',
        to: 'draft',
      });
    });

    it('moves an approved component restored to an earlier version to draft', async () => {
      const made = await component();
      const later = await revise(made, 'Unbox it.');
      await approve(later);
      const restored = await as((trx) =>
        restoreVersion(trx, {
          artifactId: made.artifactId,
          version: made.id,
          latest: later.id,
          by: ada,
        }),
      );
      expect(restored.answer).toBe('restored');
      expect(await stateOf(made.artifactId)).toBe('draft');
    });

    it('moves an approved component to draft when a suggestion on it is accepted', async () => {
      const made = await revise(await component(), 'Unbox it.');
      await approve(made);
      const suggested = await as((trx) =>
        makeSuggestion(trx, {
          component: made.artifactId,
          version: made.id,
          proposed: {
            ...(made.content as ContentDocument),
            content: [para('b1', 'Unbox it gently.')],
          },
          by: grace,
        }),
      );
      if (suggested.answer !== 'made') throw new Error(suggested.answer);
      const accepted = await as((trx) =>
        acceptSuggestion(trx, { suggestion: suggested.suggestion, by: ada }),
      );
      expect(accepted.answer).toBe('accepted');
      expect(await stateOf(made.artifactId)).toBe('draft');
    });
  });

  describe('search by state (WF-H)', () => {
    const unique = () => `quoll${randomBytes(4).toString('hex')}`;

    it('SCH-060 narrows by state and facets on it, for the latest and every version, after a move', async () => {
      const word = unique();
      const moving = await revise(await component(`${word} moving`), `${word} text`);
      await component(`${word} staying`);
      await move(moving, 'submit', 'draft');
      for (const scope of ['latest', 'all'] as const) {
        const all = await search(word, { scope });
        expect(all.facets.states, scope).toEqual([
          { value: 'draft', label: 'Draft', count: 1, capped: false },
          { value: 'in_review', label: 'In review', count: 1, capped: false },
        ]);
        const narrowed = await search(word, { scope, filters: { states: ['in_review'] } });
        expect(
          narrowed.items.map((item) => item.artifactId),
          scope,
        ).toEqual([moving.artifactId]);
        // The state's own facet leaves its filter out.
        expect(
          narrowed.facets.states.map((each) => each.value),
          scope,
        ).toEqual(['draft', 'in_review']);
      }
    });

    it("names each result by its own kind's workflow, and a facet by both where they differ", async () => {
      const word = unique();
      const placed = await component(`${word} part`);
      const made = await document(`${word} guide`);
      await move(placed, 'submit', 'draft');
      await move(made, 'submit', 'draft');
      const checking: WorkflowBody = {
        ...PLAIN,
        states: PLAIN.states.map((each) =>
          each.key === 'in_review' ? { ...each, name: 'Checking' } : each,
        ),
      };
      await as((trx) => defineWorkflow(trx, { kind: 'document', body: checking, by: grace }));
      try {
        const found = await search(word);
        expect(
          Object.fromEntries(found.items.map((item) => [item.kind, item.state?.name])),
        ).toEqual({ component: 'In review', document: 'Checking' });
        expect(found.facets.states).toEqual([
          { value: 'in_review', label: 'In review or Checking', count: 2, capped: false },
        ]);
      } finally {
        await as((trx) => defineWorkflow(trx, { kind: 'document', body: PLAIN, by: ada }));
      }
    });

    it('SCH-060 finds a section by its document state', async () => {
      const word = unique();
      const made = await document(`${word} guide`);
      const recorded = await as((trx) =>
        recordVersion(trx, {
          artifactId: made.artifactId,
          openedFrom: made.id,
          author: ada,
          substance: {
            kind: 'document',
            content: {
              ...(made.content as OutlineDocument),
              nodes: [
                {
                  type: 'section',
                  id: blockIdentifierFrom(randomBytes(16)),
                  title: words(`${word} scope`),
                  ...base,
                  children: [],
                },
              ],
            },
          },
        }),
      );
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      await move(recorded.version, 'submit', 'draft');
      for (const scope of ['latest', 'all'] as const) {
        const found = await search(word, { scope, filters: { states: ['in_review'] } });
        expect(found.items.map((item) => item.kind).sort(), scope).toEqual(['document', 'section']);
        expect(
          (await search(word, { scope, filters: { states: ['draft'] } })).items,
          scope,
        ).toEqual([]);
      }
    });
  });
});
