import { randomUUID } from 'node:crypto';
import { applyReturn, findRole } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

type Version = { id: string; number: string };

const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

/**
 * Translation's routes (the TR plan, TRa): Grace authors in General and Ada approves there; Alice reads
 * General alone; Ivy reads nothing.
 */
describe('translation (the TR plan, TRa)', () => {
  let h: Harness;

  /** A component of Grace's in General, approved by Ada: revision 1, so translatable. */
  const approvedComponent = async (title: string) => {
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/components`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
    const created = made.json<{ id: string; version: Version }>();
    // Its one block known by id, so a translation's changes can name it.
    const first = await cut('grace', created.id, created.version.id, [para('b1', title)], 'en-GB');
    expect(first.statusCode, first.body).toBe(200);
    const component = { id: created.id, version: first.json<{ version: Version }>().version };
    const moved = await h.call('grace', 'POST', `/v1/components/${component.id}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const passed = await h.call('ada', 'POST', `/v1/components/${component.id}/approvals`, {
      transition: 'approve',
      version: component.version.id,
      decision: 'approved',
    });
    expect(passed.statusCode, passed.body).toBe(200);
    return component;
  };

  /** One editing session on a line or the main line: claimed, saved and cut, as the editor does. */
  const cut = async (
    who: string,
    id: string,
    openedFrom: string,
    blocks: ReturnType<typeof para>[],
    language: string,
    extra: { line?: string; translates?: string; retranslate?: boolean } = {},
  ) => {
    const session = randomUUID();
    const line = extra.line === undefined ? {} : { line: extra.line };
    const claimed = await h.call(who, 'POST', `/v1/components/${id}/lock`, {
      session,
      move: true,
      ...line,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const saved = await h.call(who, 'PUT', `/v1/components/${id}/iterations/${session}/1`, {
      openedFrom,
      content: { schemaVersion: 1, title: 'Sampling', language, direction: 'ltr', content: blocks },
      ...line,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    return h.call(who, 'POST', `/v1/components/${id}/versions`, {
      session,
      openedFrom,
      ...line,
      ...(extra.translates === undefined ? {} : { translates: extra.translates }),
      ...(extra.retranslate === undefined ? {} : { retranslate: extra.retranslate }),
    });
  };

  beforeAll(async () => {
    h = await startHarness();
    const approver = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Approver'));
    await h.allow(h.ids.ada!, approver!.id, { kind: 'space', id: h.general });
    const publisher = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Publisher'));
    await h.allow(h.ids.ada!, publisher!.id, { kind: 'space', id: h.general });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('LOC-007 begins a translation by whoever may edit, lists it to any reader with its status, and LOC-013 records the source each cut translates', async () => {
    const component = await approvedComponent('Sampling');
    const begin = (who: string, language: string) =>
      h.call(who, 'POST', `/v1/components/${component.id}/translations`, { language });

    expect((await begin('alice', 'fr-FR')).statusCode).toBe(403);
    expect((await begin('ivy', 'fr-FR')).statusCode).toBe(404);
    expect((await begin('grace', 'en-GB')).json()).toMatchObject({
      code: 'translation_same_language',
    });
    expect((await begin('grace', 'French')).json()).toMatchObject({
      code: 'translation_language_invalid',
    });
    const begun = await begin('grace', 'fr-FR');
    expect(begun.statusCode, begun.body).toBe(200);
    const line = begun.json<{ line: string }>().line;
    expect(begun.json()).toEqual({
      line,
      language: 'fr-FR',
      head: null,
      translates: null,
      status: { status: 'untranslated' },
    });
    expect((await begin('grace', 'fr-FR')).json()).toMatchObject({ code: 'translation_exists' });

    // Opened on its line before anything is translated, it starts as the source in French.
    const opened = await h.call('alice', 'GET', `/v1/components/${component.id}?line=${line}`);
    expect(opened.json()).toMatchObject({
      content: { language: 'fr-FR' },
      line: { id: line, name: 'fr-FR' },
    });

    const french = [para('b1', 'Les étangs ont été échantillonnés.')];
    const unnamed = await cut('grace', component.id, component.version.id, french, 'fr-FR', {
      line,
    });
    expect(unnamed.json()).toMatchObject({ code: 'translation_source_required' });
    const translated = await cut('grace', component.id, component.version.id, french, 'fr-FR', {
      line,
      translates: component.version.id,
    });
    expect(translated.statusCode, translated.body).toBe(200);

    const listed = await h.call('alice', 'GET', `/v1/components/${component.id}/translations`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual({
      source: {
        language: 'en-GB',
        latest: { id: component.version.id, number: component.version.number },
        // What a translation is made against: the approved revision (the TR final review).
        from: { id: component.version.id, number: component.version.number },
      },
      translations: [
        {
          line,
          language: 'fr-FR',
          head: { id: expect.any(String), number: 'fr-FR 1.1' },
          translates: { id: component.version.id, number: component.version.number },
          status: { status: 'translated' },
          machine: null,
        },
      ],
    });
    expect(
      (await h.call('ivy', 'GET', `/v1/components/${component.id}/translations`)).statusCode,
    ).toBe(404);
    // Never compared with its source or brought back.
    expect(
      (
        await h.call('alice', 'GET', `/v1/components/${component.id}/lines/${line}/comparison`)
      ).json(),
    ).toMatchObject({ code: 'line_is_translation' });
  });

  it('LOC-015 LOC-031 goes out of date at a source cut that declares no retranslation, says so, is revised by whoever may edit, and LOC-040 names the source blocks changed', async () => {
    const component = await approvedComponent('Findings');
    const begun = await h.call('grace', 'POST', `/v1/components/${component.id}/translations`, {
      language: 'de-DE',
    });
    const line = begun.json<{ line: string }>().line;
    const german = await cut(
      'grace',
      component.id,
      component.version.id,
      [para('b1', 'Ergebnisse.')],
      'de-DE',
      { line, translates: component.version.id },
    );
    expect(german.statusCode, german.body).toBe(200);
    const typo = await cut(
      'grace',
      component.id,
      component.version.id,
      [para('b1', 'Findings, spelt right.')],
      'en-GB',
      { retranslate: false },
    );
    expect(typo.statusCode, typo.body).toBe(200);
    const source2 = typo.json<{ version: Version }>().version;

    const status = async () =>
      (await h.call('alice', 'GET', `/v1/components/${component.id}/translations`)).json<{
        translations: { status: unknown }[];
      }>().translations[0]?.status;
    expect(await status()).toEqual({ status: 'outOfDate', retranslate: false });

    const declare = (who: string, retranslate: boolean) =>
      h.call(who, 'PUT', `/v1/components/${component.id}/versions/${source2.id}/retranslate`, {
        retranslate,
      });
    expect((await declare('alice', true)).statusCode).toBe(403);
    expect((await declare('grace', true)).json()).toEqual({
      version: source2.id,
      retranslate: true,
    });
    expect(await status()).toEqual({ status: 'outOfDate', retranslate: true });

    const changes = await h.call(
      'alice',
      'GET',
      `/v1/components/${component.id}/translations/${line}/source-changes`,
    );
    expect(changes.json()).toEqual({
      translates: { id: component.version.id, number: component.version.number },
      current: { id: source2.id, number: source2.number },
      changes: [{ block: 'b1', change: 'changed', words: 'Findings, spelt right.' }],
    });

    // Marked current against a version of its source, and nothing else (the TR final review).
    const mark = (translates: string) =>
      h.call('grace', 'POST', `/v1/components/${component.id}/translations/${line}/current`, {
        translates,
      });
    expect((await mark(line)).json()).toMatchObject({ code: 'translation_source_invalid' });
    const marked = await mark(source2.id);
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json()).toMatchObject({
      translates: { id: source2.id },
      status: { status: 'translated' },
    });
  });

  it('LOC-040 opens an out-of-date translation from its earlier translation, not the changed source', async () => {
    const component = await approvedComponent('Ponds were netted.');
    const begun = await h.call('grace', 'POST', `/v1/components/${component.id}/translations`, {
      language: 'fr-FR',
    });
    const line = begun.json<{ line: string }>().line;
    const french = await cut(
      'grace',
      component.id,
      component.version.id,
      [para('b1', 'Les mares ont été filetées.')],
      'fr-FR',
      { line, translates: component.version.id },
    );
    expect(french.statusCode, french.body).toBe(200);
    const changed = await cut(
      'grace',
      component.id,
      component.version.id,
      [para('b1', 'Twelve ponds were netted.')],
      'en-GB',
    );
    expect(changed.statusCode, changed.body).toBe(200);

    const opened = await h.call('grace', 'GET', `/v1/components/${component.id}?line=${line}`);
    expect(opened.statusCode, opened.body).toBe(200);
    const read = opened.json<{
      version: Version;
      content: { language: string; content: unknown };
    }>();
    expect(read.version.id).toBe(french.json<{ version: Version }>().version.id);
    expect(read.content).toMatchObject({
      language: 'fr-FR',
      content: [{ id: 'b1', content: [{ value: 'Les mares ont été filetées.' }] }],
    });
  });

  it('LOC-010 publishes a document in a language through the API, a component without a translation reported, and LOC-037 refused as the document says; LOC-016 each reference says its translations', async () => {
    const translatedOne = await approvedComponent('Methods');
    const begun = await h.call('grace', 'POST', `/v1/components/${translatedOne.id}/translations`, {
      language: 'fr-FR',
    });
    const line = begun.json<{ line: string }>().line;
    const french = await cut(
      'grace',
      translatedOne.id,
      translatedOne.version.id,
      [para('b1', 'Méthodes.')],
      'fr-FR',
      { line, translates: translatedOne.version.id },
    );
    expect(french.statusCode, french.body).toBe(200);
    const untranslated = await approvedComponent('Discussion');

    const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/documents`, {
      title: 'Pond survey',
      language: 'en-GB',
      direction: 'ltr',
    });
    let doc = made.json<{ id: string; version: { id: string } }>();
    for (const [position, component] of [translatedOne.id, untranslated.id].entries()) {
      const placed = await h.call('ada', 'POST', `/v1/documents/${doc.id}/outline`, {
        openedFrom: doc.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position,
          node: { type: 'reference', component, mode: { kind: 'latest' } },
        },
      });
      expect(placed.statusCode, placed.body).toBe(200);
      doc = placed.json();
    }
    const nodes = (await h.call('ada', 'GET', `/v1/documents/${doc.id}`)).json<{
      outline: { nodes: { id: string }[] };
    }>().outline.nodes;

    const publish = (version: string, language: string) =>
      h.call('ada', 'POST', `/v1/documents/${doc.id}/publications`, {
        version,
        formats: ['pdf'],
        language,
      });
    const asked = await publish(doc.version.id, 'fr-FR');
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json()).toMatchObject({
      failures: [],
      warnings: [
        { code: 'component_untranslated', node: nodes[1]!.id, language: 'en-GB' },
        { code: 'title_untranslated', node: null },
      ],
    });
    expect((await publish(doc.version.id, 'es-ES')).json()).toMatchObject({
      code: 'layout_language',
    });
    // A language that is no BCP 47 tag is refused at the door, recording nothing.
    expect((await publish(doc.version.id, 'French')).statusCode).toBe(400);

    // Each reference says its component's translations, and the space reports them (TR-M).
    const texts = await h.call('alice', 'GET', `/v1/documents/${doc.id}/texts`);
    expect(texts.statusCode, texts.body).toBe(200);
    const rows = texts.json<{ occurrences: { node: string; translations?: unknown }[] }>()
      .occurrences;
    expect(rows.find((each) => each.node === nodes[0]!.id)?.translations).toEqual([
      { language: 'fr-FR', status: 'translated' },
    ]);
    expect(rows.find((each) => each.node === nodes[1]!.id)).not.toHaveProperty('translations');
    const report = await h.call('alice', 'GET', `/v1/spaces/${h.general}/translations`);
    expect(report.statusCode, report.body).toBe(200);
    expect(
      report
        .json<{ items: { component: { id: string } }[] }>()
        .items.map((each) => each.component.id),
    ).toContain(translatedOne.id);
    expect(
      report
        .json<{ items: { component: { id: string } }[] }>()
        .items.map((each) => each.component.id),
    ).not.toContain(untranslated.id);
    expect(
      (await h.call('ivy', 'GET', `/v1/spaces/${h.general}/translations`)).statusCode,
    ).toBeGreaterThanOrEqual(403);

    // The environment's policy, read by anybody signed in and set by an administrator.
    expect((await h.call('alice', 'GET', '/v1/settings/translation')).json()).toEqual({
      fallback: 'source',
      outOfDate: 'publish',
      note: {},
      conflict: 'review',
      machine: 'off',
    });
    expect(
      (
        await h.call('alice', 'PUT', '/v1/settings/translation', {
          fallback: 'refuse',
          outOfDate: 'publish',
          note: {},
        })
      ).statusCode,
    ).toBe(403);

    // The document's own fallback refuses where the environment's falls back.
    const refusing = await h.call('ada', 'PUT', `/v1/documents/${doc.id}/translation-fallback`, {
      openedFrom: doc.version.id,
      fallback: 'refuse',
    });
    expect(refusing.statusCode, refusing.body).toBe(200);
    const refused = await publish(refusing.json<{ version: { id: string } }>().version.id, 'fr-FR');
    expect(refused.json()).toMatchObject({
      failures: [{ code: 'occurrence_untranslated', node: nodes[1]!.id }],
    });
  });

  it('LOC-016 says a component’s translation status where it is listed and found, and reports a space’s a page at a time, filtered, to nobody who may not read it', async () => {
    const component = await approvedComponent('Quillwort');
    const alone = await approvedComponent('Quillwort rushes');
    const begin = async (language: string) =>
      (
        await h.call('grace', 'POST', `/v1/components/${component.id}/translations`, { language })
      ).json<{ line: string }>().line;
    const french = await begin('fr-FR');
    await begin('nl-NL');
    const translated = await cut(
      'grace',
      component.id,
      component.version.id,
      [para('b1', 'Isoète.')],
      'fr-FR',
      { line: french, translates: component.version.id },
    );
    expect(translated.statusCode, translated.body).toBe(200);
    const said = [
      { language: 'fr-FR', status: 'translated' },
      { language: 'nl-NL', status: 'untranslated' },
    ];

    type Listed = { items: { id: string; translations?: unknown }[] };
    const listed = (
      await h.call('alice', 'GET', `/v1/components?spaces=${h.general}&limit=100`)
    ).json<Listed>().items;
    expect(listed.find((each) => each.id === component.id)?.translations).toEqual(said);
    expect(listed.find((each) => each.id === alone.id)).not.toHaveProperty('translations');

    type Found = { items: { kind: string; artifactId: string; translations?: unknown }[] };
    const found = (await h.call('alice', 'GET', '/v1/search?q=quillwort')).json<Found>().items;
    expect(
      found.find((each) => each.kind === 'component' && each.artifactId === component.id)
        ?.translations,
    ).toEqual(said);
    expect(
      found.find((each) => each.kind === 'component' && each.artifactId === alone.id),
    ).not.toHaveProperty('translations');
    expect(
      (await h.call('ivy', 'GET', '/v1/search?q=quillwort')).json<Found>().items ?? [],
    ).toEqual([]);

    // The report, filtered before it is paged, a cursor read back only in its own language.
    const report = (query: string, language = 'en-GB') =>
      h.app.inject({
        method: 'GET',
        url: `/v1/spaces/${h.general}/translations${query}`,
        headers: { host: HOST, cookie: h.cookies.alice!, 'accept-language': language },
      });
    type Report = {
      items: { component: { id: string }; translations: { language: string }[] }[];
      next: string | null;
    };
    const dutch = (await report('?language=nl-NL')).json<Report>();
    expect(dutch.items.map((each) => each.component.id)).toEqual([component.id]);
    expect(dutch.items[0]!.translations.map((each) => each.language)).toEqual(['nl-NL']);
    expect(
      (await report('?status=machineDrafted'))
        .json<Report>()
        .items.map((each) => each.component.id),
    ).not.toContain(component.id);
    const first = (await report('?limit=1')).json<Report>();
    expect(first.items).toHaveLength(1);
    expect(first.next).not.toBeNull();
    expect((await report(`?limit=1&cursor=${first.next}`)).statusCode).toBe(200);
    expect((await report(`?limit=1&cursor=${first.next}`, 'ar-XB')).statusCode).toBe(400);
    expect((await report('?status=lost')).statusCode).toBe(400);
  });

  it('LOC-036 keeps the policy’s history, each change whole by whom and when, listed a page at a time to an administrator alone', async () => {
    type History = {
      items: { id: string; at: string; by: { id: string } | null; policy: { fallback: string } }[];
      next: string | null;
    };
    const before = (
      await h.call('ada', 'GET', '/v1/settings/translation/history?limit=100')
    ).json<History>().items.length;
    const set = (fallback: string) =>
      h.call('ada', 'PUT', '/v1/settings/translation', {
        fallback,
        outOfDate: 'publish',
        note: {},
      });
    expect((await set('refuse')).statusCode).toBe(200);
    // Unchanged, no row; changed back, one.
    expect((await set('refuse')).statusCode).toBe(200);
    expect((await set('source')).statusCode).toBe(200);
    const listed = await h.call('ada', 'GET', '/v1/settings/translation/history?limit=100');
    expect(listed.statusCode, listed.body).toBe(200);
    const items = listed.json<History>().items;
    expect(items).toHaveLength(before + 2);
    expect(items.slice(0, 2).map((each) => [each.policy.fallback, each.by?.id])).toEqual([
      ['source', h.ids.ada],
      ['refuse', h.ids.ada],
    ]);
    expect(items.at(-1)!.by).toBeNull();
    const first = (
      await h.call('ada', 'GET', '/v1/settings/translation/history?limit=1')
    ).json<History>();
    expect(first.items.map((each) => each.id)).toEqual([items[0]!.id]);
    const second = await h.call(
      'ada',
      'GET',
      `/v1/settings/translation/history?limit=1&cursor=${first.next}`,
    );
    expect(second.json<History>().items.map((each) => each.id)).toEqual([items[1]!.id]);
    expect(
      (await h.call('ada', 'GET', '/v1/settings/translation/history?cursor=nonsense')).statusCode,
    ).toBe(400);
    expect((await h.call('alice', 'GET', '/v1/settings/translation/history')).statusCode).toBe(403);
  });

  it("LOC-018 LOC-033 sends a document's components needing a language as a job, tracked item by item, downloaded as XLIFF 2.1, and closed", async () => {
    const first = await approvedComponent('Ponds');
    const second = await approvedComponent('Streams');
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/documents`, {
      title: 'Water survey',
      language: 'en-GB',
      direction: 'ltr',
    });
    let doc = made.json<{ id: string; version: { id: string } }>();
    for (const [position, component] of [first.id, second.id].entries()) {
      const placed = await h.call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
        openedFrom: doc.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position,
          node: { type: 'reference', component, mode: { kind: 'latest' } },
        },
      });
      expect(placed.statusCode, placed.body).toBe(200);
      doc = placed.json();
    }
    const send = (who: string, language = 'de-DE') =>
      h.call(who, 'POST', `/v1/documents/${doc.id}/translation-jobs`, {
        language,
        vendor: 'Babel Ltd',
      });

    expect((await send('alice')).statusCode).toBe(403);
    expect((await send('ivy')).statusCode).toBe(404);
    expect((await send('grace', 'German')).json()).toMatchObject({
      code: 'translation_language_invalid',
    });
    const sent = await send('grace');
    expect(sent.statusCode, sent.body).toBe(200);
    const job = sent.json<{ id: string; items: { line: string }[] }>();
    expect(job).toMatchObject({
      language: 'de-DE',
      vendor: 'Babel Ltd',
      closed: null,
      items: [
        {
          component: { id: first.id, title: 'Sampling' },
          source: { id: first.version.id, number: first.version.number },
          notSent: null,
          outcome: null,
        },
        {
          component: { id: second.id, title: 'Sampling' },
          source: { id: second.version.id, number: second.version.number },
          notSent: null,
          outcome: null,
        },
      ],
    });
    // Held out, and so sent to no second job.
    const translations = await h.call('alice', 'GET', `/v1/components/${first.id}/translations`);
    expect(translations.json()).toMatchObject({
      translations: [{ language: 'de-DE', status: { status: 'inTranslation' } }],
    });
    expect((await send('grace')).json()).toMatchObject({ code: 'translation_nothing_to_send' });
    const listed = await h.call('alice', 'GET', `/v1/documents/${doc.id}/translation-jobs`);
    expect(listed.json()).toMatchObject({ jobs: [{ id: job.id }] });

    const file = `/v1/documents/${doc.id}/translation-jobs/${job.id}/file`;
    expect((await h.call('alice', 'GET', file)).statusCode).toBe(403);
    const downloaded = await h.call('grace', 'GET', file);
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.headers['content-type']).toContain('application/xliff+xml');
    expect(downloaded.headers['content-disposition']).toContain(`translation-${job.id}-de-DE.xlf`);
    expect(downloaded.body).toContain('version="2.1" srcLang="en-GB" trgLang="de-DE"');
    expect(downloaded.body).toContain(`<file id="f.${first.id}" original="component:${first.id}">`);
    expect(downloaded.body).toContain('<unit id="b.b1"><segment><source>Streams</source>');
    expect(
      (
        await h.call(
          'grace',
          'GET',
          `/v1/documents/${doc.id}/translation-jobs/${randomUUID()}/file`,
        )
      ).statusCode,
    ).toBe(404);

    const close = () =>
      h.call('grace', 'POST', `/v1/documents/${doc.id}/translation-jobs/${job.id}/close`);
    const closed = await close();
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({ closed: { by: h.ids.grace } });
    expect((await close()).json()).toMatchObject({ code: 'translation_job_closed' });
    const after = await h.call('alice', 'GET', `/v1/components/${first.id}/translations`);
    expect(after.json()).toMatchObject({
      translations: [{ language: 'de-DE', status: { status: 'untranslated' } }],
    });
  });

  it('LOC-033 LOC-035 takes a returned file for the worker, and a translation whose source moved since is held for a person, shown beside the changes, and decided', async () => {
    const source = await approvedComponent('Lakes');
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/documents`, {
      title: 'Lake survey',
      language: 'en-GB',
      direction: 'ltr',
    });
    const doc = made.json<{ id: string; version: { id: string } }>();
    const placed = await h.call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
      openedFrom: doc.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: source.id, mode: { kind: 'latest' } },
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const sent = await h.call('grace', 'POST', `/v1/documents/${doc.id}/translation-jobs`, {
      language: 'de-DE',
    });
    const job = sent.json<{ id: string }>();
    const jobs = `/v1/documents/${doc.id}/translation-jobs/${job.id}`;

    const put = (who: string, body: Buffer, type = 'application/octet-stream') =>
      h.app.inject({
        method: 'PUT',
        url: `${jobs}/return`,
        headers: { host: HOST, cookie: h.cookies[who]!, 'content-type': type },
        payload: body,
      });
    const file = Buffer.from('<xliff version="2.1"/>');
    expect((await put('alice', file)).statusCode).toBe(403);
    expect((await put('grace', file, 'text/plain')).statusCode).toBe(415);
    const returned = await put('grace', file);
    expect(returned.statusCode, returned.body).toBe(200);
    const view = returned.json<{ returns: { id: string; state: string }[] }>();
    expect(view.returns).toMatchObject([{ state: 'reading', by: h.ids.grace }]);

    // The source approved again since, and the file read back as the worker reads it.
    const revised = await cut(
      'grace',
      source.id,
      source.version.id,
      [para('b1', 'Lakes, twice.')],
      'en-GB',
    );
    const version = revised.json<{ version: { id: string } }>().version;
    await h.call('grace', 'POST', `/v1/components/${source.id}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    await h.call('ada', 'POST', `/v1/components/${source.id}/approvals`, {
      transition: 'approve',
      version: version.id,
      decision: 'approved',
    });
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      applyReturn(trx, {
        id: view.returns[0]!.id,
        target: 'de-DE',
        files: new Map([
          [`f.${source.id}`, new Map([['b.b1', [{ kind: 'text', text: 'Seen.' }]]])],
        ]),
        mayEdit: async () => true,
      }),
    );

    const held = await h.call('grace', 'GET', `${jobs}/items/${source.id}/held`);
    expect(held.statusCode, held.body).toBe(200);
    expect(held.json()).toMatchObject({
      sent: { id: source.version.id },
      current: { id: version.id },
      changes: [{ block: 'b1', change: 'changed', words: 'Lakes, twice.' }],
      returned: [{ block: 'b1', words: 'Seen.' }],
      offered: 'review',
    });
    expect((await h.call('alice', 'GET', `${jobs}/items/${source.id}/held`)).statusCode).toBe(403);

    const decide = (who: string, decision: string) =>
      h.call(who, 'POST', `${jobs}/items/${source.id}/decision`, { decision });
    expect((await decide('alice', 'accept')).statusCode).toBe(403);
    const accepted = await decide('grace', 'accept');
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ items: [{ outcome: 'returned' }] });
    const translations = await h.call('alice', 'GET', `/v1/components/${source.id}/translations`);
    expect(translations.json()).toMatchObject({
      translations: [{ language: 'de-DE', status: { status: 'outOfDate' } }],
    });
    expect((await decide('grace', 'reject')).statusCode).toBe(404);

    await h.call('grace', 'POST', `${jobs}/close`);
    expect((await put('grace', file)).json()).toMatchObject({ code: 'translation_job_closed' });
  });

  it('keeps a lock per line: the author and a translator hold one each, at once', async () => {
    const component = await approvedComponent('Abstract');
    const begun = await h.call('grace', 'POST', `/v1/components/${component.id}/translations`, {
      language: 'fr-FR',
    });
    const line = begun.json<{ line: string }>().line;
    const author = await h.call('grace', 'POST', `/v1/components/${component.id}/lock`, {
      session: randomUUID(),
      move: true,
    });
    expect(author.statusCode, author.body).toBe(200);
    const translator = await h.call('ada', 'POST', `/v1/components/${component.id}/lock`, {
      session: randomUUID(),
      line,
    });
    expect(translator.statusCode, translator.body).toBe(200);
    const onLine = await h.call('alice', 'GET', `/v1/components/${component.id}?line=${line}`);
    expect(onLine.json()).toMatchObject({ lock: { holder: { id: h.ids.ada } } });
  });
});
