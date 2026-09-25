import { randomUUID } from 'node:crypto';
import {
  defaultNumberingScheme,
  OUTLINE_SCHEMA_VERSION,
  type OutlineDocument,
  type OutlineOperation,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import {
  createDocument,
  editOutline,
  listReadableDocuments,
  readableComponents,
  readDocument,
  type OutlineAnswer,
} from './documents.js';
import { grant } from './grants.js';
import { recordPublication, requestPublication } from './publishing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilBlockedBy,
  type TestDatabase,
} from './testing/database.js';
import { versionDigests } from './version-digest.js';
import { substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Like `latch`, but the opener carries a value out - here, a transaction's own backend pid. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];

const section = (title: string, parent: string | null = null, position = 0): OutlineOperation => ({
  operation: 'insert',
  parent,
  position,
  node: { type: 'section', title: text(title) },
});

describe('a document in the version chain, and its outline edited a version at a time', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;
  let elsewhere: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const generalOf = (trx: TenantTransaction) =>
    trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    // More than one connection, so two structural acts can be in flight at once.
    service = createTenantDatabase(db.serviceUrl, { max: 4 });

    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = await generalOf(trx);
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada may read General and Grace may read Quality, and neither the other.
      for (const [principal, space] of [
        [ada, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
    elsewhere = await service.withTenant(development, generalOf);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const create = (spaceId = general, title = 'The dosing report', tenant = production) =>
    service.withTenant(tenant, (trx) =>
      createDocument(trx, { spaceId, title, language: 'en-GB', direction: 'ltr', author: ada }),
    );

  const created = async (spaceId = general, title = 'The dosing report') => {
    const answer = await create(spaceId, title);
    if (answer.answer !== 'created') throw new Error(`Expected a document, got ${answer.answer}`);
    return answer.version;
  };

  const edit = (
    from: StoredVersion,
    operation: OutlineOperation,
    { author = ada, tenant = production }: { author?: string; tenant?: Tenant } = {},
  ) =>
    service.withTenant(tenant, (trx) =>
      editOutline(trx, { artifactId: from.artifactId, openedFrom: from.id, author, operation }),
    );

  const recorded = async (from: StoredVersion, operation: OutlineOperation) => {
    const answer = await edit(from, operation);
    if (answer.answer !== 'recorded') throw new Error(`Expected a version, got ${answer.answer}`);
    return answer.version;
  };

  const chainOf = (artifactId: string) =>
    service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'revision_no', 'version_no'])
        .where('artifact_id', '=', artifactId)
        .orderBy('version_no')
        .execute(),
    );

  it('creates a document at 0.1 in one space, its outline holding no nodes', async () => {
    const answer = await create();
    if (answer.answer !== 'created') throw new Error(`Expected a document, got ${answer.answer}`);
    expect(answer.version).toMatchObject({
      kind: 'document',
      revision: 0,
      version: 1,
      author: ada,
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      componentType: null,
      values: {},
      notCarried: [],
      definitions: [],
    });
    expect(answer.version.content).toEqual({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [],
    });
    const artifact = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select(['kind', 'space_id'])
        .where('id', '=', answer.version.artifactId)
        .executeTakeFirstOrThrow(),
    );
    expect(artifact).toEqual({ kind: 'document', space_id: general });
  });

  it('trims the title, and refuses one that is blank, a language that is not a tag, and a direction that is neither', async () => {
    const trimmed = await created(general, '  The dosing report  ');
    expect((trimmed.content as OutlineDocument).title).toBe('The dosing report');

    const before = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'document')
        .orderBy('id')
        .execute(),
    );
    const refused = (input: { title?: string; language?: string; direction?: string }) =>
      service.withTenant(production, (trx) =>
        createDocument(trx, {
          spaceId: general,
          title: 'The dosing report',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
          ...input,
        } as Parameters<typeof createDocument>[1]),
      );
    await expect(refused({ title: '   ' })).resolves.toEqual({ answer: 'content.invalid' });
    await expect(refused({ language: 'english' })).resolves.toEqual({ answer: 'content.invalid' });
    await expect(refused({ direction: 'up' })).resolves.toEqual({ answer: 'content.invalid' });
    const after = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'document')
        .orderBy('id')
        .execute(),
    );
    expect(after).toEqual(before);
  });

  it('refuses a title Postgres cannot store as the caller mistake, never as a failed insert', async () => {
    const NUL = String.fromCharCode(0);
    const HALF = String.fromCharCode(0xd800);
    for (const title of [`The ${NUL}dosing report`, `The dosing report ${HALF}`]) {
      await expect(create(general, title)).resolves.toEqual({ answer: 'content.invalid' });
    }
    const first = await created();
    for (const title of [`Me${NUL}thod`, `Method ${HALF}`]) {
      await expect(edit(first, section(title))).resolves.toEqual({
        answer: 'outline.invalid',
        reason: 'This operation would produce an outline that cannot be stored',
      });
    }
    expect(await chainOf(first.artifactId)).toHaveLength(1);
  });

  it('answers space.missing for a space this environment does not hold, and writes nothing', async () => {
    for (const spaceId of [randomUUID(), 'General', elsewhere]) {
      await expect(create(spaceId)).resolves.toEqual({ answer: 'space.missing' });
    }
    // And the other way about: production's General is not development's.
    await expect(create(general, 'The dosing report', development)).resolves.toEqual({
      answer: 'space.missing',
    });
    const documents = await service.withTenant(development, (trx) =>
      trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'document')
        .orderBy('id')
        .execute(),
    );
    expect(documents).toEqual([]);
  });

  it('STR-003 STR-067 records each structural act as the next version, with a node identifier from real randomness', async () => {
    const first = await created();
    const second = await recorded(first, section('Introduction'));
    expect(second).toMatchObject({ artifactId: first.artifactId, revision: 0, version: 2 });
    const outline = second.content as OutlineDocument;
    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]).toMatchObject({ type: 'section', title: text('Introduction') });
    // Allocated on creation: 128 bits from node:crypto, in the spelling a block identifier has.
    expect(outline.nodes[0]!.id).toMatch(/^[a-z2-7]{26}$/);

    // Stable: the next version carries it unchanged, and the new node has one of its own.
    const third = await recorded(second, section('Method', null, 1));
    const ids = (third.content as OutlineDocument).nodes.map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(outline.nodes[0]!.id);
    expect(ids[1]).not.toBe(ids[0]);

    // Never reused: a node inserted after one is removed is given a new identifier, not the old one.
    const fourth = await recorded(third, { operation: 'remove', node: ids[0]! });
    const fifth = await recorded(fourth, section('Results'));
    const after = (fifth.content as OutlineDocument).nodes.map((node) => node.id);
    expect(after).toHaveLength(2);
    expect(after).not.toContain(ids[0]);
    expect(new Set([...ids, ...after]).size).toBe(3);
    expect((await chainOf(first.artifactId)).map((row) => row.version_no)).toEqual([1, 2, 3, 4, 5]);
  });

  it('writes digests anybody can recompute from the stored row', async () => {
    const first = await created();
    const second = await recorded(first, section('Introduction'));
    for (const stored of [first, second]) {
      const row = await service.withTenant(production, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select(['content_hash', 'version_digest'])
          .where('id', '=', stored.id)
          .executeTakeFirstOrThrow(),
      );
      const recomputed = versionDigests(substanceOf(stored));
      expect(recomputed).toEqual({
        contentHash: row.content_hash,
        versionDigest: row.version_digest,
      });
    }
  });

  it('gives two outlines differing only in the order their marks were built one version digest', async () => {
    const first = await created();
    const second = await recorded(first, section('Results'));
    const node = (second.content as OutlineDocument).nodes[0]!.id;
    const marked = (marks: { type: 'strong' | 'emphasis'; id: string }[]): OutlineOperation => ({
      operation: 'retitle',
      node,
      title: [{ type: 'text', value: 'Results', marks }],
    });
    const strong = { type: 'strong' as const, id: 'm1' };
    const emphasis = { type: 'emphasis' as const, id: 'm2' };

    const third = await recorded(second, marked([strong, emphasis]));
    const again = await edit(third, marked([emphasis, strong]));

    expect(again).toEqual({ answer: 'version.unchanged', current: third });
    expect(await chainOf(first.artifactId)).toHaveLength(3);
  });

  it('records a section title of runs merged, so its split and whole spellings are one version', async () => {
    const first = await created();
    const second = await recorded(first, section('Results'));
    const node = (second.content as OutlineDocument).nodes[0]!.id;
    const emphasis = [{ type: 'emphasis' as const, id: 'm1' }];
    const retitle = (title: { type: 'text'; value: string; marks: typeof emphasis }[]) =>
      ({ operation: 'retitle', node, title }) as OutlineOperation;

    const third = await recorded(
      second,
      retitle([
        { type: 'text', value: 'Results ', marks: emphasis },
        { type: 'text', value: 'in full', marks: emphasis },
      ]),
    );
    expect((third.content as OutlineDocument).nodes[0]).toMatchObject({
      title: [{ type: 'text', value: 'Results in full', marks: emphasis }],
    });
    const again = await edit(
      third,
      retitle([{ type: 'text', value: 'Results in full', marks: emphasis }]),
    );
    expect(again).toEqual({ answer: 'version.unchanged', current: third });
    expect(await chainOf(first.artifactId)).toHaveLength(3);
  });

  it('lets two acts from one version take turns: one is recorded, the other refused with the outline as it stands', async () => {
    const first = await created();
    const holding = deferred<number>();
    const commit = latch();

    const winner = service.withTenant(production, async (trx) => {
      let answer: OutlineAnswer;
      try {
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
        answer = await editOutline(trx, {
          artifactId: first.artifactId,
          openedFrom: first.id,
          author: ada,
          operation: section('Introduction'),
        });
        holding.resolve(rows[0]!.pid);
      } catch (error) {
        // Reported through `holding`, so the test fails on the winner's own error at once.
        holding.reject(error);
        throw error;
      }
      await commit.opened;
      return answer;
    });
    // Its failure, if it has one, is already reported through `holding`.
    winner.catch(() => undefined);
    const pid = await holding.promise;

    // The winner holds the artifact's advisory lock until it commits, so the second act must wait
    // behind that backend - there is nothing else for it to do, which is what makes this
    // deterministic rather than a sleep. The latch opens in `finally`, so a wait that fails reports
    // its own error and the winner still commits and gives its connection back, rather than the test
    // hanging until it times out.
    let loser: Promise<OutlineAnswer>;
    try {
      loser = edit(first, section('Method'), { author: grace });
      await untilBlockedBy(db.adminUrl, pid, 1);
    } finally {
      commit.open();
    }

    const [won, lost] = await Promise.all([winner, loser]);
    if (won.answer !== 'recorded') throw new Error(`Expected a version, got ${won.answer}`);
    expect(lost).toEqual({ answer: 'version.precondition', current: won.version });
    expect((won.version.content as OutlineDocument).nodes).toMatchObject([
      { type: 'section', title: text('Introduction') },
    ]);
    // Exactly the versions that won: nothing was overwritten, and nothing was rebased.
    expect((await chainOf(first.artifactId)).map((row) => row.id)).toEqual([
      first.id,
      won.version.id,
    ]);
  });

  it('cannot lock a document: the lock table holds a component alone', async () => {
    const first = await created();
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into component_lock (artifact_id, kind, principal_id, session_id, expires_at)
            values (${first.artifactId}, 'document', ${ada}, ${randomUUID()}, now() + interval '1 hour')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/component_lock_kind_check/);
  });

  it('answers version.unchanged for an act that changes nothing, and the chain does not grow', async () => {
    const first = await created();
    const second = await recorded(first, section('Introduction'));
    const node = (second.content as OutlineDocument).nodes[0]!.id;

    // Put back where it already is.
    const answer = await edit(second, { operation: 'move', node, parent: null, position: 0 });

    expect(answer).toEqual({ answer: 'version.unchanged', current: second });
    expect(await chainOf(first.artifactId)).toHaveLength(2);
  });

  it('refuses an act the outline cannot take, with its reason, and records nothing', async () => {
    const first = await created();
    const answer = await edit(first, { operation: 'remove', node: 'abcdefghijklmnopqrstuvwxyz' });
    expect(answer).toEqual({
      answer: 'outline.invalid',
      reason: 'The node is not in this outline',
    });
    expect(await chainOf(first.artifactId)).toHaveLength(1);
  });

  it('answers artifact.missing when the version opened from is not this document, or not a document', async () => {
    const first = await created();
    const other = await created(general, 'Another report');
    const component = await service.withTenant(production, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (component.answer !== 'created') throw new Error(`Expected a component`);

    const opened = (artifactId: string, openedFrom: string) =>
      service.withTenant(production, (trx) =>
        editOutline(trx, { artifactId, openedFrom, author: ada, operation: section('Method') }),
      );
    await expect(opened(first.artifactId, other.id)).resolves.toEqual({
      answer: 'artifact.missing',
    });
    await expect(opened(component.version.artifactId, component.version.id)).resolves.toEqual({
      answer: 'artifact.missing',
    });
    await expect(opened(first.artifactId, randomUUID())).resolves.toEqual({
      answer: 'artifact.missing',
    });
    await expect(opened(first.artifactId, 'not-a-version')).resolves.toEqual({
      answer: 'artifact.missing',
    });
    expect(await chainOf(first.artifactId)).toHaveLength(1);
  });

  it('references only a component the author may read, pinned only to a version of that component', async () => {
    const component = (spaceId: string, author: string, tenant = production) =>
      service.withTenant(tenant, async (trx) => {
        const made = await createComponent(trx, {
          spaceId,
          title: 'Install the printer',
          language: 'en-GB',
          direction: 'ltr',
          author,
        });
        if (made.answer !== 'created') throw new Error('Expected a component');
        return made.version;
      });
    const readable = await component(general, ada);
    const unreadable = await component(quality, grace);
    const ivy = await service.withTenant(development, (trx) =>
      person(trx, `ivy-${randomUUID()}`, 'Ivy'),
    );
    const otherEnvironment = await component(elsewhere, ivy, development);
    const definition = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'componentType')
        .executeTakeFirstOrThrow(),
    );
    const first = await created();
    const second = await created(general, 'Another report');

    const reference = (component: string, mode: Record<string, unknown> = { kind: 'latest' }) =>
      ({
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component, mode },
      }) as OutlineOperation;
    const refused = {
      answer: 'outline.invalid',
      reason: 'The component is not one this outline can reference',
    };
    for (const target of [
      '00000000-0000-0000-0000-000000000000',
      otherEnvironment.artifactId,
      definition.id,
      first.artifactId,
      second.artifactId,
      unreadable.artifactId,
    ]) {
      await expect(edit(first, reference(target))).resolves.toEqual(refused);
    }
    // Pinned to a version of some other artifact - another component's, a document's - or to none.
    for (const version of [unreadable.id, second.id, first.id, randomUUID()]) {
      await expect(
        edit(first, reference(readable.artifactId, { kind: 'pinned', version })),
      ).resolves.toEqual(refused);
    }
    expect(await chainOf(first.artifactId)).toHaveLength(1);

    // A component the author may read is referenced, and pinned to one of its own versions.
    const added = await recorded(first, reference(readable.artifactId));
    const node = (added.content as OutlineDocument).nodes[0]!.id;
    for (const version of [unreadable.id, second.id]) {
      await expect(
        edit(added, { operation: 'set', node, mode: { kind: 'pinned', version } }),
      ).resolves.toEqual(refused);
    }
    const pinned = await recorded(added, {
      operation: 'set',
      node,
      mode: { kind: 'pinned', version: readable.id },
    });
    expect((pinned.content as OutlineDocument).nodes[0]).toMatchObject({
      component: readable.artifactId,
      mode: { kind: 'pinned', version: readable.id },
    });
    await expect(
      recorded(first, reference(readable.artifactId, { kind: 'pinned', version: readable.id })),
    ).rejects.toThrow(/version.precondition/);
  });

  it('names which of the components given a principal may read, and nothing else', async () => {
    const component = (spaceId: string, author: string, tenant = production) =>
      service.withTenant(tenant, async (trx) => {
        const made = await createComponent(trx, {
          spaceId,
          title: 'Install the printer',
          language: 'en-GB',
          direction: 'ltr',
          author,
        });
        if (made.answer !== 'created') throw new Error('Expected a component');
        return made.version.artifactId;
      });
    const inGeneral = await component(general, ada);
    const inQuality = await component(quality, grace);
    const ivy = await service.withTenant(development, (trx) =>
      person(trx, `ivy-${randomUUID()}`, 'Ivy'),
    );
    const otherEnvironment = await component(elsewhere, ivy, development);
    const document = (await created()).artifactId;
    const asked = [inGeneral, inQuality, otherEnvironment, document, randomUUID()];

    const readableBy = (principal: string) =>
      service.withTenant(production, (trx) => readableComponents(trx, principal, asked));
    expect([...(await readableBy(ada))]).toEqual([inGeneral]);
    expect([...(await readableBy(grace))]).toEqual([inQuality]);
    expect([...(await readableBy(randomUUID()))]).toEqual([]);
    await expect(
      service.withTenant(production, (trx) => readableComponents(trx, ada, [])),
    ).resolves.toEqual(new Set());
  });

  it("throws on a stored outline that no longer reads: a broken store, not the caller's mistake", async () => {
    const first = await created();
    // A version the store would never write, put there by hand: a title the schema refuses.
    const broken = await service.withTenant(production, (trx) =>
      trx
        .insertInto('artifact_version')
        .values({
          artifact_id: first.artifactId,
          kind: 'document',
          revision_no: 0,
          version_no: 2,
          author_id: ada,
          note: null,
          schema_version: OUTLINE_SCHEMA_VERSION,
          content: JSON.stringify({ ...(first.content as object), title: '' }),
          content_hash: 'a'.repeat(64),
          metadata_values: '{}',
          not_carried: '[]',
          component_type_version_id: null,
          version_digest: 'b'.repeat(64),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

    // Thrown, as `currentDefinition` throws on a definition that does not read, so the service logs
    // it and answers a 500: the failure names the version, and never becomes a refusal's reason.
    await expect(
      service.withTenant(production, (trx) =>
        editOutline(trx, {
          artifactId: first.artifactId,
          openedFrom: broken.id,
          author: ada,
          operation: section('Method'),
        }),
      ),
    ).rejects.toThrow(`The document ${first.artifactId} at ${broken.id} does not read: `);
    expect(await chainOf(first.artifactId)).toHaveLength(2);
  });

  it("cannot edit another environment's document, and leaves that document alone", async () => {
    const theirs = await created();
    const answer = await edit(theirs, section('Introduction'), { tenant: development });
    expect(answer).toEqual({ answer: 'artifact.missing' });
    expect(await chainOf(theirs.artifactId)).toEqual([
      { id: theirs.id, revision_no: 0, version_no: 1 },
    ]);
  });

  it('reads a document at its latest version with its space, and nothing that is not one', async () => {
    const first = await created();
    const second = await recorded(first, section('Introduction'));

    await expect(
      service.withTenant(production, (trx) => readDocument(trx, first.artifactId)),
    ).resolves.toEqual({
      id: first.artifactId,
      space: { id: general, name: 'General' },
      version: second,
    });
    // Another environment's document, a component, and an id that is not one.
    await expect(
      service.withTenant(development, (trx) => readDocument(trx, first.artifactId)),
    ).resolves.toBeUndefined();
    const component = await service.withTenant(production, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (component.answer !== 'created') throw new Error(`Expected a component`);
    for (const id of [component.version.artifactId, randomUUID(), 'The dosing report']) {
      await expect(
        service.withTenant(production, (trx) => readDocument(trx, id)),
      ).resolves.toBeUndefined();
    }
  });

  it('lists only the documents a principal may read, with the title and number at the latest version', async () => {
    const inGeneral = await created(general, 'The dosing report');
    const retitled = await service.withTenant(production, (trx) =>
      editOutline(trx, {
        artifactId: inGeneral.artifactId,
        openedFrom: inGeneral.id,
        author: ada,
        operation: section('Introduction'),
      }),
    );
    if (retitled.answer !== 'recorded') throw new Error(`Expected a version`);
    const inQuality = await created(quality, 'The audit report');
    // Ivy may read development's General, which holds none of these.
    const ivy = await service.withTenant(development, async (trx) => {
      const id = await person(trx, 'ivy', 'Ivy');
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: id },
        level: { kind: 'space', id: elsewhere },
        effect: 'allow',
        grantedBy: id,
      });
      return id;
    });

    const listed = (principal: string, tenant = production) =>
      service.withTenant(tenant, (trx) => listReadableDocuments(trx, principal));

    const adas = await listed(ada);
    expect(adas?.items.map((item) => item.id)).toContain(inGeneral.artifactId);
    expect(adas?.items.map((item) => item.id)).not.toContain(inQuality.artifactId);
    expect(adas?.items.find((item) => item.id === inGeneral.artifactId)).toMatchObject({
      id: inGeneral.artifactId,
      title: 'The dosing report',
      space: { id: general, name: 'General' },
      revision: 0,
      version: 2,
    });
    // No component, though Ada may read the ones in General.
    const kinds = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select('kind')
        .where(
          'id',
          'in',
          adas!.items.map((item) => item.id),
        )
        .execute(),
    );
    expect(new Set(kinds.map((row) => row.kind))).toEqual(new Set(['document']));

    const graces = await listed(grace);
    expect(graces?.items.map((item) => item.id)).toEqual([inQuality.artifactId]);

    // Ada is not a principal of development's, and development's own list holds none of these.
    await expect(listed(ada, development)).resolves.toBeUndefined();
    await expect(listed(ivy, development)).resolves.toEqual({ items: [] });
  });
  it('says of each document when it changed and how many sections and component references its outline holds', async () => {
    const first = await created(general, 'The counted report');
    const component = await service.withTenant(production, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (component.answer !== 'created') throw new Error('Expected a component');
    const withMethod = await recorded(first, section('Method'));
    const withResults = await recorded(withMethod, section('Results', null, 1));
    const method = (withResults.content as { nodes: { id: string }[] }).nodes[0]!.id;
    // A reference nested inside a section, so the count reaches below the top level.
    const nested = await recorded(withResults, {
      operation: 'insert',
      parent: method,
      position: 0,
      node: {
        type: 'reference',
        component: component.version.artifactId,
        mode: { kind: 'latest' },
      },
    } as OutlineOperation);

    const listed = await service.withTenant(production, (trx) => listReadableDocuments(trx, ada));
    const counted = listed?.items.find((item) => item.id === first.artifactId);
    expect(counted).toMatchObject({ sections: 2, components: 1 });
    expect(counted?.changedAt.getTime()).toBe(nested.createdAt.getTime());
  });

  it("says whether the reader's latest publication of a document is of its latest version, an earlier one, or none", async () => {
    const never = await created(general, 'The unpublished report');
    const current = await created(general, 'The current report');
    const behind = await created(general, 'The report changed since');
    await service.withTenant(production, async (trx) => {
      for (const version of [current, behind]) {
        const asked = await requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats: ['pdf'],
          requester: ada,
        });
        if (asked.answer !== 'requested') throw new Error(asked.answer);
        const made = await recordPublication(trx, {
          requestId: asked.request.id,
          pipelineVersion: '5',
          fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
          dataSha256: 'b'.repeat(64),
          numbering: { scheme: defaultNumberingScheme.id, entries: [] },
          outputs: [
            {
              format: 'pdf' as const,
              engineVersion: '0.15.1',
              templateVersion: 5,
              key: `${production.role}/sha256/${'c'.repeat(64)}`,
              sha256: 'c'.repeat(64),
              bytes: 1000,
            },
          ],
        });
        if (!made) throw new Error('Expected a publication');
      }
    });
    await recorded(behind, section('Added after it was published'));

    const listed = await service.withTenant(production, (trx) => listReadableDocuments(trx, ada));
    const stateOf = (id: string) => listed?.items.find((item) => item.id === id)?.publishing;
    expect(stateOf(never.artifactId)).toBe('neverPublished');
    expect(stateOf(current.artifactId)).toBe('published');
    expect(stateOf(behind.artifactId)).toBe('changedSince');
  });

  it('leaves out a document a grant on it refuses, and lists one a grant on it allows outside every granted space', async () => {
    const denied = await created(general, 'The withdrawn report');
    const allowed = await created(general, 'The shared report');
    await service.withTenant(production, async (trx) => {
      const reader = await findRole(trx, 'Reader');
      for (const [principal, id, effect] of [
        [ada, denied.artifactId, 'deny'],
        [grace, allowed.artifactId, 'allow'],
      ] as const) {
        const answer = await grant(trx, {
          roleId: reader!.id,
          subject: { principal },
          level: { kind: 'artifact', id },
          effect,
          grantedBy: ada,
        });
        if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
      }
    });
    const listed = async (principal: string) =>
      (
        await service.withTenant(production, (trx) => listReadableDocuments(trx, principal))
      )?.items.map((item) => item.id);

    // Ada reads General, but not the one document in it she is denied.
    expect(await listed(ada)).toContain(allowed.artifactId);
    expect(await listed(ada)).not.toContain(denied.artifactId);
    // Grace reads Quality alone, and the one document in General she is allowed - nothing else there.
    expect(await listed(grace)).toContain(allowed.artifactId);
    expect(await listed(grace)).not.toContain(denied.artifactId);
    const others = (await listed(grace))!.filter((id) => id !== allowed.artifactId);
    const spaces = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select('space_id')
        .distinct()
        .where('id', 'in', [...others, allowed.artifactId])
        .where('id', '!=', allowed.artifactId)
        .execute(),
    );
    expect(spaces.map((row) => row.space_id)).toEqual(others.length > 0 ? [quality] : []);
  });
});
