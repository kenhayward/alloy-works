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

  it('settles an act on one binding while an act on another binding is still pending', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const body = (await request.text()) as string;
      if (body.includes('"binding":"b1"')) await held;
      return json(200, { results: [] });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://settle.test', fetch: fetching });
    const a = settleBinding(client, DOCUMENT, NODE, 'b1', SESSION, 'resolve');
    const b = settleBinding(client, DOCUMENT, NODE, 'b2', SESSION, 'resolve');
    const later = new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 50));
    try {
      expect(await Promise.race([b, later])).toBeNull();
    } finally {
      release();
    }
    expect(await a).toBeNull();
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

describe('a resolve whose result waits on its images (the D8 plan, D8-F)', () => {
  const PENDING = '33333333-3333-4333-8333-333333333333';

  /** A service answering a resolve as pending, and following it with each of `follows` in turn. */
  function pendingService(follows: unknown[]) {
    const asked: string[] = [];
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      asked.push(`${request.method} ${path}`);
      if (path.endsWith('/resolve')) {
        return json(202, { results: [{ node: NODE, binding: 'b1', pending: PENDING }] });
      }
      if (path === `/v1/datasets/pending/${PENDING}`) {
        const answer = follows.length > 1 ? follows.shift() : follows[0];
        return answer === undefined
          ? json(404, { code: 'not_found', message: 'No.' })
          : json(200, answer);
      }
      return json(200, { bindings: [state(false)] });
    }) as unknown as typeof fetch;
    return { client: createApiClient({ baseUrl: 'http://settle.test', fetch: fetching }), asked };
  }
  const following = (state: 'pending' | 'done', result: unknown = null) => ({
    id: PENDING,
    act: 'resolve',
    document: DOCUMENT,
    node: NODE,
    binding: 'b1',
    state,
    result,
  });
  const noWait = () => Promise.resolve();

  it('checks back until every image is admitted, saying it waits, then holds the value as a resolve does', async () => {
    const { client, asked } = pendingService([
      following('pending'),
      following('pending'),
      following('done', {
        node: NODE,
        binding: 'b1',
        held: { dataset: '55555555-5555-4555-8555-555555555555', version: HELD, reused: false },
      }),
    ]);
    const said: string[] = [];
    expect(
      await settleBinding(client, DOCUMENT, NODE, 'b1', null, 'resolve', {
        onWaiting: (words) => said.push(words),
        wait: noWait,
      }),
    ).toBeNull();
    expect(said).toEqual([
      'The value holds images, which are being checked. It is shown once every one is.',
    ]);
    expect(asked.filter((each) => each.includes('/datasets/pending/'))).toEqual([
      `GET /v1/datasets/pending/${PENDING}`,
      `GET /v1/datasets/pending/${PENDING}`,
      `GET /v1/datasets/pending/${PENDING}`,
    ]);
  });

  it('says the named failure of a result whose image was refused', async () => {
    const { client } = pendingService([
      following('done', {
        node: NODE,
        binding: 'b1',
        failure: {
          code: 'image_refused',
          attribution: 'query',
          message: 'Row 2, column photo: the image is not a PNG or a JPEG.',
          row: 2,
          column: 'photo',
          definition: '44444444-4444-4444-8444-444444444441',
          binding: 'b1',
          node: NODE,
          document: DOCUMENT,
        },
      }),
    ]);
    expect(
      await settleBinding(client, DOCUMENT, NODE, 'b1', null, 'resolve', { wait: noWait }),
    ).toBe('Row 2, column photo: the image is not a PNG or a JPEG.');
  });

  it('says so where the images take longer than it waits, or the pending result is gone', async () => {
    const slow = pendingService([following('pending')]);
    expect(
      await settleBinding(slow.client, DOCUMENT, NODE, 'b1', null, 'resolve', { wait: noWait }),
    ).toBe('Checking the images is taking longer than it should. Look again in a moment.');
    expect(slow.asked.filter((each) => each.includes('/datasets/pending/'))).toHaveLength(60);
    const gone = pendingService([undefined]);
    expect(
      await settleBinding(gone.client, DOCUMENT, NODE, 'b1', null, 'resolve', { wait: noWait }),
    ).toBe('The value could not be fetched. Try again.');
  });
});
