import type { createApiClient } from '@alloy-works/api-client';
import type { ContentDocument } from '@alloy-works/domain';

import { mayKeepEditing } from './editing-storage.js';
import type {
  ClaimResult,
  CutResult,
  IterationPage,
  IterationRead,
  Refusal,
  SaveResult,
  SessionService,
} from './session.js';

type Client = ReturnType<typeof createApiClient>;

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where a component's editing session id is kept, one slot per component per window. */
const storageKeyFor = (componentId: string) => `alloy-works:editing-session:${componentId}`;

/** Where every session id this window has used for a component is kept, newest last. */
const heldKeyFor = (componentId: string) => `alloy-works:editing-sessions:${componentId}`;

/** As many as a window is likely to use for one component; the oldest are forgotten past it. */
const HELD_KEPT = 50;

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The session ids this window has used for a component (final review of W11.2, D4): the Recovery
 * panel marks an iteration as this window's by its session, and a window uses several - the one
 * before a reload, and a fresh one for each Recover or each stale save. Unavailable or unreadable
 * storage is none.
 */
function sessionsHeld(componentId: string, storage?: SessionStorage): string[] {
  try {
    const kept: unknown = JSON.parse(
      (storage ?? globalThis.sessionStorage).getItem(heldKeyFor(componentId)) ?? '[]',
    );
    return Array.isArray(kept)
      ? kept.filter((each): each is string => typeof each === 'string' && LOWERCASE_UUID.test(each))
      : [];
  } catch {
    return [];
  }
}

/** Adds one to them, answering them all. */
function holdSession(componentId: string, id: string, storage?: SessionStorage): string[] {
  const held = [...sessionsHeld(componentId, storage).filter((each) => each !== id), id].slice(
    -HELD_KEPT,
  );
  try {
    if (mayKeepEditing()) {
      (storage ?? globalThis.sessionStorage).setItem(heldKeyFor(componentId), JSON.stringify(held));
    }
  } catch {
    // Unavailable storage: the window's own ids are remembered for this page alone.
  }
  return held;
}

/**
 * The session id this window keeps for a component, or null where it keeps none that is one: what the
 * component's `GET` names, so the service answers where that session's sequence stands whichever way
 * the page then goes on (final review of W11.3, D3).
 */
