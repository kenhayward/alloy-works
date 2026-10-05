import { createApiClient } from '@alloy-works/api-client';
import { describe, expect, it, vi } from 'vitest';

import { settleBinding } from './settleBinding.js';

const DOCUMENT = '99999999-9999-4999-8999-999999999999';
const SESSION = '77777777-7777-4777-8777-777777777777';
const HELD = '66666666-6666-4666-8666-666666666666';
const NODE = 'n'.repeat(26);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const state = (keepable: boolean) => ({
  node: NODE,
  binding: {
    type: 'binding',
    id: 'b1',
    query: '44444444-4444-4444-8444-444444444441',
    parameters: {},
    mode: 'checked',
    take: { column: 'name' },
  },
  held: {
    dataset: '55555555-5555-4555-8555-555555555555',
    version: HELD,
    number: '0.1',
    provenance: {
      parameters: {},
      ran: { sql: null },
      identity: { kind: 'service' },
      at: '2026-10-05T09:00:00.000Z',
      rowCount: 1,
      checksum: '0'.repeat(64),
    },
    name: null,
    stale: true,
    taken: null,
    act: 'resolve',
    keepable,
    by: { id: 'p', displayName: 'Ada' },
    at: '2026-10-05T09:00:00.000Z',
  },
  waiting: null,
  definition: null,
  connection: null,
});

/** A client answering the bindings view with this keepable, and recording what was asked. */
function serviceWith(keepable: boolean, resolveStatus = 200) {
  const asked: { method: string; path: string; query: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    asked.push({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body: text === '' ? null : JSON.parse(text),
    });
    if (url.pathname.endsWith('/bindings')) return json(200, { bindings: [state(keepable)] });
    if (url.pathname.endsWith('/resolve')) {
      return resolveStatus === 200
        ? json(200, { results: [] })
        : json(resolveStatus, { code: 'forbidden', message: 'No.' });
    }
    return json(200, state(false));
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://settle.test', fetch: fetching }), asked };
}

describe("a binding placed or changed in a document's editor (the B2 plan, B2-C, B2-H)", () => {
  it("resolves a binding just placed from the author's own editing session", async () => {
    const { client, asked } = serviceWith(false);
    expect(await settleBinding(client, DOCUMENT, NODE, 'b1', SESSION, 'placed')).toBeNull();
    expect(asked.filter((each) => each.method === 'POST')).toEqual([
      {
        method: 'POST',
        path: `/v1/documents/${DOCUMENT}/bindings/resolve`,
        query: '',
        body: { bindings: [{ node: NODE, binding: 'b1', from: 'session' }], session: SESSION },
      },
    ]);
  });

  it('keeps the value after a change that leaves the question unchanged, and resolves it otherwise', async () => {
    const kept = serviceWith(true);
    await settleBinding(kept.client, DOCUMENT, NODE, 'b1', SESSION, 'changed');
    expect(kept.asked[0]).toMatchObject({ method: 'GET', query: `?session=${SESSION}` });
    expect(kept.asked.filter((each) => each.method === 'POST')).toEqual([
      {
        method: 'POST',
        path: `/v1/documents/${DOCUMENT}/bindings/confirm`,
        query: '',
        body: { node: NODE, binding: 'b1', replaces: HELD, from: 'session', session: SESSION },
      },
    ]);
    const resolved = serviceWith(false);
    await settleBinding(resolved.client, DOCUMENT, NODE, 'b1', SESSION, 'changed');
    expect(
      resolved.asked.filter((each) => each.method === 'POST').map((each) => each.path),
    ).toEqual([`/v1/documents/${DOCUMENT}/bindings/resolve`]);
  });

  it('settles one binding an act at a time, so a Keep asked while a Change settles reads what that left', async () => {
    const order: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      order.push(`${request.method} ${path.split('/').at(-1)}`);
      if (path.endsWith('/bindings')) {
        if (first) {
          first = false;
          await held;
        }
        return json(200, { bindings: [state(true)] });
      }
      return json(200, state(false));
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://settle.test', fetch: fetching });
    const change = settleBinding(client, DOCUMENT, NODE, 'b1', SESSION, 'changed');
    const keep = settleBinding(client, DOCUMENT, NODE, 'b1', SESSION, 'keep');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['GET bindings']);
    release();
    await Promise.all([change, keep]);
    expect(order).toEqual(['GET bindings', 'POST confirm', 'GET bindings', 'POST confirm']);
  });

  it('says the value changed meanwhile where the service answers that it moved on', async () => {
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return new URL(request.url).pathname.endsWith('/bindings')
        ? json(200, { bindings: [state(true)] })
        : json(409, { code: 'resolution_precondition', message: 'No.' });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://settle.test', fetch: fetching });
    expect(await settleBinding(client, DOCUMENT, NODE, 'b1', null, 'keep')).toBe(
      'The value changed meanwhile. Look at it again in the Value panel.',
    );
  });

  it('reads the binding from the version where the page holds no session of its own, and says who may resolve one it may not', async () => {
    const { client, asked } = serviceWith(true, 403);
    await settleBinding(client, DOCUMENT, NODE, 'b1', null, 'keep');
    expect(asked.filter((each) => each.method === 'POST')[0]!.body).toEqual({
      node: NODE,
      binding: 'b1',
      replaces: HELD,
    });
    expect(await settleBinding(client, DOCUMENT, NODE, 'b1', null, 'resolve')).toBe(
      'This value holds nothing until somebody who may use its connection resolves it.',
    );
  });
});
