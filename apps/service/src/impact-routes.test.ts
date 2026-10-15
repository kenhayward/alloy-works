import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, startHarness, type Harness } from './test/bindings-harness.js';

/**
 * What a change reaches, and what an artifact uses (the R2 plan, R2-C, R2-E). Grace reads General and
 * not Quality; Ada reads both.
 */
describe('impact and what an artifact uses', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('SCH-023 walks from a connection to the documents a change to it reaches, to the depth asked', async () => {
    const connection = await h.connection('Gauges');
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Gauge readings');
    await h.place(component, binding('b1', definition.id));
    const document = await h.documentReferencing([component.id]);

    const answer = await h.call('ada', 'GET', `/v1/artifacts/${connection.id}/impact?depth=3`);
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{
      reached: { id: string; kind: string; depth: number; via: string; hard: boolean }[];
      cut: boolean;
      more: boolean;
    }>();
    expect(
      body.reached.map(({ id, kind, depth, via, hard }) => ({ id, kind, depth, via, hard })),
    ).toEqual([
      { id: definition.id, kind: 'queryDefinition', depth: 1, via: connection.id, hard: true },
      { id: component.id, kind: 'component', depth: 2, via: definition.id, hard: true },
      { id: document.id, kind: 'document', depth: 3, via: component.id, hard: true },
    ]);
    expect(body).toMatchObject({ cut: false, more: false });

    const used = await h.call('ada', 'GET', `/v1/artifacts/${component.id}/references`);
    expect(used.statusCode, used.body).toBe(200);
    expect(used.json()).toEqual({
      references: [{ id: definition.id, kind: 'queryDefinition', title: expect.any(String) }],
      unreadable: false,
    });
  });

  it('REL-017 refuses a walk without a depth, or deeper than ten', async () => {
    const component = await h.component(h.general, 'Bounded');
    for (const query of ['', '?depth=0', '?depth=11', '?depth=two']) {
      const answer = await h.call('ada', 'GET', `/v1/artifacts/${component.id}/impact${query}`);
      expect(answer.statusCode, query).toBe(400);
    }
  });

  it('REL-020 says a walk was cut where it meets what the caller may not read, and answers an unreadable start as not found', async () => {
    const connection = await h.connection('Hidden gauges');
    const definition = await h.definition(connection.id);
    const hidden = await h.component(h.quality, 'Hidden readings');
    await h.place(hidden, binding('b1', definition.id));

    const answer = await h.call('grace', 'GET', `/v1/artifacts/${definition.id}/impact?depth=2`);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toEqual({ reached: [], cut: true, more: false });
    expect(
      (await h.call('grace', 'GET', `/v1/artifacts/${hidden.id}/impact?depth=1`)).statusCode,
    ).toBe(404);
    expect((await h.call('grace', 'GET', `/v1/artifacts/${hidden.id}/references`)).statusCode).toBe(
      404,
    );
  });
});
