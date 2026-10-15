import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

const text = (value: string) => ({ type: 'text', value, marks: [] });

/** A reference's local overrides through the routes (the R4 plan, R4-B to R4-D). */
describe('local overrides', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  const texts = async (document: string) => {
    const answer = await h.call('ada', 'GET', `/v1/documents/${document}/texts`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ occurrences: { node: string; overrides?: unknown[] }[] }>().occurrences;
  };

  it('REU-011 REU-015 sets an override through the outline, which the texts carry until its paragraph changes', async () => {
    const component = await h.component(h.general, 'Flush the line');
    const v1 = await h.place(component, text('Open the drain.'));
    const document = await h.documentReferencing([component.id]);
    const set = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version,
      operation: {
        operation: 'set',
        node: document.nodes[0],
        overrides: [{ block: 'p1', against: v1, text: [text('Open the north drain.')] }],
      },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await texts(document.id))[0]!.overrides).toEqual([
      { block: 'p1', text: [text('Open the north drain.')], stale: false },
    ]);

    await h.place({ id: component.id, version: v1 }, text('Open both drains.'));
    expect((await texts(document.id))[0]!.overrides).toEqual([
      { block: 'p1', text: [text('Open the north drain.')], stale: true },
    ]);
  });

  it('refuses an override naming a version that is not the component’s', async () => {
    const component = await h.component(h.general, 'Prime the pump');
    await h.place(component, text('Fill it.'));
    const document = await h.documentReferencing([component.id]);
    const set = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version,
      operation: {
        operation: 'set',
        node: document.nodes[0],
        overrides: [{ block: 'p1', against: document.version, text: [text('Fill it twice.')] }],
      },
    });
    expect(set.statusCode).toBe(400);
    expect(set.json()).toMatchObject({ code: 'outline_invalid' });
  });
});
