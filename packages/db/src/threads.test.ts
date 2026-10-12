import type { BlockNode, ContentDocument, OutlineDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
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
import {
  addComment,
  editComment,
  listThreads,
  readThread,
  resolveThread,
  startThread,
} from './threads.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const said = (value: string) => [{ text: value }];
const NODE = 's'.repeat(26);

describe('threads', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  /** A component in General whose content is these blocks, at its second version. */
  const component = (...blocks: BlockNode[]) =>
    tenant(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return revise(trx, made.version, blocks);
    });
  const revise = async (trx: TenantTransaction, version: StoredVersion, blocks: BlockNode[]) => {
    const substance = substanceOf(version);
    if (substance.kind !== 'component') throw new Error('not a component');
    const next = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author: ada,
      substance: {
        ...substance,
        content: { ...substance.content, content: blocks } as ContentDocument,
      },
    });
    if (next.answer !== 'recorded') throw new Error(next.answer);
    return next.version;
  };
  const para = (id: string, value: string): BlockNode => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [text(value)],
  });
  const started = async (on: StoredVersion, anchor: unknown, by = ada) => {
    const answer = await tenant((trx) =>
      startThread(trx, {
        on: on.artifactId,
        version: on.id,
        anchor,
        parts: said('Is this right?'),
        author: by,
      }),
    );
    if (answer.answer !== 'done') throw new Error(answer.answer);
    return answer;
  };

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
    await tenant(async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('COL-012 starts a thread on a span, a cell, a whole component and an outline node, and refuses an anchor that does not stand', async () => {
    const version = await component(para('p1', 'Set the tray, then wait.'), {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Doses')],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [para('c1', 'Five')], colspan: 1, rowspan: 1 }] }],
    });
    await started(version, { kind: 'span', block: 'p1', quote: 'the tray', before: 'Set ' });
    await started(version, { kind: 'cell', table: 't1', block: 'c1' });
    await started(version, { kind: 'component' });
    const refuse = (anchor: unknown) =>
      tenant((trx) =>
        startThread(trx, {
          on: version.artifactId,
          version: version.id,
          anchor,
          parts: said('Hm'),
          author: ada,
        }),
      );
    expect(await refuse({ kind: 'span', block: 'p1', quote: 'the lid', before: '' })).toEqual({
      answer: 'anchor.invalid',
    });
    expect(await refuse({ kind: 'node', node: NODE })).toEqual({ answer: 'anchor.invalid' });

    const document = await tenant(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: {
            ...(made.version.content as OutlineDocument),
            nodes: [
              {
                type: 'section',
                id: NODE,
                title: [text('Method')],
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                children: [],
              },
            ],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });
    await started(document, { kind: 'node', node: NODE });
    // A version of another artifact is not this one's.
    expect(
      await tenant((trx) =>
        startThread(trx, {
          on: version.artifactId,
          version: document.id,
          anchor: { kind: 'component' },
          parts: said('Hm'),
          author: ada,
        }),
      ),
    ).toEqual({ answer: 'missing' });
  });

  it('COL-014 COL-013 keeps replies in order with their authors, and resolving records who and when; a resolved thread takes nothing more', async () => {
    const version = await component(para('p1', 'Set the tray.'));
    const { thread } = await started(version, { kind: 'component' });
    const reply = await tenant((trx) =>
      addComment(trx, { thread, parts: said('Yes.'), author: grace }),
    );
    expect(reply).toMatchObject({ answer: 'done' });
    expect(await tenant((trx) => resolveThread(trx, { thread, by: grace }))).toBe('resolved');
    expect(await tenant((trx) => resolveThread(trx, { thread, by: ada }))).toBe('resolved.already');
    expect(
      await tenant((trx) => addComment(trx, { thread, parts: said('And?'), author: ada })),
    ).toEqual({
      answer: 'thread.resolved',
    });
    const read = await tenant((trx) => readThread(trx, thread));
    expect(read!.comments.map((each) => [each.author.name, each.texts.at(-1)!.parts])).toEqual([
      ['Ada', said('Is this right?')],
      ['Grace', said('Yes.')],
    ]);
    expect(read!.resolution).toMatchObject({ by: { id: grace, name: 'Grace' } });
    expect(read!.resolution!.at).toBeInstanceOf(Date);
  });

  it('COL-051 keeps every text a comment has had, edited by its author alone', async () => {
    const version = await component(para('p1', 'Set the tray.'));
    const { thread, comment } = await started(version, { kind: 'component' });
    expect(
      await tenant((trx) =>
        editComment(trx, { thread, comment, parts: said('Is this wrong?'), author: grace }),
      ),
    ).toEqual({ answer: 'comment.not_yours' });
    expect(
      await tenant((trx) =>
        editComment(trx, {
          thread,
          comment,
          parts: [{ text: 'Is this wrong, ' }, { mention: grace }],
          author: ada,
        }),
      ),
    ).toMatchObject({ answer: 'done', mentioned: [grace] });
    const read = await tenant((trx) => readThread(trx, thread));
    expect(read!.comments[0]!.texts.map((each) => each.parts)).toEqual([
      said('Is this right?'),
      [{ text: 'Is this wrong, ' }, { mention: grace }],
    ]);
  });

  it('COL-018 lists threads filtered by state, by who started them and by what was said since', async () => {
    const version = await component(para('p1', 'Set the tray.'));
    const first = await started(version, { kind: 'component' }, ada);
    const second = await started(version, { kind: 'component' }, grace);
    await tenant((trx) => resolveThread(trx, { thread: first.thread, by: ada }));
    const ids = async (filter: Parameters<typeof listThreads>[1]) =>
      (await tenant((trx) => listThreads(trx, filter))).map((each) => each.id);
    expect(await ids({ on: [version.artifactId] })).toEqual([second.thread, first.thread]);
    expect(await ids({ on: [version.artifactId], state: 'open' })).toEqual([second.thread]);
    expect(await ids({ on: [version.artifactId], state: 'resolved' })).toEqual([first.thread]);
    expect(await ids({ on: [version.artifactId], author: ada })).toEqual([first.thread]);
    expect(await ids({ on: [version.artifactId], since: new Date(Date.now() + 60_000) })).toEqual(
      [],
    );
  });

  it('COL-049 COL-054 gives nobody a way to delete or change a thread or a comment, and stores every time as an instant', async () => {
    const version = await component(para('p1', 'Set the tray.'));
    const { thread, comment } = await started(version, { kind: 'component' });
    for (const statement of [
      sql`delete from thread where id = ${thread}`,
      sql`delete from thread_comment where id = ${comment}`,
      sql`update thread_comment_text set parts = '[]' where comment_id = ${comment}`,
    ]) {
      await expect(tenant((trx) => statement.execute(trx))).rejects.toThrow(/permission denied/);
    }
    const { rows } = await tenant((trx) =>
      sql<{ data_type: string }>`select distinct data_type from information_schema.columns
        where table_schema = current_schema()
          and table_name in ('thread', 'thread_comment', 'thread_comment_text', 'thread_resolution')
          and column_name in ('created_at', 'written_at', 'resolved_at')`.execute(trx),
    );
    expect(rows.map((row) => row.data_type)).toEqual(['timestamp with time zone']);
  });

  it('refuses a comment naming somebody this environment does not hold, or past its shape', async () => {
    const version = await component(para('p1', 'Set the tray.'));
    const { thread } = await started(version, { kind: 'component' });
    expect(
      await tenant((trx) =>
        addComment(trx, {
          thread,
          parts: [{ mention: '00000000-0000-4000-8000-000000000000' }],
          author: ada,
        }),
      ),
    ).toMatchObject({ answer: 'parts.invalid' });
    expect(
      await tenant((trx) => addComment(trx, { thread, parts: [], author: ada })),
    ).toMatchObject({
      answer: 'parts.invalid',
    });
  });
});
