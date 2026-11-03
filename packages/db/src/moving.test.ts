import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { archiveArtifact } from './archival.js';
import {
  createAssetUpload,
  receiveAssetBytes,
  recordAsset,
  uploadForDatasetImage,
} from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument, editOutline } from './documents.js';
import { claimLock, readLock } from './editing.js';
import { grant } from './grants.js';
import { placeHold } from './holds.js';
import { setKeep } from './keeps.js';
import { migrate } from './migrate.js';
import { MOVE_MOST, moveToSpace, previewMove, type MoveInput } from './moving.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { sharePublication } from './shares.js';
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
import { decide, type ContentDocument, type ImageHeader, type Level } from '@alloy-works/domain';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const HEADER: ImageHeader = {
  format: 'png',
  width: 10,
  height: 10,
  orientation: 1,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
  end: 3530,
};

describe('moving content between spaces', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let closed = '';
  let open = '';
  let authorRole = '';
  let readerRole = '';

  const work = <T>(fn: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, fn, { actorKind: 'person', actor: ada });

  const component = (title = 'Install the printer', space = open) =>
    work(async (trx) => {
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

  const blank = (space = open) =>
    work(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const placing = async (...parts: readonly StoredVersion[]) => {
    let opened = await blank();
    for (const each of parts) {
      opened = await work(async (trx) => {
        const answer = await editOutline(trx, {
          artifactId: opened.artifactId,
          openedFrom: opened.id,
          author: ada,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'reference', component: each.artifactId, mode: { kind: 'latest' } },
          } as never,
        });
        if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
        return answer.version;
      });
    }
    return opened;
  };

  const image = (space = open) =>
    work(async (trx) => {
      const fill = randomUUID().replace(/-/g, '').padEnd(64, '0');
      const upload = await createAssetUpload(trx, {
        spaceId: space,
        uploader: ada,
        alternative: null,
        name: 'owl.png',
      });
      await receiveAssetBytes(trx, upload.id, {
        key: `${tenant.role}/sha256/${fill}`,
        format: 'png',
        bytes: 3530,
      });
      return recordAsset(trx, upload.id, HEADER);
    });

  /** A component at a second version whose one figure places this image. */
  const figured = (asset: { readonly artifactId: string; readonly id: string }) =>
    component('Figured').then((made) =>
      work(async (trx) => {
        const substance = substanceOf(made) as Extract<
          ReturnType<typeof substanceOf>,
          { kind: 'component' }
        >;
        const blocks = [
          {
            type: 'figure',
            id: 'f1',
            asset: asset.id,
            imageStyle: 'figure',
            caption: [{ type: 'text', value: 'An owl', marks: [] }],
            alternative: { kind: 'own', text: 'An owl' },
          },
        ] as ContentDocument['content'];
        const recorded = await recordVersion(trx, {
          artifactId: made.artifactId,
          openedFrom: made.id,
          author: ada,
          substance: { ...substance, content: { ...substance.content, content: blocks } },
        });
        if (recorded.answer !== 'recorded') throw new Error(JSON.stringify(recorded));
        return recorded.version;
      }),
    );

  const inputOf = (id: string, over: Partial<MoveInput> = {}): MoveInput => ({
    artifactId: id,
    from: open,
    to: closed,
    by: ada,
    scopes: undefined,
    also: false,
    ...over,
  });

  const move = (id: string, over: Partial<MoveInput> = {}) =>
    work((trx) => moveToSpace(trx, inputOf(id, over)));

  const spaceOf = (id: string) =>
    work(async (trx) => {
      const row = await trx
        .selectFrom('artifact')
        .select('space_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return row.space_id;
    });

  const allows = (who: string, permission: 'read', level: Level) =>
    work(async (trx) => {
      const facts = await loadFacts(trx, who, level);
      return facts !== undefined && decide(permission, facts).allowed;
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
      const person = async (subject: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: 'https://idp.example', subject, email: `${subject}@example.com` })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada');
      grace = await person('grace');
      open = (await trx.selectFrom('space').select('id').executeTakeFirstOrThrow()).id;
      closed = (await createSpace(trx, 'Closed')).id;
      authorRole = (await findRole(trx, 'Author'))!.id;
      readerRole = (await findRole(trx, 'Reader'))!.id;
      for (const space of [open, closed]) {
        await grant(trx, {
          subject: { principal: ada },
          roleId: authorRole,
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        subject: { principal: ada },
        roleId: administrator!.id,
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      await grant(trx, {
        subject: { principal: grace },
        roleId: readerRole,
        level: { kind: 'space', id: open },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('IAM-015 moves a component to another space, its versions and pins untouched and no version cut', async () => {
    const made = await component();
    const versions = () =>
      work((trx) =>
        trx
          .selectFrom('artifact_version')
          .select('id')
          .where('artifact_id', '=', made.artifactId)
          .execute(),
      );
    const before = await versions();
    expect(await move(made.artifactId)).toMatchObject({
      answer: 'changed',
      moved: [made.artifactId],
      grantsEnded: 0,
    });
    expect(await spaceOf(made.artifactId)).toBe(closed);
    expect(await versions()).toEqual(before);
  });

  it('IAM-015 a direct allow on the artifact ends with the move and does not open it in the closed space', async () => {
    const made = await component();
    await work((trx) =>
      grant(trx, {
        subject: { principal: grace },
        roleId: readerRole,
        level: { kind: 'artifact', id: made.artifactId },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
    const level: Level = { kind: 'artifact', id: made.artifactId };
    expect(await allows(grace, 'read', level)).toBe(true);
    expect(await move(made.artifactId)).toMatchObject({ grantsEnded: 1 });
    expect(await allows(grace, 'read', level)).toBe(false);
  });

  it('IAM-028 a person readable through the old space alone is refused at once, and one through the new space allowed', async () => {
    const made = await component();
    const level: Level = { kind: 'artifact', id: made.artifactId };
    const ivy = await work(async (trx) => {
      const { id } = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: randomUUID(), email: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await grant(trx, {
        subject: { principal: id },
        roleId: readerRole,
        level: { kind: 'space', id: closed },
        effect: 'allow',
        grantedBy: ada,
      });
      return id;
    });
    expect(await allows(grace, 'read', level)).toBe(true);
    expect(await allows(ivy, 'read', level)).toBe(false);
    await move(made.artifactId);
    expect(await allows(grace, 'read', level)).toBe(false);
    expect(await allows(ivy, 'read', level)).toBe(true);
  });

  it('IAM-028 a direct deny on the artifact ends with the move and the new space decides', async () => {
    const made = await component();
    const level: Level = { kind: 'artifact', id: made.artifactId };
    const nell = await work(async (trx) => {
      const { id } = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: randomUUID(), email: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const space of [open, closed]) {
        await grant(trx, {
          subject: { principal: id },
          roleId: readerRole,
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      await grant(trx, {
        subject: { principal: id },
        roleId: readerRole,
        level,
        effect: 'deny',
        grantedBy: ada,
      });
      return id;
    });
    expect(await allows(nell, 'read', level)).toBe(false);
    expect(await move(made.artifactId)).toMatchObject({ grantsEnded: 1 });
    expect(await allows(nell, 'read', level)).toBe(true);
  });

  it('refuses a caller who read another space, says nothing changed where it is there already, and of the archived', async () => {
    const made = await component();
    expect(await move(made.artifactId, { from: closed, to: open })).toEqual({
      answer: 'space.moved',
    });
    expect(await move(made.artifactId, { to: open })).toEqual({ answer: 'unchanged' });
    await work((trx) => archiveArtifact(trx, made.artifactId, ada));
    expect(await move(made.artifactId)).toEqual({ answer: 'artifact.archived' });
    expect(await move(randomUUID())).toEqual({ answer: 'artifact.missing' });
    expect(await move('not-an-id')).toEqual({ answer: 'artifact.missing' });
  });

  it('two moves at once leave one, and one pair of events', async () => {
    const made = await component();
    const answers = await Promise.all([move(made.artifactId), move(made.artifactId)]);
    expect(answers.map((each) => each.answer).sort()).toEqual(['changed', 'space.moved']);
    const events = await work((trx) =>
      trx
        .selectFrom('audit_event')
        .select('space')
        .where('kind', '=', 'artifact.moved')
        .where('subject', '=', made.artifactId)
        .execute(),
    );
    expect(events.map((each) => each.space).sort()).toEqual([open, closed].sort());
  });

  it('a hold on the source space refuses; a hold on the artifact travels; a tenant-wide keep refuses nothing', async () => {
    const own = await component();
    await work((trx) =>
      placeHold(trx, { target: { artifact: own.artifactId }, reason: 'A dispute', by: ada }),
    );
    expect(await move(own.artifactId)).toMatchObject({ answer: 'changed' });

    const kept = await component();
    await work((trx) => setKeep(trx, { kind: 'component', space: null, days: 3650, by: ada }));
    expect(await move(kept.artifactId)).toMatchObject({ answer: 'changed' });
    await work((trx) => setKeep(trx, { kind: 'component', space: null, days: null, by: ada }));

    const leaving = await component();
    await work((trx) => setKeep(trx, { kind: null, space: open, days: 3650, by: ada }));
    expect(await move(leaving.artifactId)).toMatchObject({ answer: 'kept' });
    await work((trx) => setKeep(trx, { kind: null, space: closed, days: 3650, by: ada }));
    expect(await move(leaving.artifactId)).toMatchObject({ answer: 'changed' });
    await work(async (trx) => {
      await setKeep(trx, { kind: null, space: open, days: null, by: ada });
      await setKeep(trx, { kind: null, space: closed, days: null, by: ada });
    });

    const refused = await component('Held', (await work((trx) => createSpace(trx, 'Held'))).id);
    const heldSpace = (await spaceOf(refused.artifactId))!;
    await work((trx) => placeHold(trx, { target: { space: heldSpace }, reason: 'Audit', by: ada }));
    expect(await move(refused.artifactId, { from: heldSpace })).toEqual({ answer: 'held' });
    expect(await spaceOf(refused.artifactId)).toBe(heldSpace);
  });

  it('search filtered by either space finds it only in the new one, and an earlier version too', async () => {
    const word = `zebrafinch${randomUUID().slice(0, 4)}`;
    const made = await component(word);
    const later = await work(async (trx) => {
      const substance = substanceOf(made) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const answer = await recordVersion(trx, {
        artifactId: made.artifactId,
        openedFrom: made.id,
        author: ada,
        substance: { ...substance, content: { ...substance.content, title: `${word} two` } },
      });
      if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
      return answer.version;
    });
    expect(later.artifactId).toBe(made.artifactId);
    await move(made.artifactId);
    const inSpace = (space: string, scope: 'latest' | 'all') =>
      work(async (trx) => {
        const found = await searchWords(trx, ada, word, { scope, filters: { spaces: [space] } });
        return found !== undefined && 'items' in found ? found.items.length : 0;
      });
    expect(await inSpace(open, 'latest')).toBe(0);
    expect(await inSpace(closed, 'latest')).toBeGreaterThan(0);
    expect(await inSpace(open, 'all')).toBe(0);
    expect(await inSpace(closed, 'all')).toBeGreaterThan(0);
    const rows = await work(async (trx) => {
      const { rows } = await sql<{ space_id: string }>`
        select space_id from search_earlier where artifact_id = ${made.artifactId}
        union all select space_id from search_history where artifact_id = ${made.artifactId}
        union all select space_id from search_entry where artifact_id = ${made.artifactId}`.execute(
        trx,
      );
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.space_id))).toEqual(new Set([closed]));
  });

  it('the audit log filtered by each space shows the move and each ended grant', async () => {
    const made = await component();
    await work((trx) =>
      grant(trx, {
        subject: { principal: grace },
        roleId: readerRole,
        level: { kind: 'artifact', id: made.artifactId },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
    await move(made.artifactId);
    const events = await work((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'space', 'detail'])
        .where('sequence', '>', '0')
        .where((where) =>
          where.or([
            where('subject', '=', made.artifactId),
            where(sql<string>`detail ->> 'level'`, '=', `artifact:${made.artifactId}`),
          ]),
        )
        .execute(),
    );
    const moved = events.filter((each) => each.kind === 'artifact.moved');
    expect(moved.map((each) => each.space).sort()).toEqual([open, closed].sort());
    expect(moved[0]!.detail).toEqual({ from: open, to: closed });
    const ended = events.filter((each) => each.kind === 'access.revoked');
    expect(ended.map((each) => each.space)).toEqual([open]);
  });

  it("COL-069 a held lock and presence are gone after a move, and the holder claims again", async () => {
    const made = await component();
    const document = await placing(made);
    const session = randomUUID();
    await work((trx) =>
      claimLock(trx, { artifactId: made.artifactId, principal: ada, session } as never),
    );
    await work((trx) =>
      trx
        .insertInto('presence')
        .values({
          viewer: randomUUID(),
          principal_id: ada,
          document_id: document.artifactId,
          component_id: made.artifactId,
          mode: 'author',
        } as never)
        .execute(),
    );
    await move(made.artifactId);
    expect(await work((trx) => readLock(trx, made.artifactId))).toBeUndefined();
    const presence = await work((trx) =>
      trx
        .selectFrom('presence')
        .select('viewer')
        .where('component_id', '=', made.artifactId)
        .execute(),
    );
    expect(presence).toEqual([]);
    const claimed = await work((trx) =>
      claimLock(trx, { artifactId: made.artifactId, principal: ada, session } as never),
    );
    expect(claimed).toMatchObject({ answer: 'claimed' });
  });

  it("a document's publications follow it, and a share survives and is counted apart", async () => {
    const opened = await blank();
    const publication = await work((trx) =>
      publish(trx, {
        document: { artifactId: opened.artifactId, id: opened.id },
        author: ada,
        role: tenant.role,
      }),
    );
    await work(async (trx) => {
      const shared = await sharePublication(trx, {
        publication,
        email: 'grace.outside@example.com',
        sharedBy: ada,
      });
      if (shared.answer !== 'shared') throw new Error(shared.answer);
      await grant(trx, {
        subject: { principal: grace },
        roleId: readerRole,
        level: { kind: 'artifact', id: publication },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    expect(await move(opened.artifactId)).toMatchObject({
      answer: 'changed',
      moved: [opened.artifactId, publication],
      grantsEnded: 1,
      sharesKept: 1,
    });
    expect(await spaceOf(publication)).toBe(closed);
  });

  it('a publication held on its own refuses its document', async () => {
    const opened = await blank();
    const publication = await work((trx) =>
      publish(trx, {
        document: { artifactId: opened.artifactId, id: opened.id },
        author: ada,
        role: tenant.role,
      }),
    );
    await work((trx) =>
      placeHold(trx, { target: { artifact: publication }, reason: 'Disputed', by: ada }),
    );
    expect(await move(opened.artifactId)).toEqual({ answer: 'held' });
  });

  it('a publication recorded after its document moves lands in the new space', async () => {
    const opened = await blank();
    await move(opened.artifactId);
    const publication = await work((trx) =>
      publish(trx, {
        document: { artifactId: opened.artifactId, id: opened.id },
        author: ada,
        role: tenant.role,
      }),
    );
    expect(await spaceOf(publication)).toBe(closed);
  });

  it('also carries components and their images; a shared component stays, listed', async () => {
    const asset = await image();
    const goes = await figured(asset);
    const shared = await component('Shared part');
    const report = await placing(goes, shared);
    await placing(shared);
    const answer = await move(report.artifactId, { also: true });
    expect(answer).toMatchObject({
      answer: 'changed',
      skipped: [
        {
          id: shared.artifactId,
          kind: 'component',
          reason: 'placed_elsewhere',
          title: 'Shared part',
        },
      ],
    });
    expect(await spaceOf(goes.artifactId)).toBe(closed);
    expect(await spaceOf(asset.artifactId)).toBe(closed);
    expect(await spaceOf(shared.artifactId)).toBe(open);
  });

  it("a dataset's image never moves, and one with a replacement on its way waits for it", async () => {
    const dataset = await work(async (trx) => {
      const { upload } = await uploadForDatasetImage(trx, {
        spaceId: open,
        uploader: ada,
        key: `${tenant.role}/sha256/${randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
        format: 'png',
        bytes: 3530,
      });
      return recordAsset(trx, upload.id, HEADER);
    });
    expect(await move(dataset.artifactId)).toEqual({ answer: 'artifact.not_movable' });

    const replaced = await image();
    await work((trx) =>
      createAssetUpload(trx, {
        spaceId: open,
        uploader: ada,
        alternative: null,
        name: 'owl-two.png',
        replaces: replaced.artifactId,
      }),
    );
    expect(await move(replaced.artifactId)).toEqual({ answer: 'asset.uploading' });
  });

  it('an image another part still uses stays, and an image alone may move', async () => {
    const asset = await image();
    const goes = await figured(asset);
    await figured(asset);
    const report = await placing(goes);
    const answer = await move(report.artifactId, { also: true });
    expect(answer).toMatchObject({
      answer: 'changed',
      skipped: [{ id: asset.artifactId, kind: 'asset', reason: 'in_use' }],
    });
    expect(await spaceOf(asset.artifactId)).toBe(open);
    expect(await move(asset.artifactId)).toMatchObject({ answer: 'changed' });
  });

  it('a component moved alone moves alone, and what is not permitted stays unnamed', async () => {
    const part = await component('Secret part');
    const report = await placing(part);
    const asGrace = await work((trx) =>
      previewMove(trx, inputOf(report.artifactId, { by: grace, also: true })),
    );
    expect(asGrace).toMatchObject({
      answer: 'previewed',
      skipped: [{ id: part.artifactId, reason: 'not_permitted' }],
    });
    const alone = await move(part.artifactId);
    expect(alone).toMatchObject({ moved: [part.artifactId] });
    expect(await spaceOf(report.artifactId)).toBe(open);
  });

  it('previewMove and moveToSpace agree on every count, the preview writing nothing', async () => {
    const asset = await image();
    const goes = await figured(asset);
    const shared = await component('Shared two');
    const report = await placing(goes, shared);
    await placing(shared);
    await work((trx) =>
      grant(trx, {
        subject: { principal: grace },
        roleId: readerRole,
        level: { kind: 'artifact', id: report.artifactId },
        effect: 'allow',
        grantedBy: ada,
      }),
    );
    const preview = await work((trx) =>
      previewMove(trx, inputOf(report.artifactId, { also: true })),
    );
    expect(await spaceOf(report.artifactId)).toBe(open);
    const moved = await move(report.artifactId, { also: true });
    const {
      answer: previewed,
      consequences,
      ...counted
    } = preview as never as {
      answer: string;
      consequences: object;
    };
    const { answer: changed, ...done } = moved;
    expect([previewed, changed]).toEqual(['previewed', 'changed']);
    expect(counted).toEqual(done);
    expect(consequences).toMatchObject({ imagesStaying: 0, usingTemplate: 0, openRounds: 0 });
  });

  it(`refuses more than ${MOVE_MOST} carried at once, nothing changing`, async () => {
    const report = await blank();
    await work(async (trx) => {
      await sql`
        with made as (
          insert into artifact (kind, space_id)
          select 'component', ${open}::uuid from generate_series(1, ${MOVE_MOST}) returning id
        )
        insert into reference (from_id, from_version, to_id, to_kind, mode)
        select ${report.artifactId}::uuid, ${report.id}::uuid, id, 'component', 'latest' from made
      `.execute(trx);
    });
    expect(await move(report.artifactId, { also: true })).toEqual({ answer: 'move.too_large' });
    expect(await spaceOf(report.artifactId)).toBe(open);
  });

  it('every table holding a space_id is moved or named as staying, so the next must choose', async () => {
    const MOVED = new Set(['artifact', 'search_entry', 'search_earlier', 'search_history']);
    const STAYS = new Set([
      'access_grant', // a grant at a space is about the space
      'asset_upload', // an upload's record, as it was made (0184)
      'legal_hold',
      'retention_keep', // each keyed to the space, not what is in it
      'cohort', // the cohort's own; its rows read each document's space
      'bibliography_identity',
      'bibliography_key',
      'import', // where it was made
      'bridge_delivery', // a delivery's record
      'bridge_settings',
      'bridge_unlisted_property', // keyed to the space
    ]);
    const found = await work(async (trx) => {
      const { rows } = await sql<{ table_name: string }>`
        select c.table_name from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = current_schema() and c.column_name = 'space_id'
           and t.table_type = 'BASE TABLE'`.execute(trx);
      return rows.map((row) => row.table_name);
    });
    expect(found.filter((name) => !MOVED.has(name) && !STAYS.has(name))).toEqual([]);
  });
});
