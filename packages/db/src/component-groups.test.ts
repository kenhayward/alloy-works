import { randomUUID } from 'node:crypto';
import {
  groupPlacements,
  readOutline,
  type OutlineDocument,
  type ReferenceNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  createComponentGroup,
  listComponentGroups,
  memberViews,
  placeComponentGroup,
  placedGroups,
  previewGroupTake,
  readComponentGroup,
  recordComponentGroupVersion,
  removeComponentGroup,
  takeComponentGroup,
} from './component-groups.js';
import { createComponent } from './creation.js';
import { deleteArtifact } from './deletion.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { previewMove } from './moving.js';
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
import { componentUses } from './uses.js';
import { latestVersion, recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { decideGate } from './workflow-gates.js';
import { moveArtifact, workflowStanding } from './workflow.js';

const ISSUER = 'https://idp.example';

describe('component groups (the CG plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let shared = '';
  let elsewhere = '';
  let hidden = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const person = (trx: TenantTransaction, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const component = (title: string, space = shared) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  /** The next version of a component, its title changed. */
  const revise = (version: StoredVersion, title: string) =>
    as(async (trx) => {
      const substance = substanceOf(version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: grace,
        substance: { ...substance, content: { ...substance.content, title } },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const document = () =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: shared,
        title: 'An SOP',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const outline: OutlineDocument = {
        ...(made.version.content as OutlineDocument),
        nodes: [
          {
            type: 'section',
            id: 'r'.repeat(26),
            title: [{ type: 'text', value: 'References', marks: [] }],
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            children: [],
          },
        ],
      };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const approve = (artifactId: string) =>
    as(async (trx) => {
      const version = (await latestVersion(trx, artifactId))!;
      const submitted = await moveArtifact(trx, {
        artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: grace,
        may: () => true,
      });
      if (submitted.answer !== 'moved') throw new Error(submitted.answer);
      const answer = await decideGate(trx, {
        artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: ada,
        may: () => true,
      });
      if (answer.answer !== 'passed') throw new Error(answer.answer);
    });

  const members = (doc: StoredVersion) => {
    const read = readOutline(doc.content, { artifact: doc.artifactId, version: doc.id });
    if (!read.ok) throw new Error(read.failure);
    return read.outline.nodes[0]!.children as ReferenceNode[];
  };

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
      shared = (await createSpace(trx, 'Shared')).id;
      elsewhere = (await createSpace(trx, 'Elsewhere')).id;
      hidden = (await createSpace(trx, 'Hidden')).id;
      ada = await person(trx, 'Ada');
      grace = await person(trx, 'Grace');
      const author = (await findRole(trx, 'Author'))!.id;
      for (const [who, space] of [
        [ada, shared],
        [grace, shared],
        [grace, elsewhere],
        [grace, hidden],
      ] as const) {
        await grant(trx, {
          roleId: author,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: who,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('REU-060 makes a group in a space, each member pinned, its latest where none is named', async () => {
    const boilerplate = await component('Boilerplate');
    const warning = await component('Warning');
    const made = await as((trx) =>
      createComponentGroup(trx, {
        author: grace,
        spaceId: shared,
        title: 'References',
        members: [
          { component: boilerplate.artifactId, version: boilerplate.id },
          { component: warning.artifactId },
        ],
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    expect(made.group.group.members).toEqual([
      { component: boilerplate.artifactId, version: boilerplate.id },
      { component: warning.artifactId, version: warning.id },
    ]);
    expect(made.group.space).toEqual({ id: shared, name: 'Shared' });
    // It moves under the component workflow (CG-A).
    const standing = await as((trx) => workflowStanding(trx, made.group.id));
    expect(standing?.kind).toBe('component');
    expect(standing?.state.key).toBe('draft');
  });

  it('REU-060 refuses a member that is a group, unreadable, or at a version not its own', async () => {
    const one = await component('One');
    const two = await component('Two');
    const secret = await component('Secret', hidden);
    const group = await as((trx) =>
      createComponentGroup(trx, {
        author: grace,
        spaceId: shared,
        title: 'G',
        members: [{ component: one.artifactId }],
      }),
    );
    if (group.answer !== 'created') throw new Error(group.answer);
    for (const bad of [
      { component: group.group.id },
      { component: secret.artifactId },
      { component: one.artifactId, version: two.id },
    ]) {
      const answer = await as((trx) =>
        createComponentGroup(trx, {
          author: ada,
          spaceId: shared,
          title: 'Bad',
          members: [{ component: two.artifactId }, bad],
        }),
      );
      expect(answer).toEqual({ answer: 'member.invalid', index: 1 });
    }
    await expect(
      as((trx) =>
        createComponentGroup(trx, {
          author: grace,
          spaceId: shared,
          title: 'Twice',
          members: [{ component: one.artifactId }, { component: one.artifactId }],
        }),
      ),
    ).rejects.toThrow(/once/);
  });

  it('REU-060 cuts a version, refused when opened from an older one, a draft again after approval', async () => {
    const one = await component('Alpha');
    const two = await component('Beta');
    const made = await as((trx) =>
      createComponentGroup(trx, {
        author: grace,
        spaceId: shared,
        title: 'Pair',
        members: [{ component: one.artifactId }],
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    await approve(made.group.id);
    const cut = await as((trx) =>
      recordComponentGroupVersion(trx, {
        author: grace,
        id: made.group.id,
        openedFrom: made.group.version.id,
        title: 'Pair',
        members: [{ component: one.artifactId }, { component: two.artifactId }],
      }),
    );
    if (cut.answer !== 'recorded') throw new Error(cut.answer);
    expect(cut.group.group.members).toHaveLength(2);
    expect((await as((trx) => workflowStanding(trx, made.group.id)))?.state.key).toBe('draft');
    const stale = await as((trx) =>
      recordComponentGroupVersion(trx, {
        author: grace,
        id: made.group.id,
        openedFrom: made.group.version.id,
        title: 'Pair',
        members: [{ component: two.artifactId }],
      }),
    );
    expect(stale.answer).toBe('version.precondition');
    // Its page offers a member's newer version (CG-K).
    const newer = await revise(one, 'Alpha, again');
    const views = await as((trx) => memberViews(trx, ada, cut.group.group));
    expect(views[0]).toEqual({
      component: { id: one.artifactId, title: 'Alpha, again' },
      version: { id: one.id, number: '0.1' },
      newest: { id: newer.id, number: '0.2' },
    });
  });

  it('lists the groups a reader may read, by title', async () => {
    const one = await component('Listed');
    for (const title of ['Zulu group', 'Alpha group']) {
      await as((trx) =>
        createComponentGroup(trx, {
          author: grace,
          spaceId: shared,
          title,
          members: [{ component: one.artifactId }],
        }),
      );
    }
    const secret = await component('Hidden member', hidden);
    await as((trx) =>
      createComponentGroup(trx, {
        author: grace,
        spaceId: hidden,
        title: 'Aardvark hidden',
        members: [{ component: secret.artifactId }],
      }),
    );
    const listed = await as((trx) => listComponentGroups(trx, ada, { limit: 100 }));
    const titles = listed!.items.map((each) => each.title);
    expect(titles).toContain('Alpha group');
    expect(titles).not.toContain('Aardvark hidden');
    expect(titles.indexOf('Alpha group')).toBeLessThan(titles.indexOf('Zulu group'));
    const inHidden = await as((trx) =>
      listComponentGroups(trx, grace, { limit: 100 }, { space: hidden }),
    );
    expect(inHidden!.items.map((each) => each.title)).toEqual(['Aardvark hidden']);
    expect(inHidden!.items[0]).toMatchObject({ members: 1, state: { key: 'draft' } });
  });

  it('REU-061 REU-062 places a group, offers a newer approved version, and takes it', async () => {
    const [a, b, c] = [await component('A'), await component('B'), await component('C')];
    const made = await as((trx) =>
      createComponentGroup(trx, {
        author: grace,
        spaceId: shared,
        title: 'Run',
        members: [{ component: a.artifactId }, { component: b.artifactId }],
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const doc = await document();
    const unapproved = await as((trx) =>
      placeComponentGroup(trx, {
        documentId: doc.artifactId,
        openedFrom: doc.id,
        author: ada,
        group: made.group.id,
        parent: 'r'.repeat(26),
        position: 0,
      }),
    );
    expect(unapproved).toEqual({ answer: 'group.unapproved' });
    await approve(made.group.id);
    const placed = await as((trx) =>
      placeComponentGroup(trx, {
        documentId: doc.artifactId,
        openedFrom: doc.id,
        author: ada,
        group: made.group.id,
        parent: 'r'.repeat(26),
        position: 0,
      }),
    );
    if (placed.answer !== 'recorded') throw new Error(placed.answer);
    const run = members(placed.version);
    expect(run.map((each) => each.component)).toEqual([a.artifactId, b.artifactId]);
    expect(run.map((each) => each.mode)).toEqual([
      { kind: 'pinned', version: a.id },
      { kind: 'pinned', version: b.id },
    ]);
    const placement = run[0]!.group!.placement;

    // The index: document to group, group to member (CG-J).
    const rows = await as((trx) =>
      sql<{ from_id: string; to_id: string; to_kind: string; node: string | null }>`
        select from_id, to_id, to_kind, node from reference
         where from_id in (${doc.artifactId}, ${made.group.id}) and to_kind <> 'template'
         order by to_kind, to_id`.execute(trx),
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        {
          from_id: doc.artifactId,
          to_id: made.group.id,
          to_kind: 'componentGroup',
          node: placement,
        },
        { from_id: made.group.id, to_id: a.artifactId, to_kind: 'component', node: null },
      ]),
    );

    // No newer version yet; a second, approved, is offered.
    expect(
      (await as((trx) => placedGroups(trx, ada, readOutlineOf(placed.version))))[0]!.newer,
    ).toBeNull();
    const second = await as((trx) =>
      recordComponentGroupVersion(trx, {
        author: grace,
        id: made.group.id,
        openedFrom: made.group.version.id,
        title: 'Run',
        members: [{ component: b.artifactId }, { component: c.artifactId }],
      }),
    );
    if (second.answer !== 'recorded') throw new Error(second.answer);
    await approve(made.group.id);
    const offered = await as((trx) => placedGroups(trx, ada, readOutlineOf(placed.version)));
    expect(offered).toEqual([
      {
        placement,
        group: { id: made.group.id, title: 'Run' },
        version: { id: made.group.version.id, number: '0.1' },
        newer: {
          id: second.group.version.id,
          number: second.group.version.revision + '.' + second.group.version.version,
        },
      },
    ]);
    // An approved document never changes by itself (CG-F): the run still pins the first.
    expect(
      members((await as((trx) => latestVersion(trx, doc.artifactId)))!)[0]!.group!.version,
    ).toBe(made.group.version.id);

    const preview = await as((trx) =>
      previewGroupTake(trx, {
        documentId: doc.artifactId,
        by: ada,
        placement,
        version: second.group.version.id,
      }),
    );
    expect(preview).toEqual({
      answer: 'preview',
      preview: {
        added: [{ id: c.artifactId, title: 'C' }],
        removed: [{ id: a.artifactId, title: 'A' }],
        kept: 1,
        overridesDropped: 0,
      },
    });
    const taken = await as((trx) =>
      takeComponentGroup(trx, {
        documentId: doc.artifactId,
        openedFrom: placed.version.id,
        author: ada,
        placement,
        version: second.group.version.id,
      }),
    );
    if (taken.answer !== 'recorded') throw new Error(taken.answer);
    const after = members(taken.version);
    expect(after.map((each) => each.component)).toEqual([b.artifactId, c.artifactId]);
    expect(after[0]!.id).toBe(run[1]!.id);

    const removed = await as((trx) =>
      removeComponentGroup(trx, {
        documentId: doc.artifactId,
        openedFrom: taken.version.id,
        author: ada,
        placement,
      }),
    );
    if (removed.answer !== 'recorded') throw new Error(removed.answer);
    expect(members(removed.version)).toEqual([]);
    expect(groupPlacements(readOutlineOf(removed.version))).toEqual([]);
  });

  it('REU-063 names a group in where-used, and keeps a pinned member from deletion and moving', async () => {
    const pinned = await component('Pinned member');
    const made = await as((trx) =>
      createComponentGroup(trx, {
        author: grace,
        spaceId: shared,
        title: 'Holding group',
        members: [{ component: pinned.artifactId }],
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const uses = await as((trx) => componentUses(trx, ada, pinned.artifactId));
    expect(uses.groups).toEqual({
      named: [{ id: made.group.id, title: 'Holding group' }],
      unreadable: false,
    });
    const deleted = await as((trx) => deleteArtifact(trx, pinned.artifactId, grace));
    expect(deleted).toEqual({
      answer: 'refused',
      refusals: [
        {
          reason: 'grouped',
          named: [{ id: made.group.id, title: 'Holding group' }],
          unreadable: false,
        },
      ],
    });
    const moved = await as((trx) =>
      previewMove(trx, {
        artifactId: pinned.artifactId,
        from: shared,
        to: elsewhere,
        by: grace,
        scopes: undefined,
        also: false,
      }),
    );
    expect(moved).toEqual({ answer: 'artifact.not_movable' });
    expect(await as((trx) => readComponentGroup(trx, made.group.id))).toBeDefined();
  });
});

function readOutlineOf(version: StoredVersion): OutlineDocument {
  const read = readOutline(version.content, { artifact: version.artifactId, version: version.id });
  if (!read.ok) throw new Error(read.failure);
  return read.outline;
}
