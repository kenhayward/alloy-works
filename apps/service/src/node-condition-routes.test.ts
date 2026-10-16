import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

const text = (value: string) => ({ type: 'text', value, marks: [] });
const regulator = [{ axis: 'audience', values: ['regulator'] }];

/** A node's conditions through the outline route (the R11 plan, R11-A). */
describe('conditions on an outline node', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  const latest = async (document: string) => {
    const answer = await h.call('ada', 'GET', `/v1/documents/${document}`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{
      version: { id: string };
      outline: { nodes: { conditions?: unknown }[] };
    }>();
  };
  const nodes = async (document: string) => (await latest(document)).outline.nodes;

  it('REU-021 sets a reference conditions through the outline, whole, and clears them with none', async () => {
    const component = await h.component(h.general, 'Inspections');
    await h.place(component, text('The regulator inspected the site.'));
    const document = await h.documentReferencing([component.id]);
    const set = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version,
      operation: { operation: 'set', node: document.nodes[0], conditions: regulator },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await nodes(document.id))[0]!.conditions).toEqual(regulator);

    const cleared = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: (await latest(document.id)).version.id,
      operation: { operation: 'set', node: document.nodes[0], conditions: [] },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((await nodes(document.id))[0]).not.toHaveProperty('conditions');
  });

  it('refuses a condition no axis key could name', async () => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, text('Readings were taken.'));
    const document = await h.documentReferencing([component.id]);
    const set = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version,
      operation: {
        operation: 'set',
        node: document.nodes[0],
        conditions: [{ axis: 'Audience', values: ['regulator'] }],
      },
    });
    expect(set.statusCode).toBe(400);
  });
});
