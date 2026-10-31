import { randomUUID } from 'node:crypto';
import { recordVersion, substanceOf, readVersion } from '@alloy-works/db';
import type { ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

/**
 * Citing in the editor (the CI plan, CId, CI-H): a save refusing a citation of no entry its author may
 * read in the component's space, and the in-text forms the editor shows, rendered here. Ada reads
 * everything; Grace authors General alone; Ivy reads nothing.
 */
describe('citing (the CI plan, CId)', () => {
  let h: Harness;
  let general: string;
  let quality: string;

  const entry = async (space: string, csl: Record<string, unknown>) => {
    const made = await h.call('ada', 'POST', `/v1/spaces/${space}/bibliography-entries`, {
      entry: { csl },
      despiteMatches: true,
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ entry: { id: string } }>().entry.id;
  };

  beforeAll(async () => {
    h = await startHarness();
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    general = await entry(h.general, {
      type: 'book',
      title: 'Sediment and its movement',
      author: [{ family: 'Marlow', given: 'Ada' }],
      issued: { 'date-parts': [[2020]] },
      publisher: 'Harbour Press',
    });
    quality = await entry(h.quality, {
      type: 'book',
      title: 'Salt marshes',
      author: [{ family: 'Penhallow', given: 'Grace' }],
      issued: { 'date-parts': [[2018]] },
      publisher: 'Fenland Press',
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  /** Saves one paragraph of these inlines as `as`, from the component's version, and answers it. */
  const save = async (
    as: string,
    component: { id: string; version: string },
    inlines: unknown[],
  ) => {
    const session = randomUUID();
    const claimed = await h.call(as, 'POST', `/v1/components/${component.id}/lock`, {
      session,
      move: true,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const saved = await h.call(
      as,
      'PUT',
      `/v1/components/${component.id}/iterations/${session}/1`,
      {
        openedFrom: component.version,
        content: {
          schemaVersion: 1,
          title: 'Readings',
          language: 'en-GB',
          direction: 'ltr',
          content: [{ type: 'paragraph', id: 'p1', style: 'body', content: inlines }],
        },
      },
    );
    const released = await h.call(
      as,
      'DELETE',
      `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version}`,
    );
    if (saved.statusCode === 200) {
      component.version = released.json<{ version: { id: string } }>().version.id;
    }
    return saved;
  };

  const cite = (entry: string) => ({ type: 'citation', entry });
  const refer = (entry: string) => ({
    type: 'crossReference',
    id: 'x1',
    target: { kind: 'entry', entry },
    display: 'number',
  });

  it("CNT-051 refuses a save whose new citation names no entry of the component's space its author may read", async () => {
    const component = await h.component(h.general, 'The sediment section');
    // An entry of the space Grace reads: saved.
    expect((await save('grace', component, [cite(general)])).statusCode).toBe(200);
    // One of a space she may not read, one of no space at all, and a cross-reference to either.
    for (const each of [
      cite(quality),
      cite('00000000-0000-4000-8000-0000000000aa'),
      refer(quality),
    ]) {
      const refused = await save('grace', component, [each]);
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json()).toMatchObject({ code: 'citation_unreadable' });
      expect(refused.body).not.toContain('Salt marshes');
    }
    // Ada reads Quality, and is still refused one of its entries in a General component.
    const adas = await save('ada', component, [cite(quality)]);
    expect(adas.statusCode, adas.body).toBe(400);
  });

  it("CNT-051 saves a cross-reference to an entry of the component's space, the version holding it", async () => {
    const component = await h.component(h.general, 'The referring section');
    const saved = await save('grace', component, [
      { type: 'text', value: 'See ', marks: [] },
      refer(general),
    ]);
    expect(saved.statusCode, saved.body).toBe(200);
    const held = await h.tenantDb.withTenant(h.tenant, (trx) =>
      readVersion(trx, component.version),
    );
    expect(held?.content).toMatchObject({
      content: [
        { content: [{}, { type: 'crossReference', target: { kind: 'entry', entry: general } }] },
      ],
    });
  });

  it('leaves a citation the version it opened from already held alone, readable or not', async () => {
    const component = await h.component(h.general, 'The marsh section');
    // Carried in from Quality, as a component moved between spaces keeps its citations (CI-B).
    component.version = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const opened = (await readVersion(trx, component.version))!;
      const substance = substanceOf(opened);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content = {
        ...substance.content,
        content: [{ type: 'paragraph', id: 'p1', style: 'body', content: [cite(quality)] }],
      } as ContentDocument;
      const next = await recordVersion(trx, {
        artifactId: component.id,
        openedFrom: opened.id,
        author: h.ids.ada!,
        substance: { ...substance, content },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version.id;
    });
    const saved = await save('grace', component, [
      { type: 'text', value: 'Marshes ', marks: [] },
      cite(quality),
    ]);
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it("renders a component's citations in their in-text form for the editor, and none whose entry its reader may not read", async () => {
    const component = await h.component(h.general, 'The preview section');
    const asked = {
      citations: [{ entry: general }, { entry: general, locator: 'p. 12' }, { entry: quality }],
    };
    const shown = await h.call(
      'grace',
      'POST',
      `/v1/components/${component.id}/citations/preview`,
      asked,
    );
    expect(shown.statusCode, shown.body).toBe(200);
    const { forms } = shown.json<{ forms: (string | null)[] }>();
    // The default theme names Harvard: author and year, the locator after them.
    expect(forms[0]).toMatch(/Marlow.*2020/);
    expect(forms[1]).toMatch(/Marlow.*2020.*12/);
    expect(forms[2]).toBeNull();
    // A reader of nothing is told nothing of the component.
    const ivy = await h.call(
      'ivy',
      'POST',
      `/v1/components/${component.id}/citations/preview`,
      asked,
    );
    expect(ivy.statusCode).toBe(404);
  });

  it("renders in a document's style only for a document placing the component", async () => {
    const component = await h.component(h.general, 'The placed section');
    const elsewhere = await h.component(h.general, 'The other section');
    const document = await h.documentReferencing([elsewhere.id]);
    const asked = (id: string) =>
      h.call('grace', 'POST', `/v1/components/${id}/citations/preview`, {
        citations: [{ entry: general }],
        document: document.id,
      });
    expect((await asked(component.id)).statusCode).toBe(404);
    const placed = await asked(elsewhere.id);
    expect(placed.statusCode, placed.body).toBe(200);
    expect(placed.json<{ forms: (string | null)[] }>().forms[0]).toMatch(/Marlow.*2020/);
  });

  it('CNT-051 refuses restoring a version that cites an entry its restorer may not read', async () => {
    const component = await h.component(h.general, 'The restored section');
    // A version citing Quality's entry, carried in, then one that does not.
    const [cited, latest] = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const cut = async (from: string, inlines: unknown[]) => {
        const opened = (await readVersion(trx, from))!;
        const substance = substanceOf(opened);
        if (substance.kind !== 'component') throw new Error('not a component');
        const content = {
          ...substance.content,
          content: [{ type: 'paragraph', id: 'p1', style: 'body', content: inlines }],
        } as ContentDocument;
        const next = await recordVersion(trx, {
          artifactId: component.id,
          openedFrom: opened.id,
          author: h.ids.ada!,
          substance: { ...substance, content },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        return next.version.id;
      };
      const first = await cut(component.version, [cite(quality)]);
      return [first, await cut(first, [{ type: 'text', value: 'Plain', marks: [] }])] as const;
    });
    const path = `/v1/components/${component.id}/versions/${cited}`;
    const previewed = await h.call('grace', 'GET', `${path}/restoration`);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.json()).toMatchObject({ refusals: [{ code: 'citation_unreadable' }] });
    const restored = await h.call('grace', 'POST', `${path}/restore`, { latest });
    expect(restored.statusCode, restored.body).toBe(400);
    expect(restored.json()).toMatchObject({ code: 'citation_unreadable' });
  });
});
