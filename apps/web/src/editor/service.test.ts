import { createApiClient } from '@alloy-works/api-client';
import type { ContentDocument } from '@alloy-works/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editingSessionFor, sessionService } from './service.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GRACE = 'f1e2d3c4-b5a6-4978-8899-aabbccddeeff';

/** A storage this file controls directly, never the real `sessionStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    peek: (key: string) => store.get(key),
  };
}

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('editingSessionFor', () => {
  it('mints and stores a new session id when nothing is stored yet', () => {
    const storage = memoryStorage();
    const id = editingSessionFor(COMPONENT, () => true, storage);
    expect(id).toMatch(LOWERCASE_UUID);
    expect(storage.peek(`alloy-works:editing-session:${COMPONENT}`)).toBe(id);
  });

  it('keeps the stored id when the caller is told they hold the lock under it (task 10, finding C)', () => {
    const storage = memoryStorage({ [`alloy-works:editing-session:${COMPONENT}`]: SESSION });
    const id = editingSessionFor(COMPONENT, (stored) => stored === SESSION, storage);
    expect(id).toBe(SESSION);
  });

  it('mints a new id when the caller does not hold the lock under the stored one (task 10, finding C)', () => {
    const storage = memoryStorage({ [`alloy-works:editing-session:${COMPONENT}`]: SESSION });
    const id = editingSessionFor(COMPONENT, () => false, storage);
    expect(id).not.toBe(SESSION);
    expect(id).toMatch(LOWERCASE_UUID);
    expect(storage.peek(`alloy-works:editing-session:${COMPONENT}`)).toBe(id);
  });

  it('mints a new id when the stored value is not a lowercase uuid (task 10, finding C)', () => {
    const storage = memoryStorage({
      [`alloy-works:editing-session:${COMPONENT}`]: SESSION.toUpperCase(),
    });
    const id = editingSessionFor(COMPONENT, () => true, storage);
    expect(id).not.toBe(SESSION.toUpperCase());
    expect(id).toMatch(LOWERCASE_UUID);
  });

  it('mints a new id when the stored value merely has the right length and character set', () => {
    // The old `[0-9a-f-]{36}` regex accepted this; it is not a uuid's grouping.
    const garbage = 'a'.repeat(36);
    const storage = memoryStorage({ [`alloy-works:editing-session:${COMPONENT}`]: garbage });
    const id = editingSessionFor(COMPONENT, () => true, storage);
    expect(id).not.toBe(garbage);
    expect(id).toMatch(LOWERCASE_UUID);
  });

  it('mints a new id, without failing, when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
    };
    const id = editingSessionFor(COMPONENT, () => true, storage);
    expect(id).toMatch(LOWERCASE_UUID);
  });

  describe('when no storage is given (falls back to sessionStorage itself)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

    afterEach(() => {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    });

    it('mints a new id, without failing, when merely reading sessionStorage throws (fix round 1, finding 6)', () => {
      // A default parameter's expression is evaluated outside any try in the function body - some
      // embeddings (a sandboxed iframe with storage access denied) throw a SecurityError on the
      // property read itself, before `.getItem`/`.setItem` are ever reached.
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
      const id = editingSessionFor(COMPONENT, () => true);
      expect(id).toMatch(LOWERCASE_UUID);
    });
  });
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A client whose fetch answers by method and path, recording every request's method, path and body.
 * openapi-fetch builds a `Request` itself and calls `fetch(request, requestInitExt)` (its own extra
 * options, never used here) - so a call's `AbortSignal`, when it gave one, lives on `request.signal`,
 * not on the second argument.
 */
function harness(handler: (request: Request, body: unknown) => Response | Promise<Response>) {
  const requests: { method: string; path: string; body: unknown; signal: AbortSignal }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const text =
      request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    const url = new URL(request.url);
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      body,
      signal: request.signal,
    });
    return handler(request, body);
  });
  const client = createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: fetching as unknown as typeof fetch,
  });
  return { client, requests };
}

const doc = (text: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: text, marks: [] }],
    },
  ],
});

