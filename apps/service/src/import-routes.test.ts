import { randomBytes } from 'node:crypto';
import { readImport as readStoredImport, recordProposal } from '@alloy-works/db';
import { DEFAULT_IMPORT_LEVELS, blockIdentifierFrom, proposeImport } from '@alloy-works/domain';
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
  parts: { kind: string; title: string; reason: Json; source: string }[];
  report: { subject: string; detail?: string }[];
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
        const { parts } = proposeImport(read.flow, DEFAULT_IMPORT_LEVELS, {
          language: 'en',
          direction: 'ltr',
          newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
        });
        await recordProposal(trx, id, { parts, report: read.report, title: null, language: null });
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
      title: 'Pond survey',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const { document } = accepted.json<{ document: string; import: View }>();
    expect(accepted.json()).toMatchObject({ import: { state: 'accepted', document } });
    const opened = await h.call('grace', 'GET', `/v1/documents/${document}`);
    expect(opened.statusCode, opened.body).toBe(200);
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
    expect((await h.call('ada', 'POST', `/v1/imports/${created.id}/accept`, {})).statusCode).toBe(
      404,
    );
  });

  it('IMP-004 IMP-008 is proposed again at other levels, and abandoned leaving nothing', async () => {
    const created = await made('grace');
    await send('grace', created.id, word('Analysis', 'Ada counted newts.'));
    await readByTheWorker(created.id);
    const refused = await h.call('grace', 'PUT', `/v1/imports/${created.id}/levels`, {
      section: 2,
      component: 2,
    });
    expect(refused.json()).toMatchObject({ code: 'import_levels_invalid' });
    const relevelled = await h.call('grace', 'PUT', `/v1/imports/${created.id}/levels`, {
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
});
