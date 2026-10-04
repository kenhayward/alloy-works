import { takeDigest } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import { tenantPrefix, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  binding,
  definitionBody,
  ranOk,
  startHarness,
  type Harness,
} from './test/bindings-harness.js';

/**
 * The value each binding holds, as the bindings view answers it (the B1 plan, task 4; B1-H, B1-I):
 * taken by `takeValue` right after a resolve's or a check's run and kept in `dataset_take`, or read
 * from the stored result once on a miss; and what of its provenance the caller may see. Uncited: the
 * view's values are DAT-090's, and the page's tests cite what a person sees.
 */

type Json = Record<string, unknown>;

interface Taken {
  value?: string | boolean;
  column?: Json | string;
  failure?: string;
  count?: number;
  unavailable?: true;
}
interface State {
  node: string;
  binding: Json & { id: string; take: { column: string } };
  held: {
    version: string;
    stale: boolean;
    by: { id: string; displayName: string | null };
    provenance: Json & { checksum: string; ran: { sql: string | null } };
    taken: Taken | null;
  } | null;
  waiting: { version: string; taken: Taken | null } | null;
  definition: { title: string; version: string } | null;
  connection: { name: string } | null;
}

/**
 * The real stores, through a decorator counting each object read, which a test may tell to answer
 * other bytes than the store holds - an object that is not its checksum's.
 */
function counting() {
  const read: string[] = [];
  const decorator = {
    read,
    alter: false,
    /** Whether opening a tenant's store fails with SQL in the caller's transaction, as a bad read would. */
    failSql: false,
    wrap(stores: ObjectStores): ObjectStores {
      return {
        async forTenant(trx, tenant) {
          if (decorator.failSql) {
            await (
              trx as unknown as {
                selectFrom(table: string): { selectAll(): { execute(): Promise<unknown> } };
              }
            )
              .selectFrom('no_such_table')
              .selectAll()
              .execute();
          }
          const store = await stores.forTenant(trx, tenant);
          const wrapped: TenantStore = {
            put: (body, contentType) => store.put(body, contentType),
            remove: (key) => store.remove(key),
            signedLink: (key, seconds, fileName) => store.signedLink(key, seconds, fileName),
            async get(key) {
              read.push(key);
              const bytes = await store.get(key);
              return decorator.alter ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
            },
          };
          return wrapped;
        },
      };
    },
  };
  return decorator;
}

