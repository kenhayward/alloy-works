import { createHash, randomBytes } from 'node:crypto';
import {
  createRole,
  grant,
  importParts,
  latestVersion,
  readImport as readStoredImport,
  recordProposal,
  recordVersion,
} from '@alloy-works/db';
import {
  DEFAULT_IMPORT_LEVELS,
  blockIdentifierFrom,
  proposeImport,
  type ContentDocument,
} from '@alloy-works/domain';
import { holdingTransaction, untilWaitingOnLocks } from '@alloy-works/db/testing';
import { readImport as readFile } from '@alloy-works/readers/import';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

interface View {
  id: string;
  state: string;
  failure: string | null;
  document: string | null;
  sweepsAt: string | null;
  parts: {
    id: string;
    kind: string;
    title: string;
    reason: Json;
    source: string;
    again?: Json | null;
  }[];
  report: { subject: string; detail?: string }[];
  recognised: Json | null;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A Word document of a heading and a paragraph, built here. */
const word = (heading: string, text: string) =>
  zipSync({
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:drawing/></w:r></w:p>` +
        `</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    ),
  });

/** A Word document of paragraphs, each with its heading level or none. */
const outline = (paragraphs: readonly (readonly [number | null, string])[]) =>
  zipSync({
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        paragraphs
          .map(
            ([level, text]) =>
              `<w:p>${level === null ? '' : `<w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`,
          )
          .join('') +
        `</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}">` +
        [1, 2]
          .map(
            (level) =>
              `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/></w:style>`,
          )
          .join('') +
        `</w:styles>`,
    ),
  });

