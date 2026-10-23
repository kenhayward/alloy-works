import { randomUUID } from 'node:crypto';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { grant } from './grants.js';
import { claimLock, ITERATION_RETENTION_DAYS, saveIteration } from './editing.js';
import { newestUncutIteration } from './recovery.js';
import { sweepIterations } from './retention.js';
import { bringLineBack, compareLines, diverge, lineNumbers, readLines } from './lines.js';
import { cutVersion, releaseLock } from './promotion.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { readScopes, setScope } from './scopes.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
  queryAs,
} from './testing/database.js';
import {
  latestVersion,
  latestVersionsOf,
  listVersions,
  recordVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';
import {
  latestRevision,
  latestRevisionsOf,
  listWorkflows,
  moveArtifact,
  workflowStanding,
} from './workflow.js';
import { decideGate } from './workflow-gates.js';

describe('divergent lines (the R16 plan, R16-A to R16-D)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });

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
  const approve = (version: StoredVersion, line?: string) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
        ...(line === undefined ? {} : { line }),
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
        ...(line === undefined ? {} : { line }),
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });
  const edit = (version: StoredVersion, words: string, line?: string) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        ...(line === undefined ? {} : { line }),
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: words, marks: [] }],
              },
            ],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
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
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      const axis = await createDefinition(trx, {
        kind: 'conditionAxis',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Market',
          key: 'market',
          values: ['us', 'eu'].map((key) => ({ key, label: key.toUpperCase() })),
        },
        author: ada,
      });
      if (axis.answer !== 'created') throw new Error(axis.answer);
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LIF-044 diverges a line from a designated revision, numbered below the main line, shown by its name, and leaves every main-line read on the main line', async () => {
    const first = await component('Label the drum');
    await approve(first);
    const main = await edit(first, 'Central wording');

    expect(
      await as((trx) =>
        diverge(trx, { artifactId: first.artifactId, revision: 2, name: 'US', by: ada }),
      ),
    ).toEqual({ answer: 'revision.missing' });
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    expect(
      await as((trx) =>
        diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
      ),
    ).toEqual({ answer: 'line.name_taken' });

    // A line's first version opens from the revision it diverged from, and its versions are its own.
    const us1 = await edit(first, 'US wording', begun.line.id);
    const us2 = await edit(us1, 'US wording, again', begun.line.id);
    expect([us1.line, us1.revision, us1.version]).toEqual([begun.line.id, -1, 1]);
    expect([us2.revision, us2.version]).toEqual([-1, 2]);
    // Shown as the line's name, the revision it counts from and its own version, never by its sort key.
    expect(await as((trx) => lineNumbers(trx, [us1.id, us2.id, main.id]))).toEqual(
      new Map([
        [us1.id, { line: { id: begun.line.id, name: 'US' }, number: 'US 1.1' }],
        [us2.id, { line: { id: begun.line.id, name: 'US' }, number: 'US 1.2' }],
      ]),
    );

    // The main line reads as it did.
    expect((await as((trx) => latestVersion(trx, first.artifactId)))?.id).toBe(main.id);
    expect(
      (await as((trx) => latestVersionsOf(trx, [first.artifactId]))).get(first.artifactId)?.id,
    ).toBe(main.id);
    const listed = await as((trx) => listVersions(trx, first.artifactId, { limit: 50 }));
    expect(listed.items.map((each) => each.id)).toEqual([main.id, first.id]);
    expect(await as((trx) => readLines(trx, first.artifactId))).toEqual([
      expect.objectContaining({
        name: 'US',
        divergedFrom: { revision: 1, version: first.id },
        closed: false,
      }),
    ]);
    const events = await as(async (trx) => {
      const { rows } = await sql<{ detail: Record<string, unknown> }>`
        select detail from audit_event where subject = ${first.artifactId} and kind = 'line.diverged'`.execute(
        trx,
      );
      return rows.map((row) => row.detail);
    });
    expect(events).toEqual([
      {
        kind: 'component',
        line: begun.line.id,
        name: 'US',
        from: { revision: 1, version: first.id },
      },
    ]);
  });

  it("LIF-044 runs a line's workflow apart: its save leaves the main line approved, and its approval takes the next revision, served in its scope", async () => {
    const first = await component('Seal the drum');
    await approve(first);
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    const us1 = await edit(first, 'US wording', begun.line.id);
    // Saving the line leaves the main line approved; the line is a draft of its own.
    expect((await as((trx) => workflowStanding(trx, first.artifactId)))?.state.key).toBe(
      'approved',
    );
    expect(
      (await as((trx) => workflowStanding(trx, first.artifactId, begun.line.id)))?.state.key,
    ).toBe('draft');

    await as((trx) =>
      setScope(trx, {
        artifactId: first.artifactId,
        kind: 'component',
        scope: [{ axis: 'market', value: 'us', party: null }],
        by: ada,
        line: begun.line.id,
      }),
    );
    await approve(us1, begun.line.id);
    // The line's approval takes revision 2; the main line still counts from revision 1.
    expect((await as((trx) => latestRevision(trx, first.artifactId, begun.line.id)))?.number).toBe(
      2,
    );
    expect((await as((trx) => latestRevision(trx, first.artifactId)))?.number).toBe(1);
    const main = await edit(first, 'Central wording');
    expect([main.revision, main.version]).toEqual([1, 1]);

    const served = async (market: string) =>
      (
        await as((trx) =>
          latestRevisionsOf(trx, [first.artifactId], new Date(), { market: [market] }),
        )
      ).get(first.artifactId)?.versionId;
    expect(await served('us')).toBe(us1.id);
    expect(await served('eu')).toBe(first.id);
  });

  it('LIF-044 edits a line through a session: its iterations and its cut on the line, the main line untouched', async () => {
    const first = await component('Weigh the drum');
    await approve(first);
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    const session = { artifactId: first.artifactId, principal: ada, session: randomUUID() };
    await as((trx) => claimLock(trx, { ...session, line: begun.line.id }));
    const words = (value: string) => ({
      ...(substanceOf(first).content as object),
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value, marks: [] }],
        },
      ],
    });
    // The line's head is the revision it diverged from until it has a version of its own.
    expect(
      await as((trx) =>
        saveIteration(trx, {
          ...session,
          line: begun.line.id,
          sequence: 1,
          openedFrom: first.id,
          content: words('US wording') as never,
        }),
      ),
    ).toMatchObject({ answer: 'accepted' });
    const cut = await as((trx) =>
      cutVersion(trx, { ...session, line: begun.line.id, openedFrom: first.id }),
    );
    if (cut.answer !== 'recorded') throw new Error(cut.answer);
    expect([cut.version.line, cut.version.revision, cut.version.version]).toEqual([
      begun.line.id,
      -1,
      1,
    ]);
    // Opened from the line's head now, and released with nothing more to cut.
    expect(
      await as((trx) =>
        releaseLock(trx, { ...session, line: begun.line.id, openedFrom: cut.version.id }),
      ),
    ).toEqual({ answer: 'released', version: null });
    expect((await as((trx) => latestVersion(trx, first.artifactId)))?.id).toBe(first.id);
    expect((await as((trx) => workflowStanding(trx, first.artifactId)))?.state.key).toBe(
      'approved',
    );
  });

  it('LIF-045 brings a line back after comparing the two, block by block, recording what was carried and what was left, and closes it', async () => {
    const first = await component('Rinse the drum');
    await approve(first);
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    const us = await edit(first, 'US wording', begun.line.id);
    await as((trx) =>
      setScope(trx, {
        artifactId: first.artifactId,
        kind: 'component',
        scope: [{ axis: 'market', value: 'us', party: null }],
        by: ada,
        line: begun.line.id,
      }),
    );
    const main = await edit(first, 'Central wording');

    const compared = await as((trx) => compareLines(trx, first.artifactId, begun.line.id));
    expect(compared).toMatchObject({
      main: main.id,
      line: us.id,
      differences: [{ block: 'b1', change: 'changed' }],
    });
    // A comparison since overtaken is refused, as a stale save is.
    expect(
      await as((trx) =>
        bringLineBack(trx, {
          artifactId: first.artifactId,
          line: begun.line.id,
          openedFrom: first.id,
          lineHead: us.id,
          carry: ['b1'],
          by: ada,
        }),
      ),
    ).toMatchObject({ answer: 'version.precondition' });
    const back = await as((trx) =>
      bringLineBack(trx, {
        artifactId: first.artifactId,
        line: begun.line.id,
        openedFrom: main.id,
        lineHead: us.id,
        carry: ['b1'],
        by: ada,
      }),
    );
    if (back.answer !== 'returned') throw new Error(back.answer);
    // The main line takes the line's wording, and its markets (R16-G); the line is closed.
    const latest = (await as((trx) => latestVersion(trx, first.artifactId)))!;
    expect(latest.id).toBe(back.version.id);
    expect(JSON.stringify(latest.content)).toContain('US wording');
    expect(
      (await as((trx) => readScopes(trx, [first.artifactId]))).get(first.artifactId)?.scope,
    ).toEqual([{ axis: 'market', value: 'us', party: null }]);
    expect((await as((trx) => readLines(trx, first.artifactId)))[0]?.closed).toBe(true);
    const recorded = await as(async (trx) => {
      const { rows } = await sql<{ carried: unknown; left_behind: unknown }>`
        select carried, left_behind from line_return where line_id = ${begun.line.id}`.execute(trx);
      return rows[0];
    });
    expect(recorded).toEqual({ carried: [{ block: 'b1', change: 'changed' }], left_behind: [] });
    const events = await as(async (trx) => {
      const { rows } = await sql<{ detail: Record<string, unknown> }>`
        select detail from audit_event where subject = ${first.artifactId} and kind = 'line.returned'`.execute(
        trx,
      );
      return rows.map((row) => row.detail);
    });
    expect(events).toEqual([
      { kind: 'component', line: begun.line.id, into: back.version.id, carried: 1, left: 0 },
    ]);
    // Closed, it takes no more versions, and is not brought back twice.
    expect(
      await as((trx) =>
        bringLineBack(trx, {
          artifactId: first.artifactId,
          line: begun.line.id,
          openedFrom: back.version.id,
          lineHead: us.id,
          carry: [],
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'line.closed' });
  });

  it("keeps a line's unsaved work until the line's own next cut, and offers it on the line alone (the final review)", async () => {
    const first = await component('Check the valve');
    await approve(first);
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    // The main line moves on, long ago: its cut is no cut of the line's work.
    const main = await edit(first, 'Central wording');
    const session = { artifactId: first.artifactId, principal: ada, session: randomUUID() };
    await as((trx) => claimLock(trx, { ...session, line: begun.line.id }));
    const saved = await as((trx) =>
      saveIteration(trx, {
        ...session,
        line: begun.line.id,
        sequence: 1,
        openedFrom: first.id,
        content: {
          ...(substanceOf(first).content as object),
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value: 'US draft', marks: [] }],
            },
          ],
        } as never,
      }),
    );
    expect(saved).toMatchObject({ answer: 'accepted' });
    for (const [table, id] of [
      ['artifact_version', main.id],
      ['iteration', null],
    ] as const) {
      await queryAs(
        db.adminUrl,
        `update "${tenant.schema}".${table} set created_at = now() - make_interval(days => $1)
          where ${id === null ? 'artifact_id = $2' : 'id = $2'}`,
        [ITERATION_RETENTION_DAYS + 10, id ?? first.artifactId],
      );
    }
    expect(await as((trx) => sweepIterations(trx))).toBe(0);
    // Offered on its line, never on the main line.
    expect(
      await as((trx) =>
        newestUncutIteration(trx, {
          artifactId: first.artifactId,
          principalId: ada,
          line: begun.line.id,
        }),
      ),
    ).not.toBeNull();
    expect(
      await as((trx) =>
        newestUncutIteration(trx, { artifactId: first.artifactId, principalId: ada }),
      ),
    ).toBeNull();
  });

  it("refuses to bring a line back while anybody holds the component's lock, and counts a component in its main line's state (the final review)", async () => {
    const first = await component('Drain the valve');
    await approve(first);
    const counted = (workflows: Awaited<ReturnType<typeof listWorkflows>>) =>
      workflows.find((each) => each.definition.kind === 'component')!.counts;
    // The line in draft, the main line approved: the counts are as they were before the line.
    const before = counted(await as((trx) => listWorkflows(trx)));
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    const us = await edit(first, 'US wording', begun.line.id);
    await as((trx) =>
      claimLock(trx, { artifactId: first.artifactId, principal: grace, session: randomUUID() }),
    );
    expect(
      await as((trx) =>
        bringLineBack(trx, {
          artifactId: first.artifactId,
          line: begun.line.id,
          openedFrom: first.id,
          lineHead: us.id,
          carry: ['b1'],
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'lock.held' });
    expect(before).toEqual(counted(await as((trx) => listWorkflows(trx))));
    expect(
      await as(async (trx) => {
        const { rows } = await sql<{ to_state: string }>`
          select to_state from workflow_transition where artifact_id = ${first.artifactId}
            and line_id is null order by id desc limit 1`.execute(trx);
        return rows[0]?.to_state;
      }),
    ).toBe('approved');
  });
});
