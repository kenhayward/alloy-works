import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/**
 * A component in one space placed in a document in another (access.md, "Permissions"; the R20 plan,
 * R20-B). Grace authors General and reads nothing of Quality; Ada authors both.
 */
describe('referencing across spaces', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A document in General, made by `as`. */
  const documentBy = async (as: string) => {
    const made = await h.call(as, 'POST', `/v1/spaces/${h.general}/documents`, {
      title: 'Site procedure',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string; version: { id: string } }>();
  };
  const place = (
    as: string,
    document: { id: string; version: { id: string } },
    component: string,
  ) =>
    h.call(as, 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component, mode: { kind: 'latest' } },
      },
    });

  it('IAM-016 places a component from another space only where its author may read it, and shows nothing of it to a reader who may not', async () => {
    const calibration = await h.component(h.quality, 'Calibration');

    // Grace may not read Quality: the component is refused her, as one that is not there.
    const graces = await documentBy('grace');
    const refused = await place('grace', graces, calibration.id);
    const missing = await place('grace', graces, '00000000-0000-4000-8000-0000000000aa');
    expect(refused.statusCode, refused.body).toBe(400);
    const said = ({ traceId: _, ...rest }: Json) => rest;
    expect(said(refused.json())).toEqual(said(missing.json()));
    expect(refused.body).not.toContain('Calibration');

    // Ada may: the same placement in a General document stands.
    const adas = await documentBy('ada');
    const placed = await place('ada', adas, calibration.id);
    expect(placed.statusCode, placed.body).toBe(200);

    // Grace reads Ada's document, and is shown a component withheld, never which or what.
    const read = await h.call('grace', 'GET', `/v1/documents/${adas.id}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).not.toContain('Calibration');
    const [node] = read.json<{ outline: { nodes: (Json & { component: unknown })[] } }>().outline
      .nodes;
    expect(node).toMatchObject({ type: 'reference', component: null });
    const asAda = await h.call('ada', 'GET', `/v1/documents/${adas.id}`);
    const [hers] = asAda.json<{ outline: { nodes: (Json & { component: unknown })[] } }>().outline
      .nodes;
    expect(hers).toMatchObject({ component: calibration.id });
  });
});
