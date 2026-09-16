import type { createApiClient } from '@alloy-works/api-client';
import type { ContentDocument } from '@alloy-works/domain';

import type { ClaimResult, CutResult, SaveResult, SessionService } from './session.js';

type Client = ReturnType<typeof createApiClient>;

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where a component's editing session id is kept, one slot per component per window. */
const storageKeyFor = (componentId: string) => `alloy-works:editing-session:${componentId}`;

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
    if (kept && LOWERCASE_UUID.test(kept) && isHeldByMe(kept)) return kept;
  } catch {
    // Unavailable storage is not an error: the session is simply this page's alone.
  }
  const made = crypto.randomUUID();
  try {
    (storage ?? globalThis.sessionStorage).setItem(key, made);
  } catch {
    // As above.
  }
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

/** Decision F: the wire uses an underscore in every code. */
const savedCodes = [
  'lock_held',
  'lock_required',
  'version_precondition',
  'iteration_stale',
  'iteration_conflict',
] as const;

/**
 * The session's four writes, through the generated client and nothing else (API-001).
 *
 * `initialSession` seeds the id this adapter claims under - normally `editingSessionFor`'s answer -
 * but the adapter, not the id passed in, owns it from here on (task 10, finding B): `claim(move,
 * true)` mints a fresh lowercase UUID, stores it for this component, and every later call - this
 * claim and every save, cut and release after it - uses that new id, never the one this was
 * constructed with.
 *
 * `principal` is the signed-in principal's id, so a lock held from another window of the same author
 * is told apart from somebody else's.
 */
export function sessionService(
  client: Client,
  componentId: string,
  initialSession: string,
  principal: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): SessionService {
  const path = { id: componentId };
  let current = initialSession;

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
      }
      try {
        const { data, error } = await client.POST('/v1/components/{id}/lock', {
          params: { path },
          body: { session: current, ...(move ? { move } : {}) },
          signal,
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
        return { ok: false, code: 'failed' };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async save(sequence, openedFrom, content: ContentDocument, signal): Promise<SaveResult> {
      try {
        const { data, error } = await client.PUT(
          '/v1/components/{id}/iterations/{session}/{sequence}',
          {
            params: { path: { ...path, session: current, sequence: String(sequence) } },
            body: { openedFrom, content: content as unknown as Record<string, unknown> },
            signal,
          },
        );
        if (data) return { ok: true };
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
        const { data, error } = await client.POST('/v1/components/{id}/versions', {
          params: { path },
          body: { session: current, openedFrom },
        });
        if (data) return { ok: true, outcome: data.outcome, version: data.version };
        return { ok: false, code: codeOf(error) };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async release(openedFrom): Promise<CutResult> {
      try {
        const { data, error } = await client.DELETE('/v1/components/{id}/lock', {
          params: { path, query: { session: current, openedFrom } },
        });
        if (data) return { ok: true, outcome: data.outcome, version: data.version };
        return { ok: false, code: codeOf(error) };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },
  };
}
