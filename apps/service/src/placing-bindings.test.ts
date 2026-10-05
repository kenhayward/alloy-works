import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  binding,
  definitionBody,
  ranOk,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

/**
 * Placing and changing a binding (the B2 plan, task 3): a binding read from the caller's own editing
 * session (B2-C), Keep (`confirm`, B2-F) and its `keepable` (B2-G), the documents holding a binding's
 * value (B2-I), and the identity each listed definition runs as (B2-B).
 */

type Json = Record<string, unknown>;
interface State {
  node: string;
  binding: Json & { id: string };
  held: {
    version: string;
    stale: boolean;
    keepable: boolean;
    act: string;
    taken: Json | null;
  } | null;
}

const text = { type: 'text', value: 'The site is ', marks: [] };

describe('placing and changing a binding through the service', () => {
  let h: Harness;
  let connection: { id: string; version: string };

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    await h.allow(h.ids.ada!, h.roles['Connection user']!, { kind: 'space', id: h.quality });
    await h.allow(h.ids.ada!, h.roles['SQL writer']!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  /** Claims the component's lock for a session of the caller's and saves one iteration in it. */
  const saveIn = async (
    as: string,
    component: { id: string; version: string },
    session: string,
    sequence: number,
    ...inlines: unknown[]
  ) => {
    const claimed = await h.call(as, 'POST', `/v1/components/${component.id}/lock`, {
      session,
      move: true,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const saved = await h.call(
      as,
      'PUT',
      `/v1/components/${component.id}/iterations/${session}/${sequence}`,
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
    expect(saved.statusCode, saved.body).toBe(200);
  };
  const fromSession = (as: string, document: string, node: string, session?: string) =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1', from: 'session' }],
      ...(session === undefined ? {} : { session }),
    });
  const resolve = (document: string, node: string) =>
    h.call('ada', 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
  const stateOf = async (document: string, session?: string) => {
    const answer = await h.call(
      'ada',
      'GET',
      `/v1/documents/${document}/bindings${session === undefined ? '' : `?session=${session}`}`,
    );
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings.find((each) => each.binding.id === 'b1');
  };
  const confirm = (document: string, node: string, replaces: string, over: Json = {}) =>
    h.call('ada', 'POST', `/v1/documents/${document}/bindings/confirm`, {
      node,
      binding: 'b1',
      replaces,
      ...over,
    });
  /** A component holding b1 at a version, a document placing it, and b1 resolved there. */
  const resolved = async (definition: string, over: Json = {}) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, text, binding('b1', definition, over));
    const document = await h.documentReferencing([component.id]);
    const node = document.nodes[0]!;
    h.connector.run = ranOk([['1', 'North']]);
    expect((await resolve(document.id, node)).statusCode).toBe(200);
    const held = (await stateOf(document.id))!.held!;
    return { component, document, node, held };
  };

  it('resolves a binding from the caller own editing session before any version is cut, and holds it once one is', async () => {
    const definition = await h.definition(connection.id);
    const component = await h.component(h.general, 'Readings');
    const document = await h.documentReferencing([component.id]);
    const node = document.nodes[0]!;
    const session = randomUUID();
    await saveIn('ada', component, session, 1, text, binding('b1', definition.id));
    h.connector.run = ranOk([['1', 'North']]);

    // The version holds no such binding; an item from a session names one.
    expect((await resolve(document.id, node)).json()).toMatchObject({ code: 'binding_missing' });
    expect((await fromSession('ada', document.id, node)).statusCode).toBe(400);
    const answered = await fromSession('ada', document.id, node, session);
    expect(answered.statusCode, answered.body).toBe(200);
    expect(await stateOf(document.id)).toBeUndefined();
    expect((await stateOf(document.id, session))!.held).toMatchObject({
      stale: false,
      taken: { value: 'North' },
    });

    // Cut from the session: the version holds the binding resolved, under the same digest.
    const released = await h.call(
      'ada',
      'DELETE',
      `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version}`,
    );
    expect(released.statusCode, released.body).toBe(200);
    expect((await stateOf(document.id))!.held).toMatchObject({
      stale: false,
      taken: { value: 'North' },
    });
  });

  it("answers binding_missing for another principal's session, a pinned node and a session opened before the latest cut", async () => {
    const definition = await h.definition(connection.id);
    h.connector.run = ranOk([['1', 'North']]);

    // Grace's session, named by Ada.
    const graces = await h.component(h.general, 'Readings');
    const graceSession = randomUUID();
    await saveIn('grace', graces, graceSession, 1, text, binding('b1', definition.id));
    const first = await h.documentReferencing([graces.id]);
    expect(
      (await fromSession('ada', first.id, first.nodes[0]!, graceSession)).json(),
    ).toMatchObject({ code: 'binding_missing' });

    // A node pinned to the version the session opened from.
    const pinned = await h.component(h.general, 'Readings');
    const made = (
      await h.call('ada', 'POST', `/v1/spaces/${h.general}/documents`, {
        title: 'Pinned',
        language: 'en-GB',
        direction: 'ltr',
      })
    ).json<{ id: string; version: { id: string } }>();
    const inserted = await h.call('ada', 'POST', `/v1/documents/${made.id}/outline`, {
      openedFrom: made.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: {
          type: 'reference',
          component: pinned.id,
          mode: { kind: 'pinned', version: pinned.version },
        },
      },
    });
    expect(inserted.statusCode, inserted.body).toBe(200);
    const pinnedNode = (await h.call('ada', 'GET', `/v1/documents/${made.id}`)).json<{
      outline: { nodes: { id: string }[] };
    }>().outline.nodes[0]!.id;
    const pinnedSession = randomUUID();
    await saveIn('ada', pinned, pinnedSession, 1, text, binding('b1', definition.id));
    expect((await fromSession('ada', made.id, pinnedNode, pinnedSession)).json()).toMatchObject({
      code: 'binding_missing',
    });

    // A session whose latest save was opened from a version since cut from.
    const stale = await h.component(h.general, 'Readings');
    const second = await h.documentReferencing([stale.id]);
    const staleSession = randomUUID();
    await saveIn('ada', stale, staleSession, 1, text, binding('b1', definition.id));
    const cut = await h.call('ada', 'POST', `/v1/components/${stale.id}/versions`, {
      session: staleSession,
      openedFrom: stale.version,
    });
    expect(cut.statusCode, cut.body).toBe(200);
    expect(
      (await fromSession('ada', second.id, second.nodes[0]!, staleSession)).json(),
    ).toMatchObject({ code: 'binding_missing' });
  });

  it('keeps a held result across a change of the value taken or the mode, querying nothing, and says it may', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node, held } = await resolved(definition.id);
    expect(held.keepable).toBe(false);
    await h.place(component, text, binding('b1', definition.id, { take: { column: 'id' } }));
    const stale = (await stateOf(document.id))!.held!;
    expect(stale).toMatchObject({ stale: true, keepable: true });
    const asked = h.connector.asked.length;
    const kept = await confirm(document.id, node, held.version);
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json<State>().held).toMatchObject({
      version: held.version,
      act: 'confirm',
      stale: false,
      keepable: false,
      taken: { value: '1' },
    });
    expect(h.connector.asked.length).toBe(asked);

    // The mode alone, changed in the author's session and kept from it.
    const session = randomUUID();
    await saveIn(
      'ada',
      component,
      session,
      1,
      text,
      binding('b1', definition.id, { take: { column: 'id' }, mode: 'pinned' }),
    );
    expect((await stateOf(document.id, session))!.held).toMatchObject({ keepable: true });
    const fromIt = await confirm(document.id, node, held.version, { from: 'session', session });
    expect(fromIt.statusCode, fromIt.body).toBe(200);
    expect(fromIt.json<State>().held).toMatchObject({ stale: false, act: 'confirm' });
  });

  it('refuses to keep a result once the definition, the parameters or the pin changed, or the definition moved on', async () => {
    const definition = await h.definition(connection.id);
    const other = await h.definition(connection.id, { title: 'Another' });
    const refusedAfter = async (what: string, change: () => Promise<Json>) => {
      const { component, document, node, held } = await resolved(definition.id);
      await h.place(component, text, binding('b1', definition.id, await change()));
      expect((await stateOf(document.id))!.held!.keepable, what).toBe(false);
      const refused = await confirm(document.id, node, held.version);
      expect(refused.statusCode, what).toBe(409);
      expect(refused.json(), what).toMatchObject({ code: 'confirm_not_possible' });
    };
    await refusedAfter('definition', async () => ({ query: other.id }));
    await refusedAfter('parameters', async () => ({ parameters: { site: { literal: '2' } } }));
    // Floating, with the definition moved on since: the question asks its latest version now.
    let latest = definition.version;
    await refusedAfter('moved on', async () => {
      latest = await h.nextDefinition(
        definition.id,
        latest,
        definitionBody(connection.id, { title: 'Site by id, again' }),
      );
      return { mode: 'pinned' };
    });
    // Pinned to a version the held result did not run.
    const held = latest;
    await refusedAfter('pin', async () => {
      latest = await h.nextDefinition(
        definition.id,
        held,
        definitionBody(connection.id, { title: 'Site by id, once more' }),
      );
      return { version: latest };
    });
  });

  it('refuses to keep a result the binding no longer holds, once an accept moved it on', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node, held } = await resolved(definition.id);
    h.connector.run = ranOk([['1', 'North again']]);
    const checked = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    const revision = checked.json<{ results: { version: string }[] }>().results[0]!.version;
    const accepted = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
      node,
      binding: 'b1',
      version: revision,
      replaces: held.version,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    await h.place(component, text, binding('b1', definition.id, { mode: 'pinned' }));
    const refused = await confirm(document.id, node, held.version);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'resolution_precondition',
      current: { held: { version: revision } },
    });
    expect((await confirm(document.id, node, revision)).statusCode).toBe(200);
  });

  it('names the documents holding a value for a binding to a reader of each, and counts the rest', async () => {
    const definition = await h.definition(connection.id);
    const { component, document } = await resolved(definition.id);
    const inQuality = await h.documentReferencing([component.id], h.quality);
    h.connector.run = ranOk([['1', 'North']]);
    expect((await resolve(inQuality.id, inQuality.nodes[0]!)).statusCode).toBe(200);
    // Placed and never resolved: holds nothing.
    await h.documentReferencing([component.id]);
    const holders = (as: string, id = component.id) =>
      h.call(as, 'GET', `/v1/components/${id}/bindings/b1/holders`);
    expect((await holders('ada')).json<{ documents: Json }>().documents).toMatchObject({
      readable: [{ id: expect.any(String) }, { id: expect.any(String) }],
      others: 0,
    });
    expect((await holders('grace')).json()).toEqual({
      documents: { readable: [{ id: document.id, title: 'The readings report' }], others: 1 },
    });
    const hidden = await h.component(h.quality, 'Hidden');
    expect((await holders('grace', hidden.id)).statusCode).toBe(404);
  });

  it('answers whether the caller may use a definition connection, which resolving a binding needs', async () => {
    const definition = await h.definition(connection.id);
    const asked = async (as: string) =>
      (await h.call(as, 'GET', `/v1/query-definitions/${definition.id}`)).json<{
        mayUse: boolean;
      }>().mayUse;
    expect(await asked('grace')).toBe(true);
    expect(await asked('alice')).toBe(false);
  });

  it('DAT-022 the listing names the identity each definition runs as, to a reader of the definition who may not read its connection', async () => {
    const hidden = await h.connection('Hidden readings', h.quality);
    const definition = await h.definition(hidden.id, { title: 'Runs on a hidden connection' });
    const listed = await h.call('grace', 'GET', '/v1/query-definitions?limit=100');
    expect(listed.statusCode, listed.body).toBe(200);
    const item = listed
      .json<{ items: { id: string; connection: Json }[] }>()
      .items.find((each) => each.id === definition.id);
    expect(item?.connection).toEqual({ id: hidden.id, name: null, identity: 'service' });
  });
});
