import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { whatWaits } from './attention.js';
import { makeBaseline } from './baselines.js';
import { bootstrapCluster } from './bootstrap.js';
import { changesSince } from './changes.js';
import { listReadableComponents } from './components.js';
import { createComponent } from './creation.js';
import {
  deleteArtifact,
  deletionOf,
  isDeleted,
  undeleteArtifact,
  type DeletionRefusal,
} from './deletion.js';
import {
  createDocument,
  editOutline,
  listReadableDocuments,
  readableComponents,
} from './documents.js';
import { claimLock } from './editing.js';
import { grant } from './grants.js';
import { placeHold } from './holds.js';
import { readableOf } from './inbox.js';
import { streamScope } from './live.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { requestPublication } from './publishing.js';
import { findRole } from './roles.js';
import { openRound } from './rounds.js';
import { searchWords } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { publish } from './testing/every-kind.js';
import { latestVersion, recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});

describe('deleting a component or a document (lifecycle.md; the DL plan, DL-A to DL-F)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const person = (trx: TenantTransaction, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const allow = async (trx: TenantTransaction, who: string, space: string) => {
    for (const name of ['Author', 'Publisher']) {
      await grant(trx, {
        roleId: (await findRole(trx, name))!.id,
        subject: { principal: who },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: who,
      });
    }
  };

  /** A space Ada and Grace author, and a second only Grace reads. */
  const fresh = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const elsewhere = (await createSpace(trx, `Elsewhere ${randomUUID()}`)).id;
      const ada = await person(trx, 'Ada');
      const grace = await person(trx, 'Grace');
      await allow(trx, ada, space);
      await allow(trx, grace, space);
      await allow(trx, grace, elsewhere);
      return { space, elsewhere, ada, grace };
    });

  const component = (space: string, author: string, title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });

  /** A document at a second version holding these nodes, or at its first holding none. */
  const document = (space: string, author: string, title: string, nodes: OutlineNode[] = []) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (nodes.length === 0) return made.version;
      const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  /** The document's latest without the references it held. */
  const emptied = (version: StoredVersion, author: string) =>
    as(async (trx) => {
      const outline = { ...(version.content as OutlineDocument), nodes: [] };
      const recorded = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author,
        substance: { kind: 'document', content: outline },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const baseline = (version: StoredVersion, maker: string, name = 'Issue 1') =>
    as(async (trx) => {
      const made = await makeBaseline(trx, {
        documentId: version.artifactId,
        version: version.id,
        name,
        maker,
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return made.baseline;
    });

  const remove = (id: string, by: string) => as((trx) => deleteArtifact(trx, id, by));
  const bring = (id: string, by: string) => as((trx) => undeleteArtifact(trx, id, by));
  const refusals = async (id: string, by: string): Promise<readonly DeletionRefusal[]> => {
    const answer = await remove(id, by);
    if (answer?.answer !== 'refused') throw new Error(`Expected a refusal, not ${answer?.answer}`);
    return answer.refusals;
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
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('LIF-023 VER-023 refuses deleting a component a baseline pins, superseded or not, naming the baseline', async () => {
    const { space, ada } = await fresh();
    const pinned = await component(space, ada, 'Pinned procedure');
    const report = await document(space, ada, 'Pinned report', [reference(pinned)]);
    const issue = await baseline(report, ada);
    // The reference gone from the latest, the baseline still pins the version it took.
    await emptied(report, ada);
    expect(await refusals(pinned, ada)).toEqual([
      { reason: 'baselined', named: [{ id: issue, title: 'Issue 1' }], unnamed: 0 },
    ]);
    expect(await as((trx) => isDeleted(trx, pinned))).toBe(false);
  });

  it('LIF-023 refuses deleting a component a publication placed or a queued request places, and a document published or asked for', async () => {
    const { space, ada } = await fresh();
    const placed = await component(space, ada, 'Placed procedure');
    const report = await document(space, ada, 'Published report', [reference(placed)]);
    const publication = await as((trx) =>
      publish(trx, { document: report, author: ada, role: tenant.role }),
    );
    const waiting = await component(space, ada, 'Waiting procedure');
    const queued = await document(space, ada, 'Queued report', [reference(waiting)]);
    const request = await as(async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: queued.artifactId,
        version: queued.id,
        formats: ['pdf'],
        requester: ada,
        kind: 'preview',
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return asked.request.id;
    });
    // Each reference gone from the latest, so neither is refused for being referenced.
    await emptied(report, ada);
    await emptied(queued, ada);
    expect(await refusals(placed, ada)).toEqual([
      { reason: 'published', named: [{ id: publication, title: 'Published report' }], unnamed: 0 },
    ]);
    expect(await refusals(waiting, ada)).toEqual([
      { reason: 'publishing', named: [{ id: request, title: 'Queued report' }], unnamed: 0 },
    ]);
    expect(await refusals(report.artifactId, ada)).toEqual([
      { reason: 'published', named: [{ id: publication, title: 'Published report' }], unnamed: 0 },
    ]);
    expect(await refusals(queued.artifactId, ada)).toEqual([
      { reason: 'publishing', named: [{ id: request, title: 'Queued report' }], unnamed: 0 },
    ]);
  });

  it('LIF-021 refuses deleting what a hold holds, on it or on its space, and never refuses an undelete', async () => {
    const { space, ada } = await fresh();
    const held = await component(space, ada, 'Held procedure');
    const inSpace = await component(space, ada, 'Spaced procedure');
    const plain = await component(space, ada, 'Plain procedure');
    await as((trx) => placeHold(trx, { target: { artifact: held }, reason: 'A matter', by: ada }));
    expect(await refusals(held, ada)).toEqual([{ reason: 'held' }]);
    expect(await remove(plain, ada)).toEqual({ answer: 'deleted' });
    await as((trx) => placeHold(trx, { target: { space }, reason: 'A matter', by: ada }));
    expect(await refusals(inSpace, ada)).toEqual([{ reason: 'held' }]);
    expect(await bring(plain, ada)).toEqual({ answer: 'undeleted' });
  });

  it('LIF-021 refuses deleting a document a baseline depends on that a hold also holds, naming both', async () => {
    const { space, ada } = await fresh();
    const report = await document(space, ada, 'Held and pinned report');
    const issue = await baseline(report, ada);
    await as((trx) =>
      placeHold(trx, { target: { artifact: report.artifactId }, reason: 'A matter', by: ada }),
    );
    expect(await refusals(report.artifactId, ada)).toEqual([
      { reason: 'baselined', named: [{ id: issue, title: 'Issue 1' }], unnamed: 0 },
      { reason: 'held' },
    ]);
  });

  it('LIF-023 lists every reason, not the first, and counts what the deleter may not read rather than naming it', async () => {
    const { space, elsewhere, ada, grace } = await fresh();
    const busy = await component(space, ada, 'Busy procedure');
    const seen = await document(space, ada, 'Seen report', [reference(busy)]);
    // A document in a space Ada may not read references it too.
    await document(elsewhere, grace, 'Unseen report', [reference(busy)]);
    const issue = await baseline(seen, ada);
    await as((trx) =>
      claimLock(trx, { artifactId: busy, principal: grace, session: randomUUID() }),
    );
    expect(await refusals(busy, ada)).toEqual([
      { reason: 'baselined', named: [{ id: issue, title: 'Issue 1' }], unnamed: 0 },
      {
        reason: 'referenced',
        named: [{ id: seen.artifactId, title: 'Seen report' }],
        unnamed: 1,
      },
      { reason: 'locked', holder: { id: grace, name: 'Grace' } },
    ]);
  });

  it('refuses deleting a document in an open review round, naming the round', async () => {
    const { space, ada, grace } = await fresh();
    const report = await document(space, ada, 'Reviewed report');
    const round = await as(async (trx) => {
      const opened = await openRound(trx, {
        document: report.artifactId,
        title: 'First review',
        scope: [],
        dueAt: new Date(Date.now() + 86_400_000),
        baseline: null,
        reviewers: [grace],
        by: ada,
      });
      if (opened.answer !== 'opened') throw new Error(opened.answer);
      return opened.round.id;
    });
    expect(await refusals(report.artifactId, ada)).toEqual([
      { reason: 'in_review', named: [{ id: round, title: 'First review' }], unnamed: 0 },
    ]);
  });

  it('VER-047 VER-048 states what remains and keeps it: versions, events, everything but the listing', async () => {
    const { space, ada } = await fresh();
    const gone = await component(space, ada, 'Remaining procedure');
    const before = await as((trx) => deletionOf(trx, gone, ada));
    expect(before).toMatchObject({
      kind: 'component',
      deleted: false,
      refusals: [],
      remains: { versions: 1, iterations: 0, threads: 0, suggestions: 0, rounds: 0 },
    });
    expect(await remove(gone, ada)).toEqual({ answer: 'deleted' });
    const after = await as((trx) => deletionOf(trx, gone, ada));
    expect(after).toMatchObject({ deleted: true, remains: { versions: 1 } });
    expect(after!.remains.events).toBeGreaterThan(before!.remains.events);
    // Kept in the store: its version and its artifact, read by id.
    expect((await as((trx) => latestVersion(trx, gone)))?.artifactId).toBe(gone);
  });

  it('leaves every reader while deleted - listings, search, references, the inbox, attention, streams - and comes back on undelete', async () => {
    const { space, ada } = await fresh();
    const word = `deleted${randomUUID().replaceAll('-', '')}`;
    const gone = await component(space, ada, `Gone ${word}`);
    const report = await document(space, ada, `Gone ${word} report`);
    expect(await remove(gone, ada)).toEqual({ answer: 'deleted' });
    expect(await remove(report.artifactId, ada)).toEqual({ answer: 'deleted' });

    const listed = await as(async (trx) => ({
      components: (await listReadableComponents(trx, ada, { limit: 50 }, { spaces: [space] }))!,
      archived: (await listReadableComponents(
        trx,
        ada,
        { limit: 50 },
        { spaces: [space], archived: 'only' },
      ))!,
      documents: (await listReadableDocuments(trx, ada, { limit: 50 }, { spaces: [space] }))!,
      found: await searchWords(trx, ada, word),
      readable: await readableComponents(trx, ada, [gone]),
      inbox: await readableOf(trx, ada, [gone, report.artifactId]),
      stream: await streamScope(trx, ada, { component: gone }),
      document: await streamScope(trx, ada, { document: report.artifactId }),
    }));
    expect(listed.components.items).toEqual([]);
    expect(listed.components.total).toBe(0);
    expect(listed.archived.items).toEqual([]);
    expect(listed.documents.items).toEqual([]);
    expect(listed.found).toMatchObject({ outcome: 'results', count: 0 });
    expect([...listed.readable]).toEqual([]);
    expect([...listed.inbox]).toEqual([]);
    expect(listed.stream).toBeUndefined();
    expect(listed.document).toBeUndefined();

    // An edit cannot be recorded, so indexing never brings it back.
    const latest = (await as((trx) => latestVersion(trx, gone)))!;
    expect(
      await as((trx) =>
        recordVersion(trx, {
          artifactId: gone,
          openedFrom: latest.id,
          author: ada,
          substance: substanceOf(latest),
        }),
      ),
    ).toEqual({ answer: 'artifact.missing' });

    expect(await bring(gone, ada)).toEqual({ answer: 'undeleted' });
    expect(await bring(gone, ada)).toEqual({ answer: 'unchanged' });
    const back = await as(async (trx) => ({
      components: (await listReadableComponents(trx, ada, { limit: 50 }, { spaces: [space] }))!,
      found: await searchWords(trx, ada, word),
    }));
    expect(back.components.items.map((each) => each.id)).toEqual([gone]);
    expect(back.found).toMatchObject({ outcome: 'results', count: 1 });
  });

  it('leaves Needs your attention, and is reported by what changed since as deleted and undeleted', async () => {
    const { space, ada } = await fresh();
    const since = new Date(Date.now() - 1000);
    const report = await document(space, ada, 'Changing report');
    expect(await remove(report.artifactId, ada)).toEqual({ answer: 'deleted' });
    const waits = await as((trx) => whatWaits(trx, ada));
    expect(waits.items.map((each) => each.artifact.id)).not.toContain(report.artifactId);
    const changed = await as((trx) => changesSince(trx, { since, reader: ada, space }));
    expect(changed.artifacts).toEqual([
      expect.objectContaining({
        artifact: report.artifactId,
        deletion: { act: 'deleted', at: expect.any(Date) },
      }),
    ]);
    await bring(report.artifactId, ada);
    const again = await as((trx) => changesSince(trx, { since, reader: ada, space }));
    expect(again.artifacts[0]).toMatchObject({ deletion: { act: 'undeleted' } });
  });

  it('refuses deleting a component a deleted document references, so undeleting the document is consistent', async () => {
    const { space, ada } = await fresh();
    const kept = await component(space, ada, 'Kept procedure');
    const report = await document(space, ada, 'Deleted report', [reference(kept)]);
    expect(await remove(report.artifactId, ada)).toEqual({ answer: 'deleted' });
    expect(await refusals(kept, ada)).toEqual([
      {
        reason: 'referenced',
        named: [{ id: report.artifactId, title: 'Deleted report' }],
        unnamed: 0,
      },
    ]);
    expect(await bring(report.artifactId, ada)).toEqual({ answer: 'undeleted' });
    expect([...(await as((trx) => readableComponents(trx, ada, [kept])))]).toEqual([kept]);
  });

  it('refuses a reference to a deleted component, and serialises one made as the delete runs', async () => {
    const { space, ada } = await fresh();
    const target = await component(space, ada, 'Raced procedure');
    const report = await document(space, ada, 'Racing report');
    const insert = () =>
      as((trx) =>
        editOutline(trx, {
          artifactId: report.artifactId,
          openedFrom: report.id,
          author: ada,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'reference', component: target, mode: { kind: 'latest' } },
          },
        }),
      );
    const [deleted, inserted] = await Promise.all([remove(target, ada), insert()]);
    // One or the other: never a reference recorded to what was deleted.
    if (deleted?.answer === 'deleted') {
      expect(inserted.answer).toBe('outline.invalid');
    } else {
      expect(inserted.answer).toBe('recorded');
      expect(deleted).toMatchObject({ answer: 'refused', refusals: [{ reason: 'referenced' }] });
    }
  });

  it('serialises a baseline made as the delete runs: one is refused', async () => {
    const { space, ada } = await fresh();
    const report = await document(space, ada, 'Contested report');
    const [deleted, made] = await Promise.all([
      remove(report.artifactId, ada),
      as((trx) =>
        makeBaseline(trx, {
          documentId: report.artifactId,
          version: report.id,
          name: 'Issue 1',
          maker: ada,
        }),
      ),
    ]);
    if (deleted?.answer === 'deleted') {
      expect(made.answer).toBe('document.missing');
    } else {
      expect(made.answer).toBe('made');
      expect(deleted).toMatchObject({ answer: 'refused', refusals: [{ reason: 'baselined' }] });
    }
  });

  it('LIF-057 records artifact.deleted and artifact.undeleted about it, and deleting the deleted changes nothing', async () => {
    const { space, ada } = await fresh();
    const audited = await component(space, ada, 'Audited procedure');
    expect(await remove(audited, ada)).toEqual({ answer: 'deleted' });
    expect(await remove(audited, ada)).toEqual({ answer: 'unchanged' });
    expect(await bring(audited, ada)).toEqual({ answer: 'undeleted' });
    const events = await as(async (trx) => {
      const { rows } = await sql<{ kind: string; subject_kind: string; space: string }>`
        select kind, subject_kind, space from audit_event where subject = ${audited}
          and kind like 'artifact.%' order by sequence`.execute(trx);
      return rows;
    });
    expect(events).toEqual([
      { kind: 'artifact.deleted', subject_kind: 'component', space },
      { kind: 'artifact.undeleted', subject_kind: 'component', space },
    ]);
  });

  it('refuses at the store an act equal to the one before it, any change, and anything but a component or a document', async () => {
    const { space, ada } = await fresh();
    const guarded = await component(space, ada, 'Guarded procedure');
    await remove(guarded, ada);
    await expect(
      as((trx) =>
        trx
          .insertInto('artifact_deletion')
          .values({ artifact_id: guarded, kind: 'component', act: 'deleted', by: ada })
          .execute(),
      ),
    ).rejects.toThrow(/artifact_deletion/);
    await expect(
      as((trx) => sql`update artifact_deletion set act = 'undeleted'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(as((trx) => sql`delete from artifact_deletion`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    expect(await remove(space, ada)).toBeUndefined();
    expect(await bring(randomUUID(), ada)).toBeUndefined();
  });

  it('two deletes at once record one act between them', async () => {
    const { space, ada } = await fresh();
    const raced = await component(space, ada, 'Twice procedure');
    const answers = await Promise.all([remove(raced, ada), remove(raced, ada)]);
    expect(answers.map((each) => each?.answer).sort()).toEqual(['deleted', 'unchanged']);
  });
});
