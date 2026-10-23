import { randomUUID } from 'node:crypto';
import { findRole } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

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
      },
      translations: [
        {
          line,
          language: 'fr-FR',
          head: { id: expect.any(String), number: 'fr-FR 1.1' },
          translates: { id: component.version.id, number: component.version.number },
          status: { status: 'translated' },
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

    // Marked current against the source it was shown, and against no older one.
    const mark = (translates: string) =>
      h.call('grace', 'POST', `/v1/components/${component.id}/translations/${line}/current`, {
        translates,
      });
    expect((await mark(component.version.id)).json()).toMatchObject({
      code: 'translation_source_stale',
    });
    const marked = await mark(source2.id);
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json()).toMatchObject({
      translates: { id: source2.id },
      status: { status: 'translated' },
    });
  });

  it('LOC-010 publishes a document in a language through the API, a component without a translation reported, and LOC-037 refused as the document says', async () => {
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
      warnings: [{ code: 'component_untranslated', node: nodes[1]!.id, language: 'en-GB' }],
    });
    expect((await publish(doc.version.id, 'es-ES')).json()).toMatchObject({
      code: 'layout_language',
    });
    // A language that is no BCP 47 tag is refused at the door, recording nothing.
    expect((await publish(doc.version.id, 'French')).statusCode).toBe(400);

    // The environment's policy, read by anybody signed in and set by an administrator.
    expect((await h.call('alice', 'GET', '/v1/settings/translation')).json()).toEqual({
      fallback: 'source',
      outOfDate: 'publish',
      note: {},
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