describe('the import routes (the IM plan, IM-A, IM-B, IM-F)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const send = (as: string, id: string, bytes: Uint8Array) =>
    h.app.inject({
      method: 'PUT',
      url: `/v1/imports/${id}/file`,
      headers: { host: HOST, cookie: h.cookies[as]!, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(bytes),
    });

  const made = async (as: string, fileName = 'Pond survey.docx', fileType = 'docx') => {
    const answer = await h.call(as, 'POST', `/v1/spaces/${h.general}/imports`, {
      fileName,
      fileType,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<View>();
  };

  /** The revision an import is at, as its page reads it. */
  const revisionOf = async (as: string, id: string) =>
    (await h.call(as, 'GET', `/v1/imports/${id}`)).json<{ revision: number }>().revision;

  /** What the worker does with the file: read it, break it out and write the proposal. */
  const readByTheWorker = (id: string) =>
    h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        const stored = await readStoredImport(trx, id);
        const store = await h.stores.forTenant(trx, h.tenant);
        const read = readFile(
          new Uint8Array(await store.get(stored!.objectKey!)),
          stored!.fileType,
        );
        if (!read.ok) throw new Error(read.failure);
        const { parts, anchors } = proposeImport(read.flow, DEFAULT_IMPORT_LEVELS, {
          language: 'en',
          direction: 'ltr',
          newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
          comments: read.comments,
        });
        await recordProposal(trx, id, {
          parts,
          anchors,
          report: read.report,
          title: read.title,
          language: null,
          references: read.references,
          identities: read.identities,
          properties: read.properties,
        });
      },
      { actorKind: 'system' },
    );

  it('takes a file, proposes it apart from the space, and makes the document only when its importer accepts it', async () => {
    const created = await made('grace');
    expect(created).toMatchObject({ state: 'awaiting', parts: [] });
    // Built once: a zip carries the time it was made, so two builds are two files.
    const file = word('Sampling', 'Grace sampled the pond.');
    const filled = await send('grace', created.id, file);
    expect(filled.statusCode, filled.body).toBe(200);
    expect(filled.json()).toMatchObject({ state: 'reading' });
    // The same file again is answered as it stands; another is refused.
    expect((await send('grace', created.id, file)).statusCode).toBe(200);
    expect((await send('grace', created.id, word('Other', 'Ada'))).json()).toMatchObject({
      code: 'import_filled',
    });

    await readByTheWorker(created.id);
    const view = (await h.call('grace', 'GET', `/v1/imports/${created.id}`)).json<View>();
    expect(view.state).toBe('proposed');
    expect(view.sweepsAt).not.toBeNull();
    expect(view.parts).toEqual([
      expect.objectContaining({
        kind: 'component',
        title: 'Sampling',
        reason: { rule: 'heading', style: 'Heading 2', text: 'Sampling', level: 2 },
        source: 'Sampling\nGrace sampled the pond.',
      }),
    ]);
    expect(view.report).toEqual(
      expect.arrayContaining([expect.objectContaining({ subject: 'notYetRead', detail: 'image' })]),
    );

    const accepted = await h.call('grace', 'POST', `/v1/imports/${created.id}/accept`, {
      revision: await revisionOf('grace', created.id),
      title: 'Pond survey',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const { document } = accepted.json<{ document: string; import: View }>();
    expect(accepted.json()).toMatchObject({ import: { state: 'accepted', document } });
    const opened = await h.call('grace', 'GET', `/v1/documents/${document}`);
    expect(opened.statusCode, opened.body).toBe(200);
  });

  it('IMP-008 removes the bytes it stored for a file another request filled the import with meanwhile', async () => {
    const created = await made('grace');
    const file = word('Sampling', 'Grace sampled the pond late.');
    const sha256 = createHash('sha256').update(file).digest('hex');
    const other = randomBytes(32).toString('hex');
    // Another request fills the import first, holding it until this one has stored its bytes and
    // waits on the import's row.
    const commit = await holdingTransaction(
      h.db.adminUrl,
      `update ${h.tenant.schema}.import set state = 'reading', object_key = $2, sha256 = $3,
              bytes = 9 where id = $1`,
      [created.id, `t_x/sha256/${other}`, other],
    );
    const sent = send('grace', created.id, file);
    await untilWaitingOnLocks(h.db.adminUrl, 1);
    await commit();
    const answer = await sent;
    expect(answer.json()).toMatchObject({ code: 'import_filled' });
    const kept = await h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        const store = await h.stores.forTenant(trx, h.tenant);
        const prefix = (await store.put(strToU8('probe'), 'text/plain')).key.split('/')[0];
        return store.get(`${prefix}/sha256/${sha256}`).then(
          () => true,
          () => false,
        );
      },
      { actorKind: 'system' },
    );
    expect(kept).toBe(false);
  });

  it('refuses a file that is not what it says, by its name and by its bytes', async () => {
    const named = await h.call('grace', 'POST', `/v1/spaces/${h.general}/imports`, {
      fileName: 'Pond survey.pdf',
      fileType: 'docx',
    });
    expect(named.json()).toMatchObject({ code: 'import_file_not_permitted' });
    const created = await made('grace');
    const text = await send('grace', created.id, strToU8('Ada wrote this in a text editor.'));
    expect(text.statusCode).toBe(400);
    expect(text.json()).toMatchObject({ code: 'import_file_not_permitted' });
    // Nothing was kept: it still awaits a file.
    expect((await h.call('grace', 'GET', `/v1/imports/${created.id}`)).json()).toMatchObject({
      state: 'awaiting',
    });
    // A reader of the space may not import into it.
    expect(
      (
        await h.call('alice', 'POST', `/v1/spaces/${h.general}/imports`, {
          fileName: 'Notes.md',
          fileType: 'markdown',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('is seen only by its importer and the space’s administrators', async () => {
    const created = await made('grace', 'Notes.md', 'markdown');
    expect((await h.call('alice', 'GET', `/v1/imports/${created.id}`)).statusCode).toBe(404);
    expect((await h.call('ivy', 'GET', `/v1/imports/${created.id}`)).statusCode).toBe(404);
    expect((await h.call('ada', 'GET', `/v1/imports/${created.id}`)).statusCode).toBe(200);
    // Ada administers, so lists it; Alice lists only her own, none.
    const listed = (as: string) =>
      h
        .call(as, 'GET', `/v1/spaces/${h.general}/imports`)
        .then((answer) => answer.json<{ items: { id: string }[] }>().items.map((each) => each.id));
    expect(await listed('ada')).toContain(created.id);
    expect(await listed('grace')).toContain(created.id);
    expect(await listed('alice')).toEqual([]);
    // Only its importer accepts it or changes its levels.
    expect(
      (
        await h.call('ada', 'POST', `/v1/imports/${created.id}/accept`, {
          revision: await revisionOf('ada', created.id),
        })
      ).statusCode,
    ).toBe(404);
  });

  /** Ada's survey, proposed: Methods, holding Sampling and Analysis; then Discussion, empty. */
  const survey = async () => {
    const created = await made('grace');
    await send(
      'grace',
      created.id,
      outline([
        [1, 'Methods'],
        [2, 'Sampling'],
        [null, 'Ada sampled the pond.'],
        [null, 'Grace counted newts.'],
        [2, 'Analysis'],
        [null, 'Ada analysed.'],
        [2, 'Discussion'],
      ]),
    );
    await readByTheWorker(created.id);
    const view = (await h.call('grace', 'GET', `/v1/imports/${created.id}`)).json<
      View & { parts: { id: string }[]; revision: number }
    >();
    const [methods, sampling, analysis, discussion] = view.parts.map((part) => part.id);
    return { id: created.id, methods: methods!, sampling: sampling!, analysis, discussion };
  };

  it('refuses a change of levels, a change of kind or an acceptance made against a revision since edited', async () => {
    const { id, sampling } = await survey();
    const edited = await h.call('grace', 'POST', `/v1/imports/${id}/edits`, {
      revision: 0,
      edit: { edit: 'rename', part: sampling, title: 'How we sampled' },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const stale: ['PUT' | 'POST', string, Json][] = [
      ['PUT', 'levels', { section: 1, component: 3 }],
      ['PUT', 'kind', { kind: 'first' }],
      ['POST', 'accept', {}],
    ];
    for (const [method, path, body] of stale) {
      const answer = await h.call('grace', method, `/v1/imports/${id}/${path}`, {
        revision: 0,
        ...body,
      });
      expect(answer.statusCode, path).toBe(409);
      expect(answer.json()).toMatchObject({ code: 'import_changed' });
    }
    expect((await h.call('grace', 'GET', `/v1/imports/${id}`)).json()).toMatchObject({
      state: 'proposed',
      revision: 1,
    });
  });

  it('IMP-028 shows one part at a time, its blocks beside the text it came from, with the parts either side', async () => {
    const { id, methods, sampling, analysis } = await survey();
    const part = await h.call('grace', 'GET', `/v1/imports/${id}/parts/${sampling}`);
    expect(part.statusCode, part.body).toBe(200);
    expect(part.json()).toMatchObject({
      title: 'Sampling',
      kind: 'component',
      reason: { rule: 'heading', style: 'Heading 2', text: 'Sampling' },
      source: 'Sampling\nAda sampled the pond.\nGrace counted newts.',
      blocks: [
        { type: 'paragraph', text: 'Ada sampled the pond.' },
        { type: 'paragraph', text: 'Grace counted newts.' },
      ],
      place: 1,
      of: 4,
      previous: methods,
      next: analysis,
    });
    // The space's administrator reads it too; a reader of the space does not.
    expect((await h.call('ada', 'GET', `/v1/imports/${id}/parts/${sampling}`)).statusCode).toBe(
      200,
    );
    expect((await h.call('alice', 'GET', `/v1/imports/${id}/parts/${sampling}`)).statusCode).toBe(
      404,
    );
    expect((await h.call('grace', 'GET', `/v1/imports/${id}/parts/${id}`)).statusCode).toBe(404);
  });

  it('IMP-002 IMP-041 is edited by its importer alone, each edit validated as made and refused naming why, against the revision read', async () => {
    const { id, methods, sampling } = await survey();
    const edit = (as: string, revision: number, change: Json) =>
      h.call(as, 'POST', `/v1/imports/${id}/edits`, { revision, edit: change });

    const moved = await edit('grace', 0, { edit: 'move', part: sampling, to: 'next', blocks: 1 });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({
      revision: 1,
      parts: [{}, { blocks: 1 }, { blocks: 2 }, {}],
    });
    const stale = await edit('grace', 0, { edit: 'rename', part: sampling, title: 'Late' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'import_changed' });
    const refused = await edit('grace', 1, {
      edit: 'move',
      part: sampling,
      to: 'previous',
      blocks: 1,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'import_edit_refused',
      message: 'A section holds no blocks, so blocks cannot move into or out of one.',
    });
    expect((await edit('grace', 1, { edit: 'merge', part: methods })).json()).toMatchObject({
      message: 'Only two components, or two sections, can be merged.',
    });
    // Its administrator sees it but does not edit it.
    expect(
      (await edit('ada', 1, { edit: 'rename', part: sampling, title: 'Ada’s' })).statusCode,
    ).toBe(404);
    const renamed = await edit('grace', 1, {
      edit: 'rename',
      part: sampling,
      title: 'How we sampled',
    });
    expect(renamed.json()).toMatchObject({
      revision: 2,
      parts: [{}, { title: 'How we sampled' }, {}, {}],
    });
  });

  it('IMP-029 is searched by title and text, filtered by flag, and returned to where its importer was', async () => {
    const { id, sampling, analysis, discussion } = await survey();
    const search = async (query: string) =>
      (await h.call('grace', 'GET', `/v1/imports/${id}/parts?${query}`)).json<{ parts: string[] }>()
        .parts;
    expect(await search('q=NEWTS')).toEqual([sampling]);
    expect(await search('q=analys')).toEqual([analysis]);
    expect(await search('flag=empty')).toEqual([discussion]);
    expect(await search('q=newts&flag=empty')).toEqual([]);

    const placed = await h.call('grace', 'PUT', `/v1/imports/${id}/place`, { part: analysis });
    expect(placed.statusCode, placed.body).toBe(200);
    expect((await h.call('grace', 'GET', `/v1/imports/${id}`)).json()).toMatchObject({
      place: analysis,
    });
    expect((await h.call('grace', 'PUT', `/v1/imports/${id}/place`, { part: id })).statusCode).toBe(
      404,
    );
  });

  it('names the document it makes as its importer typed, else by the file’s Title paragraph, else by its name without the ending', async () => {
    const titled = (title: string) =>
      zipSync({
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body>` +
            `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>Grace sampled the pond.</w:t></w:r></w:p></w:body></w:document>`,
        ),
        'word/styles.xml': strToU8(
          `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`,
        ),
      });
    const named = async (fileName: string, file: Uint8Array, body: Json) => {
      const created = await made('grace', fileName);
      await send('grace', created.id, file);
      await readByTheWorker(created.id);
      const accepted = await h.call('grace', 'POST', `/v1/imports/${created.id}/accept`, {
        revision: await revisionOf('grace', created.id),
        ...body,
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      const { document } = accepted.json<{ document: string }>();
      const opened = await h.call('grace', 'GET', `/v1/documents/${document}`);
      return opened.json<{ outline: { title: string } }>().outline.title;
    };
    expect(await named('Pond.docx', titled('Pond survey 2026'), { title: 'Newts' })).toBe('Newts');
    expect(await named('Pond.docx', titled('Pond survey 2026'), {})).toBe('Pond survey 2026');
    expect(await named('Pond notes.v2.docx', word('Sampling', 'Ada'), {})).toBe('Pond notes.v2');
  });

  it('IMP-036 never says a file was imported before by an import whose document its importer may not read', async () => {
    const file = word('Sampling', 'Ada sampled the secret pond.');
    const theirs = await made('ada', 'Secret pond.docx');
    await send('ada', theirs.id, file);
    await readByTheWorker(theirs.id);
    const accepted = await h.call('ada', 'POST', `/v1/imports/${theirs.id}/accept`, {
      revision: await revisionOf('ada', theirs.id),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const { document } = accepted.json<{ document: string }>();
    await h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        await grant(trx, {
          roleId: h.roles.Reader!,
          subject: { principal: h.ids.grace! },
          level: { kind: 'artifact', id: document },
          effect: 'deny',
          grantedBy: h.ids.ada!,
        });
      },
      { actorKind: 'system' },
    );
    // Neither by its name nor by its bytes: nothing of Ada's import is said.
    const mine = await made('grace', 'Secret pond.docx');
    expect(mine.recognised).toBeNull();
    expect((await send('grace', mine.id, file)).json()).toMatchObject({ recognised: null });
  });

  it('IMP-031 says on the accepted import how many parts were accepted unchanged, edited, merged, split and renamed', async () => {
    const { id, sampling } = await survey();
    await h.call('grace', 'POST', `/v1/imports/${id}/edits`, {
      revision: 0,
      edit: { edit: 'rename', part: sampling, title: 'How we sampled' },
    });
    const accepted = await h.call('grace', 'POST', `/v1/imports/${id}/accept`, {
      revision: await revisionOf('grace', id),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      import: { accepted: { unchanged: 3, edited: 0, merged: 0, split: 0, renamed: 1 } },
    });
  });

  /** Grace's notes: a change by Ada, a comment by Edsger, and a reference to what is not in the file. */
  const notes = () =>
    zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Counts</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t xml:space="preserve">We saw </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>three newts</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
          `<w:ins w:id="1" w:author="Ada"><w:r><w:t xml:space="preserve"> today</w:t></w:r></w:ins><w:r><w:t xml:space="preserve">, see </w:t></w:r>` +
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _Ref9 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Section 9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
          `</w:body></w:document>`,
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Edsger"><w:p><w:r><w:t>Recount them.</w:t></w:r></w:p></w:comment></w:comments>`,
      ),
    });

  it('IMP-009 matches a name the file carries by its email only for an importer who may see members’ emails, by its name alone for anybody else', async () => {
    const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
    const probing = () =>
      zipSync({
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body>` +
            `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Counts</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t xml:space="preserve">We saw </w:t></w:r><w:ins w:id="1" w:author="Pond Surveyor"><w:r><w:t>newts</w:t></w:r></w:ins></w:p>` +
            `</w:body></w:document>`,
        ),
        'word/styles.xml': strToU8(
          `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
        ),
        'word/people.xml': strToU8(
          `<w15:people xmlns:w15="${W15}"><w15:person w15:author="Pond Surveyor"><w15:presenceInfo w15:providerId="AD" w15:userId="S::ivy@example.com::0001"/></w15:person></w15:people>`,
        ),
      });
    const identity = async (as: string) => {
      const created = await made(as, 'Probe.docx');
      await send(as, created.id, probing());
      await readByTheWorker(created.id);
      const view = (await h.call(as, 'GET', `/v1/imports/${created.id}`)).json<{
        identities: Json[];
      }>();
      return view.identities[0];
    };
    // Grace authors in the space; the directory shows her names, never emails.
    expect(await identity('grace')).toMatchObject({
      match: 'none',
      member: null,
      memberName: null,
    });
    // Ada administers it, and may list its members with their emails.
    expect(await identity('ada')).toMatchObject({ match: 'email', member: h.ids.ivy });
  });

  it('IMP-005 IMP-009 IMP-032 IMP-033 IMP-034 shows the names the file carries, the references outside it and what becomes suggestions and threads, and refuses acceptance until each reference is resolved', async () => {
    const created = await made('grace', 'Notes.docx');
    expect((await send('grace', created.id, notes())).statusCode).toBe(200);
    await readByTheWorker(created.id);
    const view = (await h.call('grace', 'GET', `/v1/imports/${created.id}`)).json<
      View & { identities: Json[]; references: Json[]; policy: string; policyApplied: boolean }
    >();
    expect(view.identities).toEqual([
      expect.objectContaining({ name: 'Ada', carries: ['changes'] }),
      expect.objectContaining({ name: 'Edsger', carries: ['comments'], match: 'none' }),
    ]);
    expect(view.references).toEqual([
      { key: 'wx-1', field: 'REF', text: 'Section 9', resolved: null },
    ]);
    expect(view).toMatchObject({ policy: 'map', policyApplied: false });
    const part = (
      await h.call('grace', 'GET', `/v1/imports/${created.id}/parts/${view.parts[0]!.id}`)
    ).json<{ suggestions: Json[]; threads: Json[]; references: string[]; blocks: Json[] }>();
    expect(part.suggestions).toEqual([
      { author: 'Ada', blocks: 1, text: expect.stringContaining('We saw three newts today') },
    ]);
    expect(part.threads).toEqual([
      {
        author: 'Edsger',
        text: 'Recount them.',
        quote: 'three newts',
        clamped: false,
        replies: [],
      },
    ]);
    expect(part.references).toEqual(['wx-1']);

    const refused = await h.call('grace', 'POST', `/v1/imports/${created.id}/accept`, {
      revision: await revisionOf('grace', created.id),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'import_references_unresolved' });
    const retargeted = await h.call('grace', 'POST', `/v1/imports/${created.id}/edits`, {
      revision: 0,
      edit: {
        edit: 'reference',
        reference: 'wx-1',
        to: { kind: 'block', block: part.blocks[0]!.id },
      },
    });
    expect(retargeted.statusCode, retargeted.body).toBe(200);
    const unknown = await h.call('grace', 'POST', `/v1/imports/${created.id}/edits`, {
      revision: 1,
      edit: { edit: 'identity', identity: 'Edsger', member: h.ids['grace'] },
    });
    expect(unknown.json()).toMatchObject({ code: 'import_edit_refused' });
    const accepted = await h.call('grace', 'POST', `/v1/imports/${created.id}/accept`, {
      revision: await revisionOf('grace', created.id),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ import: { policy: 'map', policyApplied: true } });
  });

  it("IMP-010 sets the environment's identity policy for imports, its administrator alone", async () => {
    expect((await h.call('grace', 'GET', '/v1/settings/import')).json()).toEqual({ policy: 'map' });
    expect(
      (await h.call('grace', 'PUT', '/v1/settings/import', { policy: 'keep' })).statusCode,
    ).toBe(403);
    const set = await h.call('ada', 'PUT', '/v1/settings/import', { policy: 'discard' });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({ policy: 'discard' });
    expect(
      (await h.call('ada', 'PUT', '/v1/settings/import', { policy: 'guess' })).statusCode,
    ).toBe(400);
    await h.call('ada', 'PUT', '/v1/settings/import', { policy: 'map' });
  });

  it('IMP-004 IMP-008 is proposed again at other levels, and abandoned leaving nothing', async () => {
    const created = await made('grace');
    await send('grace', created.id, word('Analysis', 'Ada counted newts.'));
    await readByTheWorker(created.id);
    const refused = await h.call('grace', 'PUT', `/v1/imports/${created.id}/levels`, {
      revision: await revisionOf('grace', created.id),
      section: 2,
      component: 2,
    });
    expect(refused.json()).toMatchObject({ code: 'import_levels_invalid' });
    const relevelled = await h.call('grace', 'PUT', `/v1/imports/${created.id}/levels`, {
      revision: await revisionOf('grace', created.id),
      section: 1,
      component: 3,
    });
    expect(relevelled.json()).toMatchObject({ state: 'reading', parts: [] });

    // The space's administrator abandons it; nothing of it is left, the file among it.
    const stored = await h.tenantDb.withTenant(h.tenant, (trx) =>
      readStoredImport(trx, created.id),
    );
    const abandoned = await h.call('ada', 'POST', `/v1/imports/${created.id}/abandon`);
    expect(abandoned.statusCode, abandoned.body).toBe(200);
    expect(abandoned.json()).toMatchObject({ state: 'abandoned', parts: [], report: [] });
    const store = await h.tenantDb.withTenant(h.tenant, (trx) => h.stores.forTenant(trx, h.tenant));
    await expect(store.get(stored!.objectKey!)).rejects.toThrow();
    expect(
      (await h.call('grace', 'POST', `/v1/imports/${created.id}/abandon`)).json(),
    ).toMatchObject({ code: 'import_not_open' });
  });

  it('IMP-036 IMP-037 says a file was imported before, shows what changed against the space as it is, and updates what it made as suggestions', async () => {
    const first = outline([
      [2, 'Sampling'],
      [null, 'Ada sampled the pond.'],
      [2, 'Analysis'],
      [null, 'Ada analysed.'],
      [2, 'Results'],
      [null, 'Three newts.'],
    ]);
    const earlier = await made('grace', 'Pond again.docx');
    await send('grace', earlier.id, first);
    await readByTheWorker(earlier.id);
    const accepted = await h.call('grace', 'POST', `/v1/imports/${earlier.id}/accept`, {
      revision: await revisionOf('grace', earlier.id),
      title: 'Pond again',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const { document } = accepted.json<{ document: string }>();
    const [sampling, analysis, results] = await h.tenantDb.withTenant(h.tenant, async (trx) =>
      (await importParts(trx, earlier.id)).map((part) => part.made!),
    );
    // Grace edits Analysis in the space after the import.
    await h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        const latest = (await latestVersion(trx, analysis!))!;
        const content = latest.content as ContentDocument;
        const recorded = await recordVersion(trx, {
          artifactId: analysis!,
          openedFrom: latest.id,
          author: h.ids.grace!,
          substance: {
            kind: 'component',
            content: {
              ...content,
              content: [
                {
                  ...content.content[0]!,
                  content: [{ type: 'text', value: 'Grace analysed again.', marks: [] }],
                } as ContentDocument['content'][number],
              ],
            },
            values: latest.values,
            notCarried: [],
            definitions: latest.definitions,
          },
        });
        expect(recorded.answer).toBe('recorded');
      },
      { actorKind: 'system' },
    );

    // Said first: by its name as it is made, by its bytes as they arrive, before the read.
    const said = {
      import: earlier.id,
      fileName: 'Pond again.docx',
      importer: h.ids.grace,
      document,
      documentTitle: 'Pond again',
    };
    const renamed = await made('grace', 'Renamed.docx');
    expect(renamed.recognised).toBeNull();
    const sameBytes = await send('grace', renamed.id, first);
    expect(sameBytes.json()).toMatchObject({
      state: 'reading',
      recognised: { ...said, match: 'hash' },
    });
    const second = await made('grace', 'Pond again.docx');
    expect(second.recognised).toMatchObject({ ...said, match: 'name' });
    await send(
      'grace',
      second.id,
      outline([
        [2, 'Sampling'],
        [null, 'Ada sampled the pond twice.'],
        [2, 'Discussion'],
        [null, 'Newts like ponds.'],
        [2, 'Analysis'],
        [null, 'Ada analysed.'],
      ]),
    );
    const kind = async (body: Json) =>
      h.call('grace', 'PUT', `/v1/imports/${second.id}/kind`, {
        revision: await revisionOf('grace', second.id),
        ...body,
      });
    expect((await kind({ kind: 'again', earlier: second.id })).json()).toMatchObject({
      code: 'import_earlier_invalid',
    });
    expect((await kind({ kind: 'again', earlier: earlier.id })).json()).toMatchObject({
      kind: 'again',
      earlier: earlier.id,
    });
    await readByTheWorker(second.id);

    const view = (await h.call('grace', 'GET', `/v1/imports/${second.id}`)).json<
      View & { parts: { id: string; again: Json | null }[]; gone: Json[]; revision: number }
    >();
    expect(view.parts.map((part) => [part.title, part.again])).toEqual([
      [
        'Sampling',
        { status: 'changed', component: sampling, componentTitle: 'Sampling', by: 'provenance' },
      ],
      ['Discussion', { status: 'new', component: null, componentTitle: null, by: null }],
      [
        'Analysis',
        { status: 'changed', component: analysis, componentTitle: 'Analysis', by: 'provenance' },
      ],
    ]);
    expect(view.gone).toEqual([{ component: results, title: 'Results' }]);
    // The diff is against the component as the space left it, Grace's edit shown.
    const part = await h.call(
      'grace',
      'GET',
      `/v1/imports/${second.id}/parts/${view.parts[2]!.id}`,
    );
    expect(part.json()).toMatchObject({
      diff: [
        { change: 'removed', text: 'Grace analysed again.' },
        { change: 'added', text: 'Ada analysed.' },
      ],
    });

    // Grace may not suggest on Sampling: it is skipped and said; the rest are suggested.
    await h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        const role = await createRole(trx, 'Suggests', ['suggest']);
        if (!('role' in role)) throw new Error(role.refused);
        await grant(trx, {
          roleId: role.role.id,
          subject: { principal: h.ids.grace! },
          level: { kind: 'artifact', id: sampling! },
          effect: 'deny',
          grantedBy: h.ids.ada!,
        });
      },
      { actorKind: 'system' },
    );
    const updated = await h.call('grace', 'POST', `/v1/imports/${second.id}/accept`, {
      revision: await revisionOf('grace', second.id),
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({
      document,
      import: {
        state: 'accepted',
        document,
        outcome: {
          suggested: [{ component: analysis }],
          made: [{ placed: true }],
          gone: [{ component: results, flagged: true }],
          skipped: [{ component: sampling, reason: 'suggest' }],
        },
      },
    });
    const suggestions = await h.call('grace', 'GET', `/v1/components/${analysis}/suggestions`);
    expect(suggestions.json<{ suggestions: unknown[] }>().suggestions).toHaveLength(1);
  });
});
