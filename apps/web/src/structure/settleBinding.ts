import type { createApiClient } from '@alloy-works/api-client';

import { bindingStatesIn } from './bindingContexts.js';

type Client = ReturnType<typeof createApiClient>;

/** What the editor asks of a binding: placed or changed there, or Keep or Resolve in its panel. */
export type SettleAct = 'placed' | 'changed' | 'keep' | 'resolve';

/** Why a binding was left holding nothing, in words, by the status the service answered. */
const WHY = {
  forbidden: 'This value holds nothing until somebody who may use its connection resolves it.',
  failed: 'The value could not be fetched. Resolve it again from the Value panel.',
} as const satisfies Record<'forbidden' | 'failed', string>;

/**
 * What a document does with a binding its editor placed, changed, or asked to keep or resolve (the
 * B2 plan, B2-C, B2-H; BI-C, BI-J): read from the author's own editing `session` where the page has
 * one, or from the version where it has none. A binding placed, or changed so its question changed,
 * is resolved - the one query placing makes; one changed with its question unchanged, or kept, keeps
 * the result it holds, `confirm`, querying nothing. Answers what the author should be told, or null.
 */
export async function settleBinding(
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
  return response.ok ? null : WHY.failed;
}
