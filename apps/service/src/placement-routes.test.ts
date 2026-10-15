import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

const title = (value: string) => [{ type: 'text', value, marks: [] }];

/**
 * Another document's section placed as references (the R2 plan, R2-F): the report first, then the act
 * against the version it read. Grace reads General and not Quality.
 */
describe("placing another document's section", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  type Outline = {
    version: { id: string };
    outline: { nodes: { id: string; children: unknown[] }[] };
  };

  /** A document in `space` holding one section that places each of `components`. */
  const sectioned = async (components: readonly string[], space = h.general) => {
    const made = await h.call('ada', 'POST', `/v1/spaces/${space}/documents`, {
      title: 'Pump manual',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
    const id = made.json<{ id: string }>().id;
    let view = (await h.call('ada', 'GET', `/v1/documents/${id}`)).json<Outline>();
    const insert = async (operation: object) => {
      const edited = await h.call('ada', 'POST', `/v1/documents/${id}/outline`, {
        openedFrom: view.version.id,
        operation,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      view = edited.json<Outline>();
    };
    await insert({
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: title('Maintenance') },
    });
    const section = view.outline.nodes[0]!.id;
    for (const [at, component] of components.entries()) {
      await insert({
        operation: 'insert',
        parent: section,
        position: at,
        node: { type: 'reference', component, mode: { kind: 'latest' } },
      });
    }
    return { id, section, version: view.version.id };
  };

  it('REU-046 REU-054 reports what a section pulls in, then places it under a new section of the author', async () => {
    const flush = await h.component(h.general, 'Flush the line');
    const prime = await h.component(h.general, 'Prime the pump');
    const source = await sectioned([flush.id, prime.id, flush.id]);
    const target = await h.documentReferencing([]);

    const report = await h.call(
      'grace',
      'GET',
      `/v1/documents/${target.id}/placement?from=${source.id}&section=${source.section}`,
    );
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json()).toMatchObject({
      from: { document: source.id, version: source.version, section: { id: source.section } },
      occurrences: 3,
      unreadable: 0,
    });
    expect(
      report
        .json<{ components: { id: string; occurrences: number }[] }>()
        .components.map((each) => [each.id, each.occurrences]),
    ).toEqual([
      [flush.id, 2],
      [prime.id, 1],
    ]);

    const placed = await h.call('grace', 'POST', `/v1/documents/${target.id}/placement`, {
      openedFrom: target.version,
      from: source.id,
      fromVersion: source.version,
      section: source.section,
      parent: null,
      position: 0,
      title: title('Upkeep'),
      mode: 'approved',
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const [section] = placed.json<{
      outline: {
        nodes: { type: string; children: { component?: { id: string }; mode?: unknown }[] }[];
      };
    }>().outline.nodes;
    expect(section!.type).toBe('section');
    expect(section!.children).toHaveLength(3);
  });

  it('refuses a placement against a source that moved since the report, and a source the caller may not read', async () => {
    const step = await h.component(h.general, 'Drain the tank');
    const source = await sectioned([step.id]);
    const target = await h.documentReferencing([]);
    const moved = await h.call('grace', 'POST', `/v1/documents/${target.id}/placement`, {
      openedFrom: target.version,
      from: source.id,
      fromVersion: target.version,
      section: source.section,
      parent: null,
      position: 0,
      title: title('Upkeep'),
      mode: 'latest',
    });
    expect(moved.statusCode, moved.body).toBe(409);
    expect(moved.json()).toMatchObject({ code: 'source_moved' });

    const hidden = await sectioned([], h.quality);
    const report = await h.call(
      'grace',
      'GET',
      `/v1/documents/${target.id}/placement?from=${hidden.id}&section=${hidden.section}`,
    );
    expect(report.statusCode).toBe(404);
  });
});
