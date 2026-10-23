import { randomBytes } from 'node:crypto';
import {
  DEFAULT_IMPORT_LEVELS,
  blockIdentifierFrom,
  proposeImport,
  readImageHeader,
  type AuditContext,
  type ImportComment,
  type ImportFlowItem,
  type ImportIdentity,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  abandonImport,
  acceptImport,
  createImport,
  editImport,
  failImport,
  holdImportImage,
  importParts,
  importPolicy,
  readImport,
  receiveImportFile,
  recordProposal,
  setImportPolicy,
} from './imports.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { readAssetVersion } from './assets.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import { latestVersion } from './versions.js';

/** A PNG of one pixel, as a Word file's media holds one. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);
const PLACEHOLDER = '00000000-0000-4000-8000-000000000001';

const ISSUER = 'https://idp.example';

const heading = (level: number, text: string, anchor?: string): ImportFlowItem => ({
  kind: 'heading',
  level,
  style: `Heading ${level}`,
  text,
  ...(anchor === undefined ? {} : { anchor }),
});
const run = (value: string, change?: object) => ({
  type: 'text',
  value,
  marks: [],
  ...(change === undefined ? {} : { change }),
});
const block = (content: object[], id?: string): ImportFlowItem => ({
  kind: 'block',
  block: { type: 'paragraph', ...(id === undefined ? {} : { id }), content },
  source: content.map((each) => (each as { value?: string }).value ?? '').join(''),
});
const reference = (block: string) => ({
  type: 'crossReference',
  id: `wr-${block}`,
  target: { kind: 'block', block },
  display: 'number',
});

const identities: ImportIdentity[] = [
  { name: 'Edsger', email: null, carries: ['changes', 'comments'] },
  { name: 'Grace', email: 'grace@example.com', carries: ['changes', 'comments'] },
];
const comments: ImportComment[] = [
  {
    id: '0',
    block: 'wb-2',
    quote: 'three newts',
    before: 'We saw ',
    crossed: false,
    author: 'Edsger',
    initials: 'EW',
    date: null,
    text: 'Check this count.',
    replies: [{ author: 'Grace', initials: null, date: null, text: 'Recounted: three.' }],
  },
];

/** What the job would write for Grace's field notes: two components, changes, a comment, references. */
const proposal = (outside = false) => {
  const read = proposeImport(
    [
      heading(2, 'Sampling'),
      block(
        [
          run('We saw three newts'),
          run(' today', { kind: 'insert', author: 'Grace', id: '1' }),
          run(' and frogs', { kind: 'delete', author: 'Edsger', id: '2' }),
          run('. See '),
          reference('wb-9'),
          ...(outside ? [reference('wx-1')] : []),
        ],
        'wb-2',
      ),
      heading(2, 'Analysis'),
      block([run('Counted twice.')], 'wb-9'),
    ],
    DEFAULT_IMPORT_LEVELS,
    {
      language: 'en',
      direction: 'ltr',
      newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
      comments,
    },
  );
  return {
    ...read,
    report: [],
    title: 'Field notes',
    language: 'en',
    references: outside
      ? [{ key: 'wx-1', bookmark: '_Ref9', field: 'REF' as const, text: 'Section 9' }]
      : [],
    identities,
    properties: { creator: 'Grace', company: 'Pond Survey' },
  };
};

