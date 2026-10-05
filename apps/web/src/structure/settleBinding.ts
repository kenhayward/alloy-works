import type { createApiClient } from '@alloy-works/api-client';

import { bindingStatesIn } from './bindingContexts.js';

type Client = ReturnType<typeof createApiClient>;

/** What the editor asks of a binding: placed or changed there, or Keep or Resolve in its panel. */
export type SettleAct = 'placed' | 'changed' | 'keep' | 'resolve';

/** Why a binding was left holding nothing, in words, by the status the service answered. */
const WHY = {
  forbidden: 'This value holds nothing until somebody who may use its connection resolves it.',
  failed: 'The value could not be fetched. Resolve it again from the Value panel.',
  moved: 'The value changed meanwhile. Look at it again in the Value panel.',
} as const satisfies Record<'forbidden' | 'failed' | 'moved', string>;

/** The act settling each binding now, by document, node and binding, which the next one waits for. */
const settling = new Map<string, Promise<unknown>>();

/**
 * What a document does with a binding its editor placed, changed, or asked to keep or resolve (the
 * B2 plan, B2-C, B2-H; BI-C, BI-J): read from the author's own editing `session` where the page has
 * one, or from the version where it has none. A binding placed, or changed so its question changed,
 * is resolved - the one query placing makes; one changed with its question unchanged, or kept, keeps
 * the result it holds, `confirm`, querying nothing. Answers what the author should be told, or null.
 */
export function settleBinding(
  client: Client,
  document: string,
  node: string,
  binding: string,
  session: string | null,
  act: SettleAct,
): Promise<string | null> {
  // One act at a time for one binding: a Keep asked while a Change settles reads what it left.
  const key = `//`;
  const before = settling.get(key) ?? Promise.resolve();
  const settled = before
    .catch(() => undefined)
    .then(() => settleNow(client, document, node, binding, session, act));
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
  const { response } =
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
  return response.ok ? null : WHY.failed;
}