describe('the value each binding holds, through the bindings view', () => {
  let h: Harness;
  let connection: { id: string; version: string };
  const store = counting();

  beforeAll(async () => {
    h = await startHarness({ objects: (stores) => store.wrap(stores) });
    connection = await h.connection('Readings');
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    await h.allow(h.ids.ada!, h.roles['Connection user']!, { kind: 'space', id: h.quality });
    await h.allow(h.ids.ada!, h.roles['SQL writer']!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(() => {
    store.alter = false;
    store.failSql = false;
    store.read.length = 0;
    h.connector.mode = 'answer';
  });

  const placed = async (...inlines: unknown[]) => {
    const component = await h.component(h.general, 'Readings');
    await h.place(component, { type: 'text', value: 'The site is ', marks: [] }, ...inlines);
    const document = await h.documentReferencing([component.id]);
    return { component, document, node: document.nodes[0]! };
  };
  const resolve = (document: string, node: string, id = 'b1') =>
    h.call('ada', 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: [{ node, binding: id }],
    });
  const check = (document: string) =>
    h.call('ada', 'POST', `/v1/documents/${document}/bindings/check`, {});
  const viewOf = async (as: string, document: string, call = h.call) => {
    const answer = await call(as, 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings;
  };
  const stateOf = async (as: string, document: string, id = 'b1', call = h.call) =>
    (await viewOf(as, document, call)).find((each) => each.binding.id === id)!;
  /** Every `dataset_take` row, as the platform's owner reads it. */
  const takes = async () =>
    (
      await queryAs(
        h.db.adminUrl,
        `select dataset_version, take_digest, outcome from ${h.tenant.schema}.dataset_take`,
      )
    ).rows as { dataset_version: string; take_digest: string; outcome: Json }[];
  const takesFor = async (version: string) =>
    (await takes()).filter((row) => row.dataset_version === version);
  const forget = () => queryAs(h.db.adminUrl, `delete from ${h.tenant.schema}.dataset_take`);
  const keyOf = (checksum: string) => `${tenantPrefix(h.tenant)}sha256/${checksum}`;
  const name = { name: 'name', type: { base: 'text' } };

  it("records a resolve's take as it records the result, and answers the value it took", async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '1' } } }),
    );
    h.connector.run = ranOk([['1', 'North']]);
    expect((await resolve(document.id, node)).statusCode).toBe(200);
    const held = (await stateOf('ada', document.id)).held!;
    // Recorded by the resolve itself, before anything read the view.
    expect(await takesFor(held.version)).toEqual([
      {
        dataset_version: held.version,
        take_digest: takeDigest({ column: 'name' }),
        outcome: { value: 'North', column: name },
      },
    ]);
    expect(held.taken).toEqual({ value: 'North', column: name });
    expect(store.read).toEqual([]);
    expect(held.by).toEqual({ id: h.ids.ada, displayName: 'Ada' });
  });

  it("records a check's waiting version's take, and answers it beside the held one", async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '2' } } }),
    );
    h.connector.run = ranOk([['2', 'South']]);
    await resolve(document.id, node);
    h.connector.run = ranOk([['2', 'South again']]);
    const checked = await check(document.id);
    const revision = checked.json<{ results: { version: string }[] }>().results[0]!.version;
    expect(await takesFor(revision)).toEqual([
      expect.objectContaining({ outcome: { value: 'South again', column: name } }),
    ]);
    const state = await stateOf('ada', document.id);
    expect(state.held!.taken).toEqual({ value: 'South', column: name });
    expect(state.waiting).toMatchObject({
      version: revision,
      taken: { value: 'South again', column: name },
    });
    expect(store.read).toEqual([]);
  });

  it('answers a failure with its count, and nothing taken for a resolution gone stale', async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '3' } } }),
    );
    h.connector.run = ranOk([
      ['3', 'East'],
      ['4', 'West'],
      ['5', 'Middle'],
    ]);
    await resolve(document.id, node);
    expect((await stateOf('ada', document.id)).held!.taken).toEqual({
      failure: 'value_many',
      count: 3,
    });
    await h.place(
      component,
      { type: 'text', value: 'The site is ', marks: [] },
      binding('b1', definition.id, { parameters: { site: { literal: '6' } } }),
    );
    const stale = (await stateOf('ada', document.id)).held!;
    expect(stale.stale).toBe(true);
    expect(stale.taken).toBeNull();
  });

  it('reads a result once on a miss, records what it took, and reads it no more', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '7' } } }),
      binding('b2', definition.id, {
        parameters: { site: { literal: '7' } },
        take: { column: 'id' },
      }),
    );
    h.connector.run = ranOk([['7', 'Harbour']]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [
        { node, binding: 'b1' },
        { node, binding: 'b2' },
      ],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const before = await viewOf('ada', document.id);
    const version = before[0]!.held!.version;
    const recorded = await takesFor(version);
    expect(recorded).toHaveLength(2);

    // Derived: every row deleted, the view answers the same, reading the one result once.
    await forget();
    store.read.length = 0;
    expect(await viewOf('ada', document.id)).toEqual(before);
    expect(store.read).toEqual([keyOf(before[0]!.held!.provenance.checksum)]);
    expect(
      (await takesFor(version)).sort((a, b) => a.take_digest.localeCompare(b.take_digest)),
    ).toEqual(recorded.sort((a, b) => a.take_digest.localeCompare(b.take_digest)));

    store.read.length = 0;
    expect(await viewOf('ada', document.id)).toEqual(before);
    expect(store.read).toEqual([]);
  });

  it('answers a value unavailable, recording nothing and never failing, where its result cannot be read', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '8' } } }),
    );
    h.connector.run = ranOk([['8', 'Quay']]);
    await resolve(document.id, node);
    const held = (await stateOf('ada', document.id)).held!;
    await forget();

    // An object that is not its checksum's.
    store.alter = true;
    expect((await stateOf('ada', document.id)).held!.taken).toEqual({ unavailable: true });
    expect(await takes()).toEqual([]);
    store.alter = false;

    // No store at all.
    expect((await stateOf('ada', document.id, 'b1', h.callWithout())).held!.taken).toEqual({
      unavailable: true,
    });
    expect(await takes()).toEqual([]);

    // An object gone.
    await h.tenantDb.withTenant(h.tenant, async (trx) =>
      (await h.stores.forTenant(trx, h.tenant)).remove(keyOf(held.provenance.checksum)),
    );
    expect((await stateOf('ada', document.id)).held!.taken).toEqual({ unavailable: true });
    expect(await takes()).toEqual([]);
  });

  it("names the definition and its connection only to a caller who may read them, and gives every reader the document's value", async () => {
    // A connection in Quality, which only Ada reads, named by a definition in General, which Grace
    // reads; and a definition in Quality, which Alice and Grace may not read.
    const hidden = await h.connection('Hidden readings', h.quality);
    const general = await h.definition(hidden.id, { title: 'Sites in General' });
    const quality = await h.definition(connection.id, { title: 'Sites in Quality' }, h.quality);
    const { document, node } = await placed(
      binding('b1', general.id, { parameters: { site: { literal: '9' } } }),
      binding('b2', quality.id, { parameters: { site: { literal: '9' } } }),
    );
    h.connector.run = ranOk([['9', 'Lighthouse']]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [
        { node, binding: 'b1' },
        { node, binding: 'b2' },
      ],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const value = { value: 'Lighthouse', column: name };

    const ada = await viewOf('ada', document.id);
    expect(ada.map((each) => [each.definition, each.connection])).toEqual([
      [{ title: 'Sites in General', version: '0.1' }, { name: 'Hidden readings' }],
      [{ title: 'Sites in Quality', version: '0.1' }, { name: 'Readings' }],
    ]);

    // Grace reads the definition in General and not its connection.
    const grace = await viewOf('grace', document.id);
    expect(grace.map((each) => [each.definition, each.connection])).toEqual([
      [{ title: 'Sites in General', version: '0.1' }, null],
      [null, null],
    ]);

    // Alice reads the definition in General as Grace does, and neither connection nor the one in
    // Quality: no title, connection, SQL or source column for it, and the same value.
    const alice = await viewOf('alice', document.id);
    expect(alice.map((each) => [each.definition, each.connection])).toEqual([
      [{ title: 'Sites in General', version: '0.1' }, null],
      [null, null],
    ]);
    const b2 = alice.find((each) => each.binding.id === 'b2')!;
    expect(b2.held!.provenance.ran.sql).toBeNull();
    expect(JSON.stringify(b2)).not.toContain('Sites in Quality');
    expect(JSON.stringify(b2)).not.toContain('Readings');
    for (const each of [...ada, ...grace, ...alice]) expect(each.held!.taken).toEqual(value);
  });

  it('answers nothing for a binding in a component the caller may not read', async () => {
    const definition = await h.definition(connection.id);
    const hidden = await h.component(h.quality, 'Hidden');
    await h.place(
      hidden,
      binding('b1', definition.id, { parameters: { site: { literal: '10' } } }),
    );
    const document = await h.documentReferencing([hidden.id]);
    h.connector.run = ranOk([['10', 'Kept']]);
    await resolve(document.id, document.nodes[0]!);
    expect((await viewOf('ada', document.id)).map((each) => each.held!.taken)).toEqual([
      { value: 'Kept', column: name },
    ]);
    expect(await viewOf('alice', document.id)).toEqual([]);
  });

  it('answers a value unavailable where its cell is not canonical in its declared type, recording nothing and failing no act', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '11' } } }),
      binding('b2', definition.id, {
        parameters: { site: { literal: '11' } },
        take: { column: 'id' },
      }),
    );
    // `true` in a text column and `01` in an integer one: held to its checksum and to the canonical
    // shape, which does not hold a cell to its column's declared type.
    h.connector.run = ranOk([['01', true]]);
    const resolved = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [
        { node, binding: 'b1' },
        { node, binding: 'b2' },
      ],
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const version = resolved.json<{ results: { held: { version: string } }[] }>().results[0]!.held
      .version;
    expect(await takesFor(version)).toEqual([]);

    // The view reads the stored object on the miss, and takes nothing from it either.
    store.read.length = 0;
    const view = await viewOf('ada', document.id);
    expect(view.map((each) => each.held!.taken)).toEqual([
      { unavailable: true },
      { unavailable: true },
    ]);
    expect(store.read).toHaveLength(1);
    expect(await takesFor(version)).toEqual([]);

    // A check whose answer differs and is no more canonical: a revision, recording no take.
    h.connector.run = ranOk([['01', false]]);
    const checked = await check(document.id);
    expect(checked.statusCode, checked.body).toBe(200);
    const revision = checked.json<{ results: { outcome: string; version: string }[] }>()
      .results[0]!;
    expect(revision.outcome).toBe('revision');
    expect(await takesFor(revision.version)).toEqual([]);
    expect((await stateOf('ada', document.id)).waiting!.taken).toEqual({ unavailable: true });
  });

  it('answers the view whole where opening the store fails with SQL in its transaction', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '12' } } }),
    );
    h.connector.run = ranOk([['12', 'Pier']]);
    await resolve(document.id, node);
    await forget();
    store.failSql = true;
    const state = await stateOf('ada', document.id);
    expect(state.held!.taken).toEqual({ unavailable: true });
    expect(state.definition).toEqual({ title: 'Site by id', version: '0.1' });
    expect(state.held!.by).toEqual({ id: h.ids.ada, displayName: 'Ada' });
  });

  it('names the version a binding holding nothing pins, or the latest, and no connection', async () => {
    const definition = await h.definition(connection.id, {}, h.quality);
    await h.nextDefinition(
      definition.id,
      definition.version,
      definitionBody(connection.id, { title: 'Site by id, again' }),
    );
    const { document } = await placed(
      binding('b1', definition.id),
      binding('b2', definition.id, { version: definition.version }),
    );
    const view = await viewOf('ada', document.id);
    expect(view.map((each) => [each.held, each.definition, each.connection])).toEqual([
      [null, { title: 'Site by id, again', version: '0.2' }, null],
      [null, { title: 'Site by id', version: '0.1' }, null],
    ]);
    // Alice may not read a definition in Quality, and is told neither.
    expect((await viewOf('alice', document.id)).map((each) => each.definition)).toEqual([
      null,
      null,
    ]);
  });

  it("records a miss's take when a reader who may not read the definition reads the view", async () => {
    const definition = await h.definition(connection.id, {}, h.quality);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '13' } } }),
    );
    h.connector.run = ranOk([['13', 'Jetty']]);
    await resolve(document.id, node);
    const version = (await stateOf('ada', document.id)).held!.version;
    await forget();
    const alice = await stateOf('alice', document.id);
    expect(alice.definition).toBeNull();
    expect(alice.held!.taken).toEqual({ value: 'Jetty', column: name });
    expect(await takesFor(version)).toEqual([
      expect.objectContaining({ outcome: { value: 'Jetty', column: name } }),
    ]);
  });

  it('answers what an accepted version took, recording it on a miss', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed(
      binding('b1', definition.id, { parameters: { site: { literal: '14' } } }),
    );
    h.connector.run = ranOk([['14', 'Dock']]);
    await resolve(document.id, node);
    h.connector.run = ranOk([['14', 'Dock again']]);
    const checked = await check(document.id);
    const revision = checked.json<{ results: { version: string }[] }>().results[0]!.version;
    const replaces = (await stateOf('ada', document.id)).held!.version;
    await forget();
    store.read.length = 0;
    const accepted = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/accept`, {
      node,
      binding: 'b1',
      version: revision,
      replaces,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const state = accepted.json<State>();
    expect(state.held).toMatchObject({
      version: revision,
      taken: { value: 'Dock again', column: name },
    });
    expect(store.read).toHaveLength(1);
    expect(await takesFor(revision)).toEqual([
      expect.objectContaining({ outcome: { value: 'Dock again', column: name } }),
    ]);
  });
});
