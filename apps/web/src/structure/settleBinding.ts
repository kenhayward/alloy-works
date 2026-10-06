import type { createApiClient } from '@alloy-works/api-client';

import { bindingStatesIn } from './bindingContexts.js';
import { followPending, WAITING_ON_IMAGES } from './pendingResult.js';

type Client = ReturnType<typeof createApiClient>;

/** What the editor asks of a binding: placed or changed there, or Keep or Resolve in its panel. */
export type SettleAct = 'placed' | 'changed' | 'keep' | 'resolve';

/** Why a binding was left holding nothing, in words, by the status the service answered. */
const WHY = {
  forbidden: 'This value holds nothing until somebody who may use its connection resolves it.',
  failed: 'The value could not be fetched. Resolve it again from the Value panel.',
  moved: 'The value changed meanwhile. Look at it again in the Value panel.',
} as const satisfies Record<'forbidden' | 'failed' | 'moved', string>;

/** How a settle that waits on a result's images says so, and pauses between asks (a test's). */
export interface SettleOptions {
  readonly onWaiting?: (words: string) => void;
  readonly wait?: (ms: number) => Promise<void>;
}

/** The act settling each binding now, by document, node and binding, which the next one waits for. */
const settling = new Map<string, Promise<unknown>>();

/**
 * What a document does with a binding its editor placed, changed, or asked to keep or resolve (the
 * B2 plan, B2-C, B2-H; BI-C, BI-J): read from the author's own editing `session` where the page has
 * one, or from the version where it has none. A binding placed, or changed so its question changed,
 * is resolved - the one query placing makes; one changed with its question unchanged, or kept, keeps
 * the result it holds, `confirm`, querying nothing. A result waiting on its images is followed until
 * it is recorded (the D8 plan, D8-F), saying so meanwhile. Answers what the author should be told, or
 * null.
 */
export function settleBinding(
  client: Client,
  document: string,
  node: string,
  binding: string,
  session: string | null,
  act: SettleAct,
  options: SettleOptions = {},
): Promise<string | null> {
  // One act at a time for one binding: a Keep asked while a Change settles reads what it left.
  const key = `${document}/${node}/${binding}`;
  const before = settling.get(key) ?? Promise.resolve();
  const settled = before
    .catch(() => undefined)
    .then(() => settleNow(client, document, node, binding, session, act, options));
  settling.set(key, settled);
  void settled
    .catch(() => undefined)
    .finally(() => {
      if (settling.get(key) === settled) settling.delete(key);
    });
  return settled;
}

async function settleNow(
  client: Client,
  document: string,
  node: string,
  binding: string,
  session: string | null,
  act: SettleAct,
  options: SettleOptions,
): Promise<string | null> {
  const from = session === null ? {} : { from: 'session' as const };
  const named = session === null ? {} : { session };
  let replaces: string | null = null;
  if (act === 'changed' || act === 'keep') {
    const { data } = await client.GET('/v1/documents/{id}/bindings', {
      params: { path: { id: document }, query: named },
    });
    const held = bindingStatesIn(data)?.find(
      (each) => each.node === node && each.binding.id === binding,
    )?.held;
    if (held?.keepable === true) replaces = held.version;
  }
  const { data, response } =
    replaces !== null
      ? await client.POST('/v1/documents/{id}/bindings/confirm', {
          params: { path: { id: document } },
          body: { node, binding, replaces, ...from, ...named },
        })
      : await client.POST('/v1/documents/{id}/bindings/resolve', {
          params: { path: { id: document } },
          body: { bindings: [{ node, binding, ...from }], ...named },
        });
  if (response.status === 403) return WHY.forbidden;
  if (response.status === 409) return WHY.moved;
  if (!response.ok) return WHY.failed;
  // Its images are being admitted: followed, as an upload is, then said as the resolve's own result.
  const results = (data as { results?: unknown } | undefined)?.results;
  const pending = Array.isArray(results)
    ? (results as { node?: unknown; binding?: unknown; pending?: unknown }[]).find(
        (each) => each.node === node && each.binding === binding,
      )?.pending
    : undefined;
  if (typeof pending !== 'string') return null;
  options.onWaiting?.(WAITING_ON_IMAGES);
  const followed = await followPending(client, pending, options.wait);
  if ('sentence' in followed) return followed.sentence;
  const failure = followed.done.failure as { message?: unknown } | undefined;
  if (failure === undefined) return null;
  return typeof failure.message === 'string' ? failure.message : WHY.failed;
}
