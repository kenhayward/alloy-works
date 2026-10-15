import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

/**
 * Where a component is used (the R1 plan, R1-B): to a reader of it, the documents placing it by their
 * latest versions, each reference with its mode. Grace reads General and not Quality; Ada reads both.
 */
describe('where a component is used', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  const uses = (as: string, id: string) => h.call(as, 'GET', `/v1/components/${id}/uses`);

  it('REU-001 REU-003 lists every document placing a component, from any space, each occurrence apart', async () => {
    const step = await h.component(h.general, 'Calibrate the pump');
    const here = await h.documentReferencing([step.id, step.id], h.general);
    const there = await h.documentReferencing([step.id], h.quality);

    const asAda = await uses('ada', step.id);
    expect(asAda.statusCode, asAda.body).toBe(200);
    const body = asAda.json<{
      documents: { id: string; references: { node: string; mode: string }[] }[];
      unreadableDocuments: boolean;
    }>();
    expect(Object.fromEntries(body.documents.map((each) => [each.id, each.references]))).toEqual({
      [here.id]: [
        { node: here.nodes[0], mode: 'latest', version: null },
        { node: here.nodes[1], mode: 'latest', version: null },
      ],
      [there.id]: [{ node: there.nodes[0], mode: 'latest', version: null }],
    });
    expect(body.unreadableDocuments).toBe(false);
  });

  it('REU-010 names to a reader only the documents they may read, and says there are more', async () => {
    const step = await h.component(h.general, 'Drain the tank');
    const here = await h.documentReferencing([step.id], h.general);
    await h.documentReferencing([step.id], h.quality);

    const asGrace = await uses('grace', step.id);
    expect(asGrace.statusCode, asGrace.body).toBe(200);
    expect(asGrace.json()).toEqual({
      documents: [
        {
          id: here.id,
          title: 'The readings report',
          state: { key: 'draft', name: 'Draft', approved: false },
          references: [{ node: here.nodes[0], mode: 'latest', version: null }],
        },
      ],
      unreadableDocuments: true,
      baselines: { named: [], unreadable: false },
      publications: { named: [], unreadable: false },
    });
  });

  it('answers a component the caller may not read, and anything not a component, as not found', async () => {
    const hidden = await h.component(h.quality, 'Hidden procedure');
    expect((await uses('grace', hidden.id)).statusCode).toBe(404);
    const document = await h.documentReferencing([], h.general);
    expect((await uses('ada', document.id)).statusCode).toBe(404);
  });
});