describe('sessionService', () => {
  describe('claim', () => {
    it('sends only the session when not moving, no unknown members (task 10, finding F)', async () => {
      const { client, requests } = harness(() =>
        json(200, {
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: 't',
            yours: true,
            session: SESSION,
          },
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.claim(false, false);
      expect(result).toEqual({ ok: true });
      expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        { method: 'POST', path: `/v1/components/${COMPONENT}/lock`, body: { session: SESSION } },
      ]);
    });

    it('sends move only when true, never move: false (task 10, finding F)', async () => {
      const { client, requests } = harness(() =>
        json(200, {
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: 't',
            yours: true,
            session: SESSION,
          },
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      await service.claim(true, false);
      expect(requests[0]!.body).toEqual({ session: SESSION, move: true });
    });

    it('mints and stores a fresh lowercase session id, and uses it for this and later calls (task 10, finding B)', async () => {
      const storage = memoryStorage();
      const { client, requests } = harness(() =>
        json(200, {
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: 't',
            yours: true,
            session: SESSION,
          },
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA, storage);
      await service.claim(false, true);
      const sent = requests[0]!.body as { session: string };
      expect(sent.session).not.toBe(SESSION);
      expect(sent.session).toMatch(LOWERCASE_UUID);
      expect(storage.peek(`alloy-works:editing-session:${COMPONENT}`)).toBe(sent.session);

      await service.save(1, 'v1', doc('Unbox'));
      const savedPath = requests[1]!.path;
      expect(savedPath).toBe(`/v1/components/${COMPONENT}/iterations/${sent.session}/1`);
    });

    describe('minting fresh with no storage given (falls back to sessionStorage itself)', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

      afterEach(() => {
        if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
      });

      it('still claims, without failing, when merely reading sessionStorage throws (fix round 1, finding 6)', async () => {
        Object.defineProperty(globalThis, 'sessionStorage', {
          configurable: true,
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
        const { client } = harness(() =>
          json(200, {
            lock: {
              holder: { id: ADA, name: 'Ada' },
              expectedRelease: 't',
              yours: true,
              session: SESSION,
            },
          }),
        );
        const service = sessionService(client, COMPONENT, SESSION, ADA);
        const result = await service.claim(false, true);
        expect(result).toEqual({ ok: true });
      });
    });

    it('maps a lock_held refusal, computing yours from the principal (task 10, finding A)', async () => {
      const { client } = harness(() =>
        json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: GRACE, name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.claim(false, false);
      expect(result).toEqual({
        ok: false,
        code: 'lock_held',
        holder: { name: 'Grace', expectedRelease: '2026-09-16T09:15:00.000Z', yours: false },
      });
    });

    it('tells the holder is the caller themselves when the holder id matches the principal', async () => {
      const { client } = harness(() =>
        json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: ADA, name: 'Ada' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.claim(false, false);
      expect(result).toMatchObject({ ok: false, code: 'lock_held', holder: { yours: true } });
    });

    it('answers failed on a server error', async () => {
      const { client } = harness(() =>
        json(500, { code: 'internal', message: 'no', traceId: 't' }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      expect(await service.claim(false, false)).toEqual({ ok: false, code: 'failed' });
    });

    it('tells signed out, no longer allowed, no longer readable and refused requests apart from a failure', async () => {
      const answers: [number, string, string][] = [
        [401, 'unauthenticated', 'signed_out'],
        [403, 'forbidden', 'forbidden'],
        [404, 'not_found', 'not_found'],
        [400, 'invalid_request', 'invalid'],
      ];
      for (const [status, code, expected] of answers) {
        const { client } = harness(() => json(status, { code, message: 'no', traceId: 't' }));
        const service = sessionService(client, COMPONENT, SESSION, ADA);
        expect(await service.claim(false, false)).toEqual({ ok: false, code: expected });
      }
    });

    it('answers failed when the request itself fails, never throwing', async () => {
      const { client } = harness(() => {
        throw new Error('network down');
      });
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      expect(await service.claim(false, false)).toEqual({ ok: false, code: 'failed' });
    });

    it('forwards the given AbortSignal, so aborting it cancels the request (task 10, finding E)', async () => {
      const controller = new AbortController();
      let sawAborted = false;
      const { client } = harness((request) => {
        // Aborting the given controller here stands in for the session's timeout firing while this
        // call is still on the wire; the request built from it must carry that abort through.
        controller.abort();
        sawAborted = request.signal.aborted;
        return json(200, {
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: 't',
            yours: true,
            session: SESSION,
          },
        });
      });
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      await service.claim(false, false, controller.signal);
      expect(sawAborted).toBe(true);
    });

    it('never aborts the request when no signal was given', async () => {
      let sawAborted: boolean | undefined;
      const { client } = harness((request) => {
        sawAborted = request.signal.aborted;
        return json(200, {
          lock: {
            holder: { id: ADA, name: 'Ada' },
            expectedRelease: 't',
            yours: true,
            session: SESSION,
          },
        });
      });
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      await service.claim(false, false);
      expect(sawAborted).toBe(false);
    });
  });

  describe('save', () => {
    it('sends only openedFrom and the content, sequence in the path (task 10, finding F)', async () => {
      const { client, requests } = harness(() => json(200, { sequence: 1, lock: null }));
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.save(1, 'v1', doc('Unbox'));
      expect(result).toEqual({ ok: true });
      expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        {
          method: 'PUT',
          path: `/v1/components/${COMPONENT}/iterations/${SESSION}/1`,
          body: { openedFrom: 'v1', content: doc('Unbox') },
        },
      ]);
    });

    it.each([
      'lock_held',
      'lock_required',
      'version_precondition',
      'iteration_stale',
      'iteration_conflict',
    ])('passes the known refusal code %s straight through (task 10, finding A)', async (code) => {
      const { client } = harness(() => json(409, { code, message: 'no', traceId: 't', latest: 3 }));
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.save(2, 'v1', doc('Unbox'));
      expect(result).toEqual({ ok: false, code, latest: 3 });
    });

    it('maps a server error to failed, without a latest', async () => {
      const { client } = harness(() =>
        json(500, { code: 'internal', message: 'no', traceId: 't' }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.save(1, 'v1', doc('Unbox'));
      expect(result).toEqual({ ok: false, code: 'failed' });
    });

    it('answers failed when the request itself fails, never throwing', async () => {
      const { client } = harness(() => {
        throw new Error('network down');
      });
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      expect(await service.save(1, 'v1', doc('Unbox'))).toEqual({ ok: false, code: 'failed' });
    });

    it('answers signed_out to a 401, forbidden to a 403, not_found to a 404 and invalid to a 400 content_invalid', async () => {
      const answers: [number, string, string][] = [
        [401, 'unauthenticated', 'signed_out'],
        [403, 'forbidden', 'forbidden'],
        [404, 'not_found', 'not_found'],
        [400, 'content_invalid', 'invalid'],
      ];
      for (const [status, code, expected] of answers) {
        const { client } = harness(() => json(status, { code, message: 'no', traceId: 't' }));
        const service = sessionService(client, COMPONENT, SESSION, ADA);
        expect(await service.save(1, 'v1', doc('Unbox'))).toEqual({ ok: false, code: expected });
      }
    });

    it('forwards the given AbortSignal, so aborting it cancels the request (task 10, finding E)', async () => {
      const controller = new AbortController();
      let sawAborted = false;
      const { client } = harness((request) => {
        controller.abort();
        sawAborted = request.signal.aborted;
        return json(200, { sequence: 1, lock: null });
      });
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      await service.save(1, 'v1', doc('Unbox'), controller.signal);
      expect(sawAborted).toBe(true);
    });
  });

  describe('cut', () => {
    it('sends exactly session and openedFrom, no unknown members (task 10, finding F)', async () => {
      const { client, requests } = harness(() =>
        json(200, {
          outcome: 'cut',
          version: { id: 'v2', number: '0.2', author: ADA, createdAt: 't', note: null },
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.cut('v1');
      expect(result).toEqual({
        ok: true,
        outcome: 'cut',
        version: { id: 'v2', number: '0.2', author: ADA, createdAt: 't', note: null },
      });
      expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        {
          method: 'POST',
          path: `/v1/components/${COMPONENT}/versions`,
          body: { session: SESSION, openedFrom: 'v1' },
        },
      ]);
    });

    it('passes a refusal code through unchanged, and has no holder to carry (task 10, finding G)', async () => {
      const { client } = harness(() =>
        json(409, { code: 'lock_held', message: 'no', traceId: 't' }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.cut('v1');
      expect(result).toEqual({ ok: false, code: 'lock_held' });
      expect(result).not.toHaveProperty('holder');
    });

    it('answers signed_out, forbidden, not_found and invalid by status, whatever the code says', async () => {
      const answers: [number, string][] = [
        [401, 'signed_out'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [400, 'invalid'],
      ];
      for (const [status, expected] of answers) {
        const { client } = harness(() =>
          json(status, { code: 'anything', message: 'no', traceId: 't' }),
        );
        const service = sessionService(client, COMPONENT, SESSION, ADA);
        expect(await service.cut('v1')).toEqual({ ok: false, code: expected });
      }
    });
  });

  describe('release', () => {
    it('sends exactly session and openedFrom in the query, and no body (task 10, finding F)', async () => {
      const { client, requests } = harness(() =>
        json(200, {
          outcome: 'unchanged',
          version: { id: 'v1', number: '0.1', author: ADA, createdAt: 't', note: null },
        }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.release('v1');
      expect(result).toEqual({
        ok: true,
        outcome: 'unchanged',
        version: { id: 'v1', number: '0.1', author: ADA, createdAt: 't', note: null },
      });
      expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        {
          method: 'DELETE',
          path: `/v1/components/${COMPONENT}/lock?session=${SESSION}&openedFrom=v1`,
          body: undefined,
        },
      ]);
    });

    it('passes a refusal code through unchanged', async () => {
      const { client } = harness(() =>
        json(409, { code: 'lock_required', message: 'no', traceId: 't' }),
      );
      const service = sessionService(client, COMPONENT, SESSION, ADA);
      const result = await service.release('v1');
      expect(result).toEqual({ ok: false, code: 'lock_required' });
    });

    it('answers signed_out, forbidden, not_found and invalid by status, whatever the code says, for a release too', async () => {
      const answers: [number, string][] = [
        [401, 'signed_out'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [400, 'invalid'],
      ];
      for (const [status, expected] of answers) {
        const { client } = harness(() =>
          json(status, { code: 'anything', message: 'no', traceId: 't' }),
        );
        const service = sessionService(client, COMPONENT, SESSION, ADA);
        expect(await service.release('v1')).toEqual({ ok: false, code: expected });
      }
    });
  });
});