describe("an import's structure (IMc)", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let acting: AuditContext;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work, acting);

  const proposed = async (outside = false) =>
    tenant(async (trx) => {
      const made = await createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName: 'Field notes.docx',
        fileType: 'docx',
      });
      const sha256 = randomBytes(32).toString('hex');
      await receiveImportFile(trx, made.id, {
        key: `tenants/t/sha256/${sha256}`,
        sha256,
        bytes: 9,
      });
      return (await recordProposal(trx, made.id, proposal(outside)))!;
    });

  const accept = (id: string) =>
    tenant((trx) =>
      acceptImport(trx, id, { by: ada, title: 'Field notes', language: 'en', direction: 'ltr' }),
    );

  /** Each suggestion and thread an import made, with who made it and what it is attributed to. */
  const made = (id: string) =>
    tenant(async (trx) => {
      type Made = { by: string; policy: string; to: string | null; member: string | null };
      const { rows: suggestions } = await sql<Made>`
        select s.made_by as by, a.policy, a.attributed_to as to, a.member from import_attribution a
          join suggestion s on s.id = a.suggestion_id where a.import_id = ${id}
         order by a.attributed_to nulls first`.execute(trx);
      const { rows: threads } = await sql<Made>`
        select t.created_by as by, a.policy, a.attributed_to as to, a.member from import_attribution a
          join thread t on t.id = a.thread_id where a.import_id = ${id}`.execute(trx);
      const { rows: replies } = await sql<Made>`
        select c.author as by, a.policy, a.attributed_to as to, a.member from import_attribution a
          join thread_comment c on c.id = a.comment_id where a.import_id = ${id}`.execute(trx);
      return { suggestions, threads, replies };
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      const person = async (subject: string, email: string, name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject, email, display_name: name })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada', 'ada@example.com', 'Ada');
      grace = await person('grace', 'grace@example.com', 'Grace Hopper');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
    });
    acting = { actorKind: 'person', actor: ada, actorLabel: 'Ada' };
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const removed: string[] = [];
  const remove = async (key: string) => {
    removed.push(key);
  };

  /** An import being read whose file holds a figure, its image held for it by its hash. */
  const withImage = async (sha256 = randomBytes(32).toString('hex')) =>
    tenant(async (trx) => {
      const made = await createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName: 'Pond.docx',
        fileType: 'docx',
      });
      const file = randomBytes(32).toString('hex');
      await receiveImportFile(trx, made.id, {
        key: `tenants/t/sha256/${file}`,
        sha256: file,
        bytes: 9,
      });
      const header = readImageHeader(PNG);
      if (!header.ok) throw new Error('not a PNG');
      const key = `t_acme/sha256/${sha256}`;
      await holdImportImage(trx, made.id, {
        placeholder: PLACEHOLDER,
        key,
        sha256,
        bytes: PNG.length,
        header: header.header,
      });
      return { id: made.id, key };
    });
  const propose = (id: string) =>
    tenant(async (trx) => {
      const read = proposeImport(
        [
          heading(2, 'Pond'),
          {
            kind: 'block',
            block: {
              type: 'figure',
              asset: PLACEHOLDER,
              imageStyle: 'figure',
              caption: [],
              alternative: { kind: 'own', text: 'A newt' },
            },
            source: '',
          },
        ],
        DEFAULT_IMPORT_LEVELS,
        {
          language: 'en',
          direction: 'ltr',
          newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
        },
      );
      return (await recordProposal(trx, id, { ...read, report: [], title: null, language: null }))!;
    });
  /** What is left of the images an import held: its rows, and the assets made in the space. */
  const left = (id: string) =>
    tenant(async (trx) => {
      const { rows: held } = await sql`select 1 from import_asset where import_id = ${id}`.execute(
        trx,
      );
      const { rows: assets } = await sql<{ count: string }>`
        select count(*) as count from artifact where kind = 'asset'`.execute(trx);
      return { held: held.length, assets: Number(assets[0]!.count) };
    });

  it("IMP-008 leaves no asset, version or object of an abandoned import's images", async () => {
    const before = await left('00000000-0000-4000-8000-000000000000');
    const { id, key } = await withImage();
    await propose(id);
    removed.length = 0;
    await tenant((trx) => abandonImport(trx, id, remove));
    expect(removed).toContain(key);
    expect(await left(id)).toEqual({ held: 0, assets: before.assets });
  });

  it("IMP-008 IMP-042 leaves no asset, version or object of a failed import's images", async () => {
    const before = await left('00000000-0000-4000-8000-000000000000');
    const { id, key } = await withImage();
    removed.length = 0;
    await tenant((trx) => failImport(trx, id, 'reading_failed', remove));
    expect(removed).toContain(key);
    expect(await left(id)).toEqual({ held: 0, assets: before.assets });
  });

  it('IMP-008 keeps an image another import of the same bytes still holds', async () => {
    const sha256 = randomBytes(32).toString('hex');
    const first = await withImage(sha256);
    await withImage(sha256);
    removed.length = 0;
    await tenant((trx) => failImport(trx, first.id, 'reading_failed', remove));
    expect(removed).not.toContain(first.key);
  });

  it("IMP-006 makes an import's images assets of the space only at acceptance, each figure placing its own", async () => {
    const before = await left('00000000-0000-4000-8000-000000000000');
    const { id } = await withImage();
    await propose(id);
    expect((await left(id)).assets).toBe(before.assets);
    const answer = await accept(id);
    if (answer.answer !== 'accepted') throw new Error(answer.answer);
    const figure = (answer.components[0]!.content as { content: { asset: string }[] }).content[0]!;
    const asset = await tenant((trx) => readAssetVersion(trx, figure.asset));
    expect(asset).toMatchObject({ spaceId: general, content: { format: 'png' } });
    expect(await left(id)).toEqual({ held: 0, assets: before.assets + 1 });
  });

  it('IMP-009 holds the identities the file carries, and its parts their changes and threads, before acceptance', async () => {
    const found = await proposed();
    expect(found.identities).toEqual(identities);
    expect(found.properties).toBeNull();
    const parts = await tenant((trx) => importParts(trx, found.id));
    expect(parts.map((part) => [part.title, part.changes.length, part.threads.length])).toEqual([
      ['Sampling', 2, 1],
      ['Analysis', 0, 0],
    ]);
  });

  it("IMP-005 IMP-010 IMP-011 IMP-032 makes each Word author's changes a suggestion and each comment a thread with its replies at acceptance, all by the importer, each attributed to its Word author as text and the member an email matches, and the policy recorded", async () => {
    const found = await proposed();
    const answer = await accept(found.id);
    expect(answer.answer).toBe('accepted');
    if (answer.answer !== 'accepted') return;
    expect(answer.import.policy).toBe('map');
    expect(await made(found.id)).toEqual({
      suggestions: [
        { by: ada, policy: 'map', to: 'Edsger (from Word)', member: null },
        { by: ada, policy: 'map', to: 'Grace (from Word)', member: grace },
      ],
      threads: [{ by: ada, policy: 'map', to: 'Edsger (from Word)', member: null }],
      replies: [{ by: ada, policy: 'map', to: 'Grace (from Word)', member: grace }],
    });
    // A reference to another component's block resolved to that component's block (IMP-006).
    const [sampling, analysis] = answer.components;
    const content = sampling!.content as { content: { content: Record<string, unknown>[] }[] };
    const target = content.content[0]!.content.find((each) => each.type === 'crossReference');
    const there = (analysis!.content as { content: { id: string }[] }).content[0]!.id;
    expect(target!.target).toEqual({
      kind: 'component',
      component: analysis!.artifactId,
      block: there,
    });
  });

  it('IMP-010 IMP-011 keeps every Word author as text under keep, and none under discard', async () => {
    const before = await tenant((trx) => importPolicy(trx));
    expect(before).toBe('map');
    await tenant((trx) => setImportPolicy(trx, 'keep'));
    const kept = await proposed();
    expect(kept.properties).toEqual({ creator: 'Grace', company: 'Pond Survey' });
    await accept(kept.id);
    expect((await made(kept.id)).suggestions).toEqual([
      { by: ada, policy: 'keep', to: 'Edsger (from Word)', member: null },
      { by: ada, policy: 'keep', to: 'Grace (from Word)', member: null },
    ]);
    await tenant((trx) => setImportPolicy(trx, 'discard'));
    const discarded = await proposed();
    const answer = await accept(discarded.id);
    expect(answer.answer === 'accepted' && answer.import).toMatchObject({
      policy: 'discard',
      identities: [],
      properties: null,
    });
    expect((await made(discarded.id)).threads).toEqual([
      { by: ada, policy: 'discard', to: null, member: null },
    ]);
    await tenant((trx) => setImportPolicy(trx, 'map'));
  });

  it('IMP-010 never makes content authored by a member a Word author names, however the file spells them', async () => {
    // The file says Grace wrote its changes and a reply, giving her email: the file's word alone.
    const found = await proposed();
    expect((await accept(found.id)).answer).toBe('accepted');
    const authored = await tenant(async (trx) => {
      const { rows } = await sql<{ count: string }>`
        select (select count(*) from suggestion where made_by = ${grace})
             + (select count(*) from thread where created_by = ${grace})
             + (select count(*) from thread_comment where author = ${grace}) as count`.execute(trx);
      return Number(rows[0]!.count);
    });
    expect(authored).toBe(0);
  });

  it('IMP-010 refuses a confirmation of a member the name does not match, of nobody in the tenant, or of a name the file does not carry', async () => {
    const found = await tenant(async (trx) => {
      const made = await proposed();
      await sql`update import set identities = ${JSON.stringify([
        { name: 'Grace Hopper', email: null, carries: ['changes'] },
      ])}::jsonb where id = ${made.id}`.execute(trx);
      return made;
    });
    const confirm = (identity: string, member: string) =>
      tenant((trx) =>
        editImport(trx, found.id, {
          revision: found.revision,
          edit: { edit: 'identity', identity, member },
          by: ada,
        }),
      );
    const refused = { answer: 'refused', refusal: 'identity_invalid' };
    expect(await confirm('Grace Hopper', ada)).toEqual(refused);
    expect(await confirm('Grace Hopper', '00000000-0000-4000-8000-000000000000')).toEqual(refused);
    expect(await confirm('Edsger', grace)).toEqual(refused);
  });

  it('IMP-010 maps a name match only once its importer confirms it', async () => {
    const found = await tenant(async (trx) => {
      const made = await proposed();
      await sql`update import set identities = ${JSON.stringify([
        { name: 'Grace Hopper', email: null, carries: ['changes'] },
      ])}::jsonb where id = ${made.id}`.execute(trx);
      return made;
    });
    const confirmed = await tenant((trx) =>
      editImport(trx, found.id, {
        revision: found.revision,
        edit: { edit: 'identity', identity: 'Grace Hopper', member: grace },
        by: ada,
      }),
    );
    expect(confirmed.answer === 'edited' && confirmed.import.confirmed).toEqual({
      'Grace Hopper': grace,
    });
  });

  it('IMP-033 IMP-034 refuses acceptance while a reference outside the import is unresolved, and accepts once it is made the text it showed, saying so in the report', async () => {
    const found = await proposed(true);
    expect(found.outside).toEqual([
      { key: 'wx-1', bookmark: '_Ref9', field: 'REF', text: 'Section 9', resolved: null },
    ]);
    expect(await accept(found.id)).toEqual({
      answer: 'import.references_unresolved',
      references: ['wx-1'],
    });
    const edited = await tenant((trx) =>
      editImport(trx, found.id, {
        revision: found.revision,
        edit: { edit: 'reference', reference: 'wx-1', to: { kind: 'text' } },
        by: ada,
      }),
    );
    expect(edited.answer).toBe('edited');
    if (edited.answer !== 'edited') return;
    expect(edited.import.outside[0]!.resolved).toBe('text');
    expect(edited.import.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: 'crossReferenceText', detail: 'Section 9', part: 0 }),
      ]),
    );
    const answer = await accept(found.id);
    expect(answer.answer).toBe('accepted');
    if (answer.answer !== 'accepted') return;
    const text = await tenant(async (trx) => {
      const version = await latestVersion(trx, answer.components[0]!.artifactId);
      return JSON.stringify(version!.content);
    });
    expect(text).toContain('Section 9');
  });

  it('IMP-034 retargets a reference outside the import to a block in it, and refuses one in no component of its space', async () => {
    const found = await proposed(true);
    const parts = await tenant((trx) => importParts(trx, found.id));
    const block = parts[1]!.blocks[0]!.id;
    const nowhere = await tenant((trx) =>
      editImport(trx, found.id, {
        revision: found.revision,
        edit: {
          edit: 'reference',
          reference: 'wx-1',
          to: { kind: 'component', component: '00000000-0000-4000-8000-000000000000', block },
        },
        by: ada,
      }),
    );
    expect(nowhere).toEqual({ answer: 'refused', refusal: 'target_missing' });
    const edited = await tenant((trx) =>
      editImport(trx, found.id, {
        revision: found.revision,
        edit: { edit: 'reference', reference: 'wx-1', to: { kind: 'block', block } },
        by: ada,
      }),
    );
    expect(edited.answer === 'edited' && edited.import.outside[0]!.resolved).toBe('retargeted');
    expect((await accept(found.id)).answer).toBe('accepted');
  });

  it('IMP-034 refuses a retarget to a component its importer may not read exactly as one to a component that is not there', async () => {
    const { seen, hidden } = await tenant(async (trx) => {
      const author = (await findRole(trx, 'Author'))!.id;
      await grant(trx, {
        roleId: author,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const component = async (title: string) => {
        const made = await createComponent(trx, {
          spaceId: general,
          title,
          language: 'en',
          direction: 'ltr',
          author: grace,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const blocks = (made.version.content as { content: { id: string }[] }).content;
        return { component: made.version.artifactId, block: blocks[0]!.id };
      };
      const seen = await component('Seen');
      const hidden = await component('Hidden');
      await grant(trx, {
        roleId: author,
        subject: { principal: ada },
        level: { kind: 'artifact', id: hidden.component },
        effect: 'deny',
        grantedBy: ada,
      });
      return { seen, hidden };
    });
    const found = await proposed(true);
    const retarget = (to: { component: string; block: string }) =>
      tenant((trx) =>
        editImport(trx, found.id, {
          revision: found.revision,
          edit: { edit: 'reference', reference: 'wx-1', to: { kind: 'component', ...to } },
          by: ada,
        }),
      );
    const refused = { answer: 'refused', refusal: 'target_missing' };
    expect(await retarget(hidden)).toEqual(refused);
    expect(
      await retarget({ component: '00000000-0000-4000-8000-000000000000', block: hidden.block }),
    ).toEqual(refused);
    expect(await retarget({ ...seen, block: 'nowhere' })).toEqual(refused);
    expect((await retarget(seen)).answer).toBe('edited');
  });

  it('keeps the policy one of map, keep or discard', async () => {
    await expect(
      tenant((trx) => sql`update import_policy set policy = 'guess'`.execute(trx)),
    ).rejects.toThrow();
    const after = await tenant((trx) => readImport(trx, '00000000-0000-4000-8000-000000000000'));
    expect(after).toBeUndefined();
  });
});
