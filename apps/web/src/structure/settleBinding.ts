import type { createApiClient } from '@alloy-works/api-client';
import type { ParameterRule } from '@alloy-works/domain';

import { PARAMETER_WORDS } from '../editor/ValueDialog.js';

import { bindingStatesIn, type BindingState } from './bindingContexts.js';
import { codeOf, identityRefusal, NOT_HELD } from './ownView.js';
import { followPending, WAITING_ON_IMAGES } from './pendingResult.js';
import type { RevisionDecision } from './RevisionAsk.js';

type Client = ReturnType<typeof createApiClient>;

/** What the editor asks of a binding: placed or changed there, or Keep or Resolve in its panel. */
export type SettleAct = 'placed' | 'changed' | 'keep' | 'resolve';

/** Why a binding was left holding nothing, in words, by the status the service answered. */
const WHY = {
  forbidden: 'This value holds nothing until somebody who may use its connection resolves it.',
  failed: 'The value could not be fetched. Resolve it again from the Value panel.',
  moved: 'The value changed meanwhile. Look at it again in the Value panel.',
} as const satisfies Record<'forbidden' | 'failed' | 'moved', string>;

/**
 * What a document's parameter given as a value's argument broke, as a resolve's refusal names it (the
 * TP2 plan, TP2-C): `feeds` and `type` name the document's parameter, never its declaration.
 */
export const ARGUMENT_WORDS = {
  feeds: 'is not one its template gives to values',
  type: 'is not of the type the value takes',
} as const satisfies Record<'feeds' | 'type', string>;

/**
 * A resolve refused as `parameter_invalid`, in words: each problem by the parameter it names - the
 * document's for `feeds` and `type`, the value's own otherwise - or null for any other refusal.
 */
export function argumentRefusalSaid(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, problems } = error as { code?: unknown; problems?: unknown };
  if (code !== 'parameter_invalid' || !Array.isArray(problems)) return null;
  const sentences = problems.flatMap((each: unknown) => {
    if (typeof each !== 'object' || each === null) return [];
    const { parameter, rule } = each as { parameter?: unknown; rule?: unknown };
    if (typeof parameter !== 'string' || typeof rule !== 'string') return [];
    if (rule === 'feeds' || rule === 'type') {
      return [`The document's ${parameter} ${ARGUMENT_WORDS[rule]}.`];
    }
    const words = (PARAMETER_WORDS as Record<string, string>)[rule as ParameterRule];
    return [`This value's ${parameter} ${words ?? 'does not fit its parameter'}.`];
  });
  return sentences.length === 0
    ? null
    : `${sentences.join(' ')} Change the value's parameters, or the document's.`;
}

/** How a settle that waits on a result's images says so, and pauses between asks (a test's). */
export interface SettleOptions {
  readonly onWaiting?: (words: string) => void;
  readonly wait?: (ms: number) => Promise<void>;
  /**
   * Asks the person, before their own view is held, whether everybody who may read the document may
   * see it (DAT-091); answers whether they agreed. Without it, one's own view is never held.
   */
  readonly ask?: () => Promise<boolean>;
  /**
   * Asks the person what to do with the values revised by hand standing on what the binding holds
   * (DAT-060), given the binding as the refusal says it stands; null where they cancel. Without it,
   * such a binding is left as it is, and said so.
   */
  readonly decide?: (
    state: BindingState,
    act: 'Resolve' | 'Keep',
  ) => Promise<RevisionDecision | null>;
}

/** Said where a binding is left as it is because a value revised by hand stands and nobody decided. */
export const REVISION_UNDECIDED =
  'A value revised by hand stands here, so nothing was changed. Resolve or keep it from the Data tab, which asks whether to keep the revision.';

/**
 * The binding as a `revision_decision_required` refusal says it stands, or undefined for any other.
 */
export function undecidedIn(error: unknown): BindingState | undefined {
  if (codeOf(error) !== 'revision_decision_required') return undefined;
  const current = (error as { current?: unknown }).current;
  return bindingStatesIn({ bindings: [current] })?.[0];
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
  let revisions: RevisionDecision | undefined;
  const decided = () =>
    revisions === undefined ? {} : { revisions: { ...revisions, over: [...revisions.over] } };
  let shares = false;
  const resolve = () =>
    client.POST('/v1/documents/{id}/bindings/resolve', {
      params: { path: { id: document } },
      body: {
        bindings: [{ node, binding, ...from, ...decided() }],
        ...named,
        ...(shares ? { sharesOwnView: true } : {}),
      },
    });
  const confirm = (kept: string) =>
    client.POST('/v1/documents/{id}/bindings/confirm', {
      params: { path: { id: document } },
      body: { node, binding, replaces: kept, ...from, ...named, ...decided() },
    });
  const send = () => (replaces !== null ? confirm(replaces) : resolve());
  let { data, error, response } = await send();
  // Each asked at most once, in whichever order the service refuses them (the RV final review, M6):
  // a value revised by hand standing on what it holds is never replaced until somebody says
  // (DAT-060), and one's own view is held only once they agree to share it (D7-H).
  for (let asked = 0; asked < 2; asked += 1) {
    const undecided = revisions === undefined ? undecidedIn(error) : undefined;
    if (undecided !== undefined) {
      const answer =
        options.decide === undefined
          ? null
          : await options.decide(undecided, replaces !== null ? 'Keep' : 'Resolve');
      if (answer === null) return REVISION_UNDECIDED;
      revisions = answer;
    } else if (replaces === null && !shares && codeOf(error) === 'acknowledgement_required') {
      if (options.ask === undefined || !(await options.ask())) return NOT_HELD;
      shares = true;
    } else {
      break;
    }
    ({ data, error, response } = await send());
  }
  const refused = identityRefusal(error);
  if (refused !== null) return refused;
  const argument = response.status === 400 ? argumentRefusalSaid(error) : null;
  if (argument !== null) return argument;
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
