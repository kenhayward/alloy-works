import { randomUUID } from 'node:crypto';
import type { OutlineDocument, OutlineOperation } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument, editOutline, listReadableDocuments, readDocument } from './documents.js';
import { grant } from './grants.js';
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
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
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
      schemaVersion: 1,
      componentType: null,
      values: {},
      notCarried: [],
      definitions: [],
    });
    expect(answer.version.content).toEqual({
      schemaVersion: 1,
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
      trx.selectFrom('artifact').select('id').where('kind', '=', 'document').execute(),
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
      trx.selectFrom('artifact').select('id').where('kind', '=', 'document').execute(),
    );
    expect(after).toEqual(before);
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
      trx.selectFrom('artifact').select('id').where('kind', '=', 'document').execute(),
    );
    expect(documents).toEqual([]);
  });

  it('records each structural act as the next version, with a node identifier from real randomness', async () => {
    const first = await created();
    const second = await recorded(first, section('Introduction'));
    expect(second).toMatchObject({ artifactId: first.artifactId, revision: 0, version: 2 });
    const outline = second.content as OutlineDocument;
    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]).toMatchObject({ type: 'section', title: text('Introduction') });
    expect(outline.nodes[0]!.id).toMatch(/^[a-z2-7]{26}$/);

    const third = await recorded(second, section('Method', null, 1));
    const ids = (third.content as OutlineDocument).nodes.map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(outline.nodes[0]!.id);
    expect(ids[1]).not.toBe(ids[0]);
    expect((await chainOf(first.artifactId)).map((row) => row.version_no)).toEqual([1, 2, 3]);
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

  it('lets two acts from one version take turns: one is recorded, the other refused with the outline as it stands', async () => {
    const first = await created();
    const winnerPid = deferred<number>();
    const madeIt = latch();
    const commit = latch();

    const winner = service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
      winnerPid.resolve(rows[0]!.pid);
      const answer = await editOutline(trx, {
        artifactId: first.artifactId,
        openedFrom: first.id,
        author: ada,
        operation: section('Introduction'),
      });
      madeIt.open();
      await commit.opened;
      return answer;
    });
    const pid = await winnerPid.promise;
    await madeIt.opened;

    // The winner holds the artifact's advisory lock until it commits, so the second act must wait
    // behind that backend - there is nothing else for it to do, which is what makes this
    // deterministic rather than a sleep.
    const loser = edit(first, section('Method'), { author: grace });
    await untilBlockedBy(db.adminUrl, pid, 1);
    commit.open();

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

  it('refuses a stored outline that no longer reads with a fixed reason, never the parse failure', async () => {
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
          schema_version: 1,
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

    const answer = await service.withTenant(production, (trx) =>
      editOutline(trx, {
        artifactId: first.artifactId,
        openedFrom: broken.id,
        author: ada,
        operation: section('Method'),
      }),
    );
    expect(answer).toEqual({
      answer: 'outline.invalid',
      reason: 'The version this was opened from does not read as an outline',
    });
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
    expect(adas?.items.find((item) => item.id === inGeneral.artifactId)).toEqual({
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
});
