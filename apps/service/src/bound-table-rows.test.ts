import { randomUUID } from 'node:crypto';

import { TABLE_ROWS_MAX } from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  binding,
  HOST,
  ranOk,
  startHarness,
  type Cell,
  type Harness,
} from './test/bindings-harness.js';

/**
 * A bound table's rows for the page (the TB2 plan, task 1; TB2-A): the held result, only its table's
 * columns, to a reader of the document, revalidated by its `ETag`; everything else refused by name.
 */

type Json = Record<string, unknown>;
interface State {
  binding: Json & { id: string };
  held: (Json & { version: string }) | null;
  waiting: (Json & { version: string }) | null;
}

/** The real stores, through a decorator that may answer other bytes than the store holds. */
function altering() {
  const decorator = {
    alter: false,
    wrap(stores: ObjectStores): ObjectStores {
      return {
        async forTenant(trx, tenant) {
          const store = await stores.forTenant(trx, tenant);
          const wrapped: TenantStore = {
            put: (body, contentType) => store.put(body, contentType),
            remove: (key) => store.remove(key),
            signedLink: (key, seconds, fileName) => store.signedLink(key, seconds, fileName),
            async get(key) {
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

describe("a bound table's rows, for the page", () => {
  let h: Harness;
  let connection: { id: string; version: string };
  const store = altering();

  beforeAll(async () => {
    h = await startHarness({ objects: (stores) => store.wrap(stores) });
    connection = await h.connection('Readings');
    // Alice reads the General space, and Grace the definitions in it, but nothing in Quality.
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(() => {
    store.alter = false;
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
    columns: [{ column: 'name', header: 'Name' }],
    headerColumn: false,
    ...over,
  });
  const content = (blocks: unknown[]) => ({
    schemaVersion: 1,
    title: 'Readings',
    language: 'en-GB',
    direction: 'ltr',
    content: blocks,
  });
  const stateOf = async (document: string) => {
    const answer = await h.call('ada', 'GET', `/v1/documents/${document}/bindings`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ bindings: State[] }>().bindings.find((each) => each.binding.id === 'b1')!;
  };
  const resolve = async (document: string, node: string, rows: Cell[][]) => {
    h.connector.run = ranOk(rows);
    const answer = await h.call('ada', 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
    expect(answer.statusCode, answer.body).toBe(200);
    return (await stateOf(document)).held!.version;
  };
  /** A component holding these blocks, a document placing it, and its table resolved. */
  const placed = async (blocks: unknown[], space = h.general) => {
    const component = await h.component(h.general, 'Readings');
    await h.placeBlocks(component, ...blocks);
    const document = await h.documentReferencing([component.id], space);
    const node = document.nodes[0]!;
    return { component, document, node };
  };
  const rowsOf = (
    as: string,
    document: string,
    node: string,
    version: string,
    over: { readonly binding?: string; readonly session?: string; readonly etag?: string } = {},
  ) =>
    h.app.inject({
      method: 'GET',
      url: `/v1/documents/${document}/bindings/${node}/${over.binding ?? 'b1'}/rows?version=${version}${
        over.session === undefined ? '' : `&session=${over.session}`
      }`,
      headers: {
        host: HOST,
        cookie: h.cookies[as]!,
        ...(over.etag === undefined ? {} : { 'if-none-match': over.etag }),
      },
    });

  it("answers a reader of the document the held rows in the table's order, only the columns it shows: a column it sorts by is never sent", async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed([
      table(whole('b1', definition.id), {
        sort: [{ column: 'id', direction: 'descending', nulls: 'last' }],
      }),
    ]);
    const version = await resolve(document.id, node, [
      ['1', 'North'],
      ['2', 'South'],
    ]);
    const answer = await rowsOf('alice', document.id, node, version);
    expect(answer.statusCode, answer.body).toBe(200);
    // Sorted by the id descending on the service, and the id itself left out (the TB2 final review).
    expect(answer.json()).toEqual({
      version,
      presorted: true,
      result: { columns: [['name', 'text']], rows: [['South'], ['North']] },
    });
    expect(answer.headers['cache-control']).toBe('private, no-cache');

    // Shown alone, the name is all that is sent: the id never reaches a reader.
    const { document: other, node: at } = await placed([table(whole('b1', definition.id))]);
    const held = await resolve(other.id, at, [['1', 'North']]);
    const trimmed = await rowsOf('alice', other.id, at, held);
    expect(trimmed.json()).toEqual({
      version: held,
      presorted: true,
      result: { columns: [['name', 'text']], rows: [['North']] },
    });
  });

  it("sends a column added in the author's own editing session, and only to that session", async () => {
    const definition = await h.definition(connection.id);
    const { component, document, node } = await placed([table(whole('b1', definition.id))]);
    const version = await resolve(document.id, node, [['1', 'North']]);
    const session = randomUUID();
    const claimed = await h.call('ada', 'POST', `/v1/components/${component.id}/lock`, {
      session,
      move: true,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const saved = await h.call(
      'ada',
      'PUT',
      `/v1/components/${component.id}/iterations/${session}/1`,
      {
        openedFrom: component.version,
        content: content([
          table(whole('b1', definition.id), {
            columns: [
              { column: 'id', header: 'Site' },
              { column: 'name', header: 'Name' },
            ],
            sort: [{ column: 'name', direction: 'descending', nulls: 'last' }],
          }),
        ]),
      },
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const fromSession = await rowsOf('ada', document.id, node, version, { session });
    expect(fromSession.statusCode, fromSession.body).toBe(200);
    // The lock holder's own session: its columns, sorted ones among them, in stored order.
    expect(fromSession.json()).toMatchObject({
      presorted: false,
      result: {
        columns: [
          ['id', 'integer'],
          ['name', 'text'],
        ],
      },
    });
    // Without it, and to another person naming it, the version's table: the name alone.
    expect(
      (await rowsOf('ada', document.id, node, version)).json<{ result: { columns: unknown } }>()
        .result.columns,
    ).toEqual([['name', 'text']]);
    expect(
      (await rowsOf('grace', document.id, node, version, { session })).json<{
        result: { columns: unknown };
      }>().result.columns,
    ).toEqual([['name', 'text']]);
  });

  it('refuses by name a binding never resolved, a waiting version, an inline binding, a binding changed since, and a result too long to print', async () => {
    const definition = await h.definition(connection.id, {
      limits: { rows: 10_000, bytes: 10_485_760, seconds: 30 },
    });
    const inline = binding('b2', definition.id);
    const { component, document, node } = await placed([
      table(whole('b1', definition.id), {
        caption: [{ type: 'text', value: 'Sites at ', marks: [] }, inline],
      }),
    ]);
    const code = async (answer: Promise<{ statusCode: number; json: () => unknown }>) => {
      const got = await answer;
      return [got.statusCode, (got.json() as { code: string }).code];
    };
    expect(await code(rowsOf('ada', document.id, node, randomUUID()))).toEqual([
      409,
      'binding_unresolved',
    ]);
    const version = await resolve(document.id, node, [['1', 'North']]);

    // A check finds a revision, waiting: its rows are not the table's until it is accepted.
    h.connector.run = ranOk([['1', 'North Quay']]);
    const checked = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    expect(checked.statusCode, checked.body).toBe(200);
    const waiting = (await stateOf(document.id)).waiting!.version;
    expect(await code(rowsOf('ada', document.id, node, waiting))).toEqual([
      409,
      'version_not_held',
    ]);
    expect((await rowsOf('ada', document.id, node, version)).statusCode).toBe(200);

    // The caption's own binding takes a value: it has no rows to send.
    h.connector.run = ranOk([['1', 'North']]);
    await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
      bindings: [{ node, binding: 'b2' }],
    });
    expect(await code(rowsOf('ada', document.id, node, version, { binding: 'b2' }))).toEqual([
      400,
      'binding_not_table',
    ]);
    expect(await code(rowsOf('ada', document.id, node, version, { binding: 'b9' }))).toEqual([
      400,
      'binding_missing',
    ]);

    // Its mode changed: its digest moved, and what it holds is no longer its.
    await h.placeBlocks(component, table(whole('b1', definition.id, { mode: 'pinned' })));
    expect(await code(rowsOf('ada', document.id, node, version))).toEqual([409, 'binding_stale']);

    // More rows than a table prints.
    const long = Array.from({ length: TABLE_ROWS_MAX + 1 }, (_, at): Cell[] => [
      String(at),
      `S${at}`,
    ]);
    const tooLong = await resolve(document.id, node, long);
    expect(await code(rowsOf('ada', document.id, node, tooLong))).toEqual([409, 'table_too_long']);
  });

  it('is not found to a reader of the definition who may not read the document', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed([table(whole('b1', definition.id))], h.quality);
    const version = await resolve(document.id, node, [['1', 'North']]);
    expect((await rowsOf('ada', document.id, node, version)).statusCode).toBe(200);
    const answer = await rowsOf('grace', document.id, node, version);
    expect(answer.statusCode, answer.body).toBe(404);
    expect(answer.json()).toMatchObject({ code: 'not_found' });
  });

  it('answers 304 to the same rows asked again by their ETag, and new rows after a resolve to a new version', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed([table(whole('b1', definition.id))]);
    const first = await resolve(document.id, node, [['1', 'North']]);
    const answer = await rowsOf('ada', document.id, node, first);
    const etag = answer.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const again = await rowsOf('ada', document.id, node, first, { etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');

    const second = await resolve(document.id, node, [['1', 'Harbour']]);
    expect(second).not.toBe(first);
    const renewed = await rowsOf('ada', document.id, node, second, { etag });
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(renewed.headers.etag).not.toBe(etag);
    expect(renewed.json<{ result: { rows: unknown } }>().result.rows).toEqual([['Harbour']]);
  });

  it('answers result_unreadable where the stored bytes are not its checksum', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed([table(whole('b1', definition.id))]);
    const version = await resolve(document.id, node, [['1', 'North']]);
    store.alter = true;
    const answer = await rowsOf('ada', document.id, node, version);
    expect(answer.statusCode, answer.body).toBe(503);
    expect(answer.json()).toMatchObject({ code: 'result_unreadable' });
  });

  it('refuses a reader of another document holding the same dataset version, and a guest; a non-reader holding a valid ETag gets no 304', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed([table(whole('b1', definition.id))], h.quality);
    const version = await resolve(document.id, node, [['1', 'North']]);
    const etag = (await rowsOf('ada', document.id, node, version)).headers.etag as string;
    // Grace reads a document of her own holding the same result, but not this one.
    const { document: hers, node: herNode } = await placed([table(whole('b1', definition.id))]);
    expect(await resolve(hers.id, herNode, [['1', 'North']])).toBe(version);
    expect((await rowsOf('grace', hers.id, herNode, version)).statusCode).toBe(200);
    expect((await rowsOf('grace', document.id, node, version)).statusCode).toBe(404);
    expect((await rowsOf('grace', document.id, node, version, { etag })).statusCode).toBe(404);
    const guest = await h.app.inject({
      method: 'GET',
      url: `/v1/documents/${document.id}/bindings/${node}/b1/rows?version=${version}`,
      headers: { host: HOST, 'if-none-match': etag },
    });
    expect(guest.statusCode).toBe(401);
  });

  it('answers 304 to its tag weak, or in a list', async () => {
    const definition = await h.definition(connection.id);
    const { document, node } = await placed([table(whole('b1', definition.id))]);
    const version = await resolve(document.id, node, [['1', 'North']]);
    const etag = (await rowsOf('ada', document.id, node, version)).headers.etag as string;
    for (const asked of [`W/${etag}`, `"other", ${etag}`, '*']) {
      const answer = await rowsOf('ada', document.id, node, version, { etag: asked });
      expect(answer.statusCode, asked).toBe(304);
    }
    const other = await rowsOf('ada', document.id, node, version, { etag: '"other"' });
    expect(other.statusCode).toBe(200);
  });

  describe('a column named by somebody who may not read the definition (the TB2 final review)', () => {
    /** Grace authors in General; the definition stands in Quality, which she may not read. */
    const hidden = async () => {
      const definition = await h.definition(connection.id, {}, h.quality);
      const { component, document, node } = await placed([table(whole('b1', definition.id))]);
      const version = await resolve(document.id, node, [['1', 'North']]);
      const session = randomUUID();
      const claimed = await h.call('grace', 'POST', `/v1/components/${component.id}/lock`, {
        session,
        move: true,
      });
      expect(claimed.statusCode, claimed.body).toBe(200);
      const save = (columns: unknown[], sequence = 1) =>
        h.call('grace', 'PUT', `/v1/components/${component.id}/iterations/${session}/${sequence}`, {
          openedFrom: component.version,
          content: content([table(whole('b1', definition.id), { columns })]),
        });
      return { document, node, version, session, save };
    };

    it('refuses a save adding a column the table did not name, definition_unreadable, and takes one renaming a header', async () => {
      const { save } = await hidden();
      const added = await save([
        { column: 'name', header: 'Name' },
        { column: 'id', header: 'Site' },
      ]);
      expect(added.statusCode, added.body).toBe(403);
      expect(added.json()).toMatchObject({ code: 'definition_unreadable' });
      const renamed = await save([{ column: 'name', header: 'Site name' }]);
      expect(renamed.statusCode, renamed.body).toBe(200);
    });

    it("ignores the session of a caller who may not read the definition, answering the version's table", async () => {
      const { document, node, version, session, save } = await hidden();
      expect((await save([{ column: 'name', header: 'Site name' }])).statusCode).toBe(200);
      const answer = await rowsOf('grace', document.id, node, version, { session });
      expect(answer.statusCode, answer.body).toBe(200);
      expect(answer.json()).toMatchObject({
        presorted: true,
        result: { columns: [['name', 'text']] },
      });
    });
  });
});
