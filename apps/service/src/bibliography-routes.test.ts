import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

const dunnart = {
  type: 'article-journal',
  title: 'The Dunnart in Winter',
  author: [{ family: 'Smith', given: 'Ada' }],
  issued: { 'date-parts': [[2020]] },
  DOI: '10.1234/dunnart.2020',
};

interface View {
  id: string;
  version: { id: string; number: string };
  entry: { key: string; csl: Json };
  archived: boolean;
  mayEdit: boolean;
  mayRetire: boolean;
}

describe('the bibliography routes (the CI plan, CI-B, CI-C)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const make = (by: string, entry: Json, despiteMatches?: boolean) =>
    h.call(by, 'POST', `/v1/spaces/${h.general}/bibliography-entries`, {
      entry,
      ...(despiteMatches === undefined ? {} : { despiteMatches }),
    });

  it('LIB-044 makes an entry in a space, and offers the one already there rather than refusing', async () => {
    const made = await make('grace', { csl: dunnart });
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<{ entry: View; matches: unknown[] }>();
    expect(view.matches).toEqual([]);
    expect(view.entry.entry.key).toBe('smith2020');
    expect(view.entry.version.number).toBe('0.1');
    expect(view.entry.mayEdit).toBe(true);

    const again = await make('grace', {
      csl: { ...dunnart, DOI: 'https://doi.org/10.1234/DUNNART.2020' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      entry: null,
      matches: [{ by: 'doi', entry: { id: view.entry.id, key: 'smith2020' } }],
    });
    const despite = await make('grace', { csl: dunnart }, true);
    expect(despite.json()).toMatchObject({ entry: { entry: { key: 'smith2020a' } } });

    // A reader may read it and not make one; nobody else sees it.
    expect(
      (await h.call('alice', 'GET', `/v1/bibliography-entries/${view.entry.id}`)).statusCode,
    ).toBe(200);
    expect((await make('alice', { csl: dunnart })).statusCode).toBe(403);
    expect(
      (await h.call('ivy', 'GET', `/v1/bibliography-entries/${view.entry.id}`)).statusCode,
    ).toBe(404);
  });

  it('LIB-008 refuses a field beyond CSL by name', async () => {
    const refused = await make('grace', { csl: { ...dunnart, rating: 5 } });
    expect(refused.statusCode).toBe(400);
  });

  it('LIB-046 cuts a version keeping the key, and lists the space by key', async () => {
    const made = (
      await make('grace', { csl: { type: 'book', title: 'Quolls', ISBN: '978-1-56619-909-4' } })
    ).json<{
      entry: View;
    }>().entry;
    const next = await h.call('grace', 'POST', `/v1/bibliography-entries/${made.id}/versions`, {
      openedFrom: made.version.id,
      entry: { csl: { type: 'book', title: 'Quolls of the North', ISBN: '978-1-56619-909-4' } },
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json<View>()).toMatchObject({
      version: { number: '0.2' },
      entry: { key: 'quolls' },
    });
    const listed = await h.call('alice', 'GET', `/v1/spaces/${h.general}/bibliography-entries`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: { key: string }[] }>().items.map((each) => each.key)).toEqual([
      'quolls',
      'smith2020',
      'smith2020a',
    ]);
  });

  it('IMP-014 imports BibTeX, merging a match and saying what it merged, and exports as RIS', async () => {
    const imported = await h.call(
      'grace',
      'POST',
      `/v1/spaces/${h.general}/bibliography-entries/import`,
      {
        format: 'bibtex',
        text: [
          '@article{x, title={The dunnart in winter}, doi={10.1234/dunnart.2020}, volume={12}}',
          '@book{y, title={Numbats}, author={Okafor, Grace}, year={2021}}',
        ].join('\n'),
      },
    );
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json<{ records: Json[] }>().records).toMatchObject([
      { outcome: 'merged', by: 'doi', merged: ['volume'], entry: { key: 'smith2020' } },
      { outcome: 'created', by: null, merged: [], entry: { key: 'okafor2021' } },
    ]);
    const unreadable = await h.call(
      'grace',
      'POST',
      `/v1/spaces/${h.general}/bibliography-entries/import`,
      {
        format: 'csl-json',
        text: '{not json',
      },
    );
    expect(unreadable.statusCode).toBe(400);
    expect(unreadable.json()).toMatchObject({ code: 'import_unreadable' });
    // More records than one import takes: refused before any is written.
    const before = await h.call('grace', 'GET', `/v1/spaces/${h.general}/bibliography-entries`);
    const many = await h.call(
      'grace',
      'POST',
      `/v1/spaces/${h.general}/bibliography-entries/import`,
      {
        format: 'csl-json',
        text: JSON.stringify(
          Array.from({ length: 501 }, (_, n) => ({ type: 'book', title: `Numbats ${n}` })),
        ),
      },
    );
    expect(many.statusCode).toBe(400);
    expect(many.json()).toMatchObject({ code: 'import_too_many' });
    const after = await h.call('grace', 'GET', `/v1/spaces/${h.general}/bibliography-entries`);
    expect(after.json<{ total: number }>().total).toBe(before.json<{ total: number }>().total);

    const exported = await h.call(
      'alice',
      'GET',
      `/v1/spaces/${h.general}/bibliography-entries/export?format=ris`,
    );
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.json<{ text: string }>().text).toMatch(/^ID {2}- okafor2021/m);
  });

  it('lists where an entry is cited, and refuses to archive it while it is', async () => {
    const entry = (await make('grace', { csl: { type: 'book', title: 'Wombat Ways' } })).json<{
      entry: View;
    }>().entry;
    const component = await h.component(h.general, 'The wombat section');
    await h.place(component, { type: 'citation', entry: entry.id });
    const uses = await h.call('alice', 'GET', `/v1/bibliography-entries/${entry.id}/uses`);
    expect(uses.statusCode, uses.body).toBe(200);
    expect(uses.json()).toEqual({
      components: { named: [{ id: component.id, title: 'Readings' }], unreadable: false },
      baselines: { named: [], unreadable: false },
    });
    const archived = await h.call('ada', 'POST', `/v1/bibliography-entries/${entry.id}/archive`);
    expect(archived.statusCode).toBe(409);
    expect(archived.json()).toMatchObject({ code: 'entry_cited' });
    // Grace authors but may not retire.
    const free = (await make('grace', { csl: { type: 'book', title: 'Echidnas' } })).json<{
      entry: View;
    }>().entry;
    expect(
      (await h.call('grace', 'POST', `/v1/bibliography-entries/${free.id}/archive`)).statusCode,
    ).toBe(403);
    const done = await h.call('ada', 'POST', `/v1/bibliography-entries/${free.id}/archive`);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toEqual({ archived: true });
    expect(
      (await h.call('ada', 'POST', `/v1/bibliography-entries/${free.id}/unarchive`)).json(),
    ).toEqual({ archived: false });
  });
});