export function storedSessionId(componentId: string, storage?: Pick<Storage, 'getItem'>) {
  try {
    const kept = (storage ?? globalThis.sessionStorage).getItem(storageKeyFor(componentId));
    return kept !== null && LOWERCASE_UUID.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

/**
 * The editing session's identity for one component in this window: kept in session storage, so a
 * reload of the same tab is the same session, while another window is another session
 * (component-editor.md, "Two windows, one author"; decision 14). Storage that is unavailable, or holds
 * something that is not a lowercase UUID, just means a new session.
 *
 * `isHeldByMe` (task 10, finding C) decides whether the stored id is still good: pass the component
 * view's own answer, `view.lock?.yours === true && view.lock.session === stored`, so a reload while
 * holding the lock keeps it, and reopening after Done editing - where nothing holds it any longer -
 * starts a new session at sequence 0 rather than reusing an id the service has moved on from.
 */
export function editingSessionFor(
  componentId: string,
  isHeldByMe: (stored: string) => boolean,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): string {
  const key = storageKeyFor(componentId);
  try {
    // Reading `sessionStorage` itself, not just calling its methods, can throw (a `SecurityError` in
    // an embedding that denies storage access) - so the fallback is resolved inside the try, never as
    // a default parameter, which runs before any try in this function's own body could catch it (fix
    // round 1, finding 6).
    const kept = (storage ?? globalThis.sessionStorage).getItem(key);
    if (kept && LOWERCASE_UUID.test(kept) && isHeldByMe(kept)) {
      holdSession(componentId, kept, storage);
      return kept;
    }
  } catch {
    // Unavailable storage is not an error: the session is simply this page's alone.
  }
  const made = crypto.randomUUID();
  try {
    // Kept for a reload, unless the author has signed out on this page (re-review of W11.3).
    if (mayKeepEditing()) (storage ?? globalThis.sessionStorage).setItem(key, made);
  } catch {
    // As above.
  }
  holdSession(componentId, made, storage);
  return made;
}

/** A refusal's code, when the body is the service's error shape; `failed` for anything else. */
function codeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'failed';
}

/**
 * A refusal no retry will change, told by the HTTP status (final review, finding 2): the generated
 * client always exposes the response, while a 401 or a 400 from the service's own request handling
 * carries a code no route declares. Anything else - a server error, or no answer at all - is not one.
 */
function refusalOf(response: Response | undefined): Refusal | undefined {
  switch (response?.status) {
    case 401:
      return 'signed_out';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 400:
      return 'invalid';
    default:
      return undefined;
  }
}

/** Decision F: the wire uses an underscore in every code. */
const savedCodes = [
  'lock_held',
  'lock_required',
  'version_precondition',
  'iteration_stale',
  'iteration_conflict',
] as const;

/** Why reading an iteration back was refused: the lock's two codes, or as any request is. */
function readRefusalOf(response: Response | undefined, error: unknown) {
  const code = codeOf(error);
  if (code === 'lock_held' || code === 'lock_required') return code;
  return refusalOf(response) ?? 'failed';
}

/**
 * The session's four writes, and its two reads of what it saved, through the generated client and
 * nothing else (API-001).
 *
 * `initialSession` seeds the id this adapter claims under - normally `editingSessionFor`'s answer -
 * but the adapter, not the id passed in, owns it from here on (task 10, finding B): `claim(move,
 * true)` mints a fresh lowercase UUID, stores it for this component, and every later call - this
 * claim and every save, cut and release after it - uses that new id, never the one this was
 * constructed with.
 *
 * `principal` is the signed-in principal's id, so a lock held from another window of the same author
 * is told apart from somebody else's.
 *
 * `onFresh` is told each id it mints, so the session a window keeps for a reload follows it (W11.3).
 */
export function sessionService(
  client: Client,
  componentId: string,
  initialSession: string,
  principal: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
  onFresh?: (session: string) => void,
): SessionService {
  const path = { id: componentId };
  let current = initialSession;
  // Every session this window has used for the component, so a listed iteration is this window's
  // whether it was saved under the id held now, the one before a fresh claim, or one from before a
  // reload.
  const held = new Set(holdSession(componentId, initialSession, storage));

  return {
    async claim(move, fresh, signal): Promise<ClaimResult> {
      if (fresh) {
        current = crypto.randomUUID();
        try {
          // As `editingSessionFor`'s: the fallback is resolved inside the try (fix round 1, finding 6).
          (storage ?? globalThis.sessionStorage).setItem(storageKeyFor(componentId), current);
        } catch {
          // Unavailable storage does not stop the session; it just is not remembered across a reload.
        }
        for (const each of holdSession(componentId, current, storage)) held.add(each);
        onFresh?.(current);
      }
      try {
        const { data, error, response } = await client.POST('/v1/components/{id}/lock', {
          params: { path },
          body: { session: current, ...(move ? { move } : {}) },
          ...(signal ? { signal } : {}),
        });
        if (data) return { ok: true };
        if (error && codeOf(error) === 'lock_held' && 'holder' in error && error.holder) {
          return {
            ok: false,
            code: 'lock_held',
            holder: {
              name: error.holder.name,
              expectedRelease: error.expectedRelease ?? '',
              yours: error.holder.id === principal,
            },
          };
        }
        return { ok: false, code: refusalOf(response) ?? 'failed' };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async save(
      sequence,
      openedFrom,
      content: ContentDocument,
      signal,
      values,
    ): Promise<SaveResult> {
      try {
        const { data, error, response } = await client.PUT(
          '/v1/components/{id}/iterations/{session}/{sequence}',
          {
            params: { path: { ...path, session: current, sequence: String(sequence) } },
            body: {
              openedFrom,
              content: content as unknown as Record<string, unknown>,
              ...(values === undefined ? {} : { values: { ...values } }),
            },
            ...(signal ? { signal } : {}),
          },
        );
        if (data) return { ok: true };
        const refusal = refusalOf(response);
        if (refusal) return { ok: false, code: refusal };
        const code = codeOf(error);
        const known = savedCodes.find((each) => each === code);
        const latest = error && 'latest' in error ? error.latest : undefined;
        return {
          ok: false,
          code: known ?? 'failed',
          ...(typeof latest === 'number' ? { latest } : {}),
        };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async cut(openedFrom): Promise<CutResult> {
      try {
        const { data, error, response } = await client.POST('/v1/components/{id}/versions', {
          params: { path },
          body: { session: current, openedFrom },
        });
        if (data) return { ok: true, outcome: data.outcome, version: data.version };
        return { ok: false, code: refusalOf(response) ?? codeOf(error) };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async release(openedFrom): Promise<CutResult> {
      try {
        const { data, error, response } = await client.DELETE('/v1/components/{id}/lock', {
          params: { path, query: { session: current, openedFrom } },
        });
        if (data) return { ok: true, outcome: data.outcome, version: data.version };
        return { ok: false, code: refusalOf(response) ?? codeOf(error) };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    // Under the session this adapter holds now: the service answers only the one holding the lock.
    // Each row is this window's where it was saved under any session this window has used.
    async iterations(cursor): Promise<IterationPage> {
      try {
        const { data, error, response } = await client.GET('/v1/components/{id}/iterations', {
          params: {
            path,
            query: { session: current, ...(cursor === undefined ? {} : { cursor }) },
          },
        });
        if (!data) return { ok: false, code: readRefusalOf(response, error) };
        return {
          ok: true,
          items: data.items.map((each) => ({
            id: each.id,
            savedAt: each.createdAt,
            thisWindow: held.has(each.session),
            openedFrom: { id: each.openedFrom.id, number: each.openedFrom.number },
          })),
          next: data.next,
        };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async iteration(id): Promise<IterationRead> {
      try {
        const { data, error, response } = await client.GET(
          '/v1/components/{id}/iterations/{iteration}',
          { params: { path: { ...path, iteration: id }, query: { session: current } } },
        );
        if (!data) return { ok: false, code: readRefusalOf(response, error) };
        return { ok: true, content: data.content, values: data.values };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },
  };
}
