import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

/**
 * Where a definition and a connection are used (the D3 plan, D3-M): computed when asked, those the
 * caller may read by title and the rest counted. Grace reads General and not Quality.
 */
describe('where a query definition and a connection are used', () => {
  let h: Harness;
  let connection: { id: string; version: string };
  let definition: { id: string; version: string };
  const titles: Record<string, string> = {};

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Used');
    definition = await h.definition(connection.id);
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    h.connector.run = ranOk([['1', 'North']]);
    // A component binding it in each space, each placed by a document in its space and resolved
    // there; a third bound it once and no longer does.
    for (const [key, space] of [
      ['general', h.general],
      ['quality', h.quality],
    ] as const) {
      const component = await h.component(space, `Readings in ${key}`);
      await h.place(component, binding('b1', definition.id));
      const document = await h.documentReferencing([component.id], space);
      const resolved = await h.call(
        'ada',
        'POST',
        `/v1/documents/${document.id}/bindings/resolve`,
        {
          bindings: [{ node: document.nodes[0], binding: 'b1' }],
        },
      );
      expect(resolved.statusCode, resolved.body).toBe(200);
      titles[key] = component.id;
      titles[`${key}Document`] = document.id;
    }
    const former = await h.component(h.general, 'Formerly bound');
    await h.place(former, binding('b1', definition.id));
    await h.place(former, { type: 'text', value: 'Nothing bound now.', marks: [] });
    // A component whose text spells the definition's identifier binds nothing.
    const lookalike = await h.component(h.general, 'Lookalike');
    await h.place(lookalike, {
      type: 'text',
      value: definition.id,
      marks: [],
    });
    // Another definition on the connection, and a definition on another connection, each bound and
    // resolved in General: neither is a use of the definition, and the second no use of the connection.
    const sibling = await h.definition(connection.id, { title: 'Sibling' });
    const elsewhere = await h.connection('Elsewhere');
    const stranger = await h.definition(elsewhere.id, { title: 'Stranger' });
    for (const [key, bound] of [
      ['sibling', sibling],
      ['stranger', stranger],
    ] as const) {
      const component = await h.component(h.general, `Bound to ${key}`);
      await h.place(component, binding('b1', bound.id));
      const document = await h.documentReferencing([component.id]);
      const resolved = await h.call(
        'ada',
        'POST',
        `/v1/documents/${document.id}/bindings/resolve`,
        { bindings: [{ node: document.nodes[0], binding: 'b1' }] },
      );
      expect(resolved.statusCode, resolved.body).toBe(200);
      titles[key] = bound.id;
      titles[`${key}Document`] = document.id;
    }
  });

  afterAll(async () => {
    await h?.close();
  });

  it('DAT-016 answers where a definition is used: the components whose latest versions bind it, and the documents resolving them, naming those the caller may read', async () => {
    const asGrace = await h.call('grace', 'GET', `/v1/query-definitions/${definition.id}/uses`);
    expect(asGrace.statusCode, asGrace.body).toBe(200);
    expect(asGrace.json()).toEqual({
      components: {
        readable: [{ id: titles.general, title: 'Readings' }],
        others: 1,
      },
      documents: {
        readable: [{ id: titles.generalDocument, title: 'The readings report' }],
        others: 1,
      },
    });
    // Ada reads both spaces, and is told of both.
    const asAda = (await h.call('ada', 'GET', `/v1/query-definitions/${definition.id}/uses`)).json<{
      components: { readable: unknown[]; others: number };
      documents: { readable: unknown[]; others: number };
    }>();
    expect(asAda.components).toMatchObject({ others: 0 });
    expect(asAda.components.readable).toHaveLength(2);
    expect(asAda.documents.readable).toHaveLength(2);
    // Ivy may not read the definition, and it is not there for her.
    expect(
      (await h.call('ivy', 'GET', `/v1/query-definitions/${definition.id}/uses`)).statusCode,
    ).toBe(404);
  });

  it('DAT-064 answers where a connection is used, through its definitions to the documents', async () => {
    const answer = await h.call('grace', 'GET', `/v1/connections/${connection.id}/uses`);
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{ definitions: unknown; documents: { readable: { id: string }[] } }>();
    expect(body.definitions).toEqual({
      readable: [
        { id: titles.sibling, title: 'Sibling', retired: false },
        { id: definition.id, title: 'Site by id', retired: false },
      ],
      others: 0,
    });
    // The document resolving the sibling is a use of the connection; the stranger's is not.
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
    expect([...body.documents.readable].sort(byId)).toEqual(
      [
        { id: titles.generalDocument!, title: 'The readings report' },
        { id: titles.siblingDocument!, title: 'The readings report' },
      ].sort(byId),
    );
    expect(body.documents).toMatchObject({ others: 1 });
  });
});
