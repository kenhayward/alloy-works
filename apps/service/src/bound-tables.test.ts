import { findRole } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binding, ranOk, startHarness, type Harness } from './test/bindings-harness.js';

/**
 * A bound table's binding through the service (the TB1 plan, task 2; TB1-C): saved in a component,
 * resolved, viewed, checked, accepted and kept as any binding, taking no value - the view answers it
 * `{ table: true }` - and a publish holding it unresolved refused by name.
 */

type Json = Record<string, unknown>;
interface State {
  node: string;
  binding: Json & { id: string };
  held: (Json & { version: string; stale: boolean; keepable: boolean; taken: Json | null }) | null;
  waiting: (Json & { version: string; taken: Json }) | null;
}

describe('a bound table through the service', () => {
  let h: Harness;
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
    const publisher = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Publisher'));
    await h.allow(h.ids.ada!, publisher!.id, { kind: 'space', id: h.general });
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A bound table's binding: an inline one's members, no take. */
  const whole = (id: string, query: string, over: Json = {}) => {
    const made: Json = binding(id, query, over);
    delete made.take;
    return made;
  };
  const table = (tableBinding: Json, over: Json = {}) => ({
    type: 'boundTable',
    id: 't1',
    binding: tableBinding,
    caption: [{ type: 'text', value: 'Sites', marks: [] }],
    columns: [
      { column: 'id', header: 'Site' },
      { column: 'name', header: 'Name' },
    ],
    headerColumn: true,
    ...over,
  });
  /** A component holding these blocks, and a document placing it once. */
  const placed = async (...blocks: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.placeBlocks(component, ...blocks);
    const document = await h.documentReferencing([component.id]);
    return { component, document, node: document.nodes[0]! };
  };
  const call = (path: string, body: Json) => h.call('ada', 'POST', path, body);
  const stateOf = async (document: string, id = 'b1') => {
    const answer = await h.call('ada', 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings.find((each) => each.binding.id === id)!;
  };

  it('saves a component holding a bound table, and resolves, checks and accepts its binding as any, holding the whole result', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(table(whole('b1', definition.id)));
    // The binding as stored, with no take.
    expect((await stateOf(document.id)).binding).not.toHaveProperty('take');

    h.connector.run = ranOk([
      ['1', 'North'],
      ['2', 'South'],
    ]);
    const resolved = await call(`/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const held = (await stateOf(document.id)).held!;
    expect(held).toMatchObject({ stale: false, act: 'resolve', taken: { table: true } });
    expect(held.provenance).toMatchObject({ rowCount: 2 });

    // A check finds a revision: it waits beside what is held, taking nothing either, until accepted.
    h.connector.run = ranOk([['1', 'North Quay']]);
    const checked = await call(`/v1/documents/${document.id}/bindings/check`, {});
    expect(checked.statusCode, checked.body).toBe(200);
    const waiting = (await stateOf(document.id)).waiting!;
    expect(waiting.taken).toEqual({ table: true });
    const accepted = await call(`/v1/documents/${document.id}/bindings/accept`, {
      node,
      binding: 'b1',
      version: waiting.version,
      replaces: held.version,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await stateOf(document.id)).held).toMatchObject({
      version: waiting.version,
      act: 'accept',
      taken: { table: true },
    });
  });

  it('keeps what a bound table held once only its mode changed, checking no take', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(table(whole('b1', definition.id)));
    h.connector.run = ranOk([['1', 'North']]);
    await call(`/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    const held = (await stateOf(document.id)).held!;
    await h.placeBlocks(component, table(whole('b1', definition.id, { mode: 'pinned' })));
    const stale = (await stateOf(document.id)).held!;
    expect(stale).toMatchObject({ stale: true, keepable: true });
    const kept = await call(`/v1/documents/${document.id}/bindings/confirm`, {
      node,
      binding: 'b1',
      replaces: held.version,
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect((await stateOf(document.id)).held).toMatchObject({
      version: held.version,
      stale: false,
      act: 'confirm',
      taken: { table: true },
    });
  });

  it("finds the bindings in a bound table's caption beside its own, each taking its value", async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      table(whole('b1', definition.id), {
        caption: [
          { type: 'text', value: 'Sites at ', marks: [] },
          binding('b2', definition.id, { parameters: { site: { literal: '7' } } }),
        ],
      }),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    const resolved = await call(`/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [
        { node, binding: 'b1' },
        { node, binding: 'b2' },
      ],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect((await stateOf(document.id, 'b1')).held!.taken).toEqual({ table: true });
    expect((await stateOf(document.id, 'b2')).held!.taken).toMatchObject({ value: 'Harbour' });
  });

  it('refuses a publish of a document holding a bound table never resolved, naming its binding', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(table(whole('b1', definition.id)));
    const answer = await h.call('ada', 'POST', `/v1/documents/${document.id}/publications`, {
      version: document.version,
      formats: ['pdf'],
    });
    expect(answer.statusCode, answer.body).toBe(400);
    expect(answer.json()).toMatchObject({
      code: 'binding_unresolved',
      bindings: [{ node, binding: 'b1', reason: 'never' }],
    });
  });
});
