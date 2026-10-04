import { bindingDigestInput, type Binding, type TakeFailure } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';

import { editorSchema } from './schema.js';

const bindingNode = editorSchema.nodes.binding!;

/**
 * Why a binding holds no value where the view answered for it: a take's failure (`takeValue`), or a
 * result the service could not read (`unavailable`, B1-H), which is never stored.
 */
export type BindingFailureShown = TakeFailure | 'unavailable';

/**
 * A failure as the host tells it: `take_invalid` with the column, taken or key, the version does not
 * have - the take's outcome names it, so the words never guess which - and `value_many` with its
 * count.
 */
export type BindingFailureHeld = {
  readonly [K in BindingFailureShown]: K extends 'take_invalid'
    ? { readonly failure: K; readonly column: string }
    : { readonly failure: K; readonly count?: number };
}[BindingFailureShown];

/**
 * What the document holds for one binding, as the host tells the surface (B1-J): the binding the view
 * answered for, as `bindingDigestInput` spells it - compared as a string, with no hash in the browser -
 * and what it shows: the value formatted by the document's theme, whether a newer result waits, or why
 * there is none.
 */
export interface BindingHeld {
  readonly binding: string;
  /**
   * Where the host could not read what the document holds for it: its failure is shown, and it has no
   * provenance to open.
   */
  readonly unread?: true;
  readonly shown: { readonly value: string; readonly waiting: boolean } | BindingFailureHeld;
}

/**
 * What the host tells a surface about where its bindings are shown (B1-D): in a document, what it
 * holds for each binding by identifier, for the one occurrence being shown - `node`, the occurrence's
 * outline node, where the host gives it, so the read text can say where a value stands; on its own,
 * each definition's title by its identifier, null where the reader may not read it.
 */
export type BindingContext =
  | {
      readonly kind: 'document';
      readonly held: ReadonlyMap<string, BindingHeld>;
      readonly node?: string;
    }
  | { readonly kind: 'alone'; readonly titles: ReadonlyMap<string, string | null> };

/** What one binding shows, and where it stands in the document it was read from. */
export interface BindingShown {
  readonly pos: number;
  /** Its identifier, where it has one yet. */
  readonly id: string | null;
  /** What is seen: the value, why there is none, or what it asks for. */
  readonly text: string;
  /** The words after it a screen reader is told and nobody sees: its kind (B1-L). */
  readonly hidden: string;
  /** A marker always shown beside a value, by an icon and these words, or null. */
  readonly marker: string | null;
  /** Whether it holds no value, drawn apart by its words and more than colour (DAT-047). */
  readonly failed: boolean;
  /**
   * Whether the document holds a resolution for it as it stands, so it has a provenance to open: in
   * the read text it is then a button (B1-L, B1-M).
   */
  readonly resolved: boolean;
}

/** A binding selected whole, as the Value panel reads it. */
export interface BindingSelected {
  /** Where the `binding` node starts. */
  readonly pos: number;
  /** The binding as the component stores it. */
  readonly binding: Binding;
}

/** What the node says with nothing to tell it more: `toDOM`'s words. */
export const BOUND_VALUE = 'Bound value';

/** A binding the document holds nothing for. */
export const NEVER_RESOLVED = 'No value - never resolved';

/** A binding the author has changed since the document's value was taken for it. */
export const CHANGED_SINCE_RESOLVED = 'No value - the binding changed since it was resolved';

/** A held value with a newer result waiting: shown always, beside the value. */
export const REVISION_WAITING = 'revision waiting';

/** On its own, where the definition's title cannot be shown. */
export const A_BOUND_VALUE = 'a bound value';

/** The class a binding shown on its own carries: the application's chip (B1-K). */
export const ALONE_CLASS = 'aw-binding-alone';

/** The class a binding with no value carries, on the surface and in the read text. */
export const FAILED_CLASS = 'aw-binding-failed';

/** Its kind, as a screen reader is told it after what it shows (B1-L). */
const KIND = ', bound value';

/** `site is north and open is true`: a key's values as stored. */
const keyWords = (key: Readonly<Record<string, string | boolean>>): string =>
  Object.entries(key)
    .map(([name, value]) => `${name} is ${String(value)}`)
    .join(' and ');

/**
 * **The words each failure shows** (B1-J), keyed by the literal union so a code the view gains is a
 * compile error here, not a silent gap: the count and the missing column as the host tells them, the
 * key read from the binding as the editor holds it.
 */
export const BINDING_FAILURE_WORDS = {
  take_invalid: (_binding, held) => `No value - the definition has no column ${held.column}`,
  value_none: () => 'No value - the query returned no rows',
  value_many: (_binding, held) => `No value - the query returned ${held.count ?? 'several'} rows`,
  row_missing: (binding) =>
    'key' in binding.take
      ? `No value - no row where ${keyWords(binding.take.key)}`
      : 'No value - no row',
  value_null: () => 'No value - empty',
  value_empty: () => 'No value - empty',
  unavailable: () => 'No value - the result cannot be read',
} satisfies {
  readonly [K in BindingFailureShown]: (
    binding: Binding,
    held: Extract<BindingFailureHeld, { readonly failure: K }>,
  ) => string;
};

/**
 * The words for one failure, in the text and a value's provenance alike: the record indexed by a union
 * cannot correlate it with its argument.
 */
export const bindingFailureWords = (binding: Binding, held: BindingFailureHeld): string =>
  (BINDING_FAILURE_WORDS[held.failure] as (binding: Binding, held: BindingFailureHeld) => string)(
    binding,
    held,
  );

/** A binding node's attributes as the component stores the binding. */
export function storedBinding(node: Node): Binding {
  const { id, query, version, parameters, mode, take } = node.attrs;
  return {
    type: 'binding',
    id: id as string,
    query: query as string,
    ...(version === null ? {} : { version: version as string }),
    parameters: parameters as Binding['parameters'],
    mode: mode as Binding['mode'],
    take: take as Binding['take'],
  };
}

/** What it asks for: its column, and a key's values as stored. */
const asksFor = (take: Binding['take']): string =>
  'key' in take ? `${take.column} where ${keyWords(take.key)}` : take.column;

/** One binding's words in `context`. */
function shownFor(
  binding: Binding,
  context: BindingContext | null,
): Omit<BindingShown, 'pos' | 'id'> {
  if (context === null) {
    return { text: BOUND_VALUE, hidden: '', marker: null, failed: false, resolved: false };
  }
  if (context.kind === 'alone') {
    const title = context.titles.get(binding.query) ?? null;
    return {
      text: title === null ? A_BOUND_VALUE : `${asksFor(binding.take)}, ${title}`,
      hidden: `${KIND}, a value in each document`,
      marker: null,
      failed: false,
      resolved: false,
    };
  }
  const failed = (text: string, resolved = false) => ({
    text,
    hidden: `${KIND}, failed`,
    marker: null,
    failed: true,
    resolved,
  });
  const held = context.held.get(binding.id);
  if (held === undefined) return failed(NEVER_RESOLVED);
  if (held.binding !== bindingDigestInput(binding)) return failed(CHANGED_SINCE_RESOLVED);
  if ('failure' in held.shown) {
    return failed(bindingFailureWords(binding, held.shown), held.unread !== true);
  }
  return held.shown.waiting
    ? {
        text: held.shown.value,
        hidden: `${KIND},`,
        marker: REVISION_WAITING,
        failed: false,
        resolved: true,
      }
    : { text: held.shown.value, hidden: KIND, marker: null, failed: false, resolved: true };
}

/**
 * **What each binding in `doc` shows** (B1-D, B1-J, B1-K), in document order - pure, so the surface's
 * decorations, a footnote's own editor, the read text and the copy all draw the same words:
 *
 * - **in a document**, the value the document holds where the binding as the editor holds it is the
 *   binding the view answered for - compared by `bindingDigestInput` - with _revision waiting_ beside
 *   it where a newer result waits; otherwise why it has none: never resolved, changed since it was
 *   resolved, or the take's failure in words of its own, each drawn apart;
 * - **on its own**, what it asks for, never a value (BI-B): its column and its definition's title -
 *   _depth, Readings_, _depth where site is north, Readings_ - or _a bound value_ where the reader may
 *   not read the definition, or its title is not known yet;
 * - **with no context**, what the node alone says, `toDOM`'s _Bound value_.
 */
export function bindingsShown(doc: Node, context: BindingContext | null): readonly BindingShown[] {
  const shown: BindingShown[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== bindingNode) return true;
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : null;
    shown.push({ pos, id, ...shownFor(storedBinding(node), context) });
    return false;
  });
  return shown;
}

/** The binding the selection holds whole, or null: a binding is an atom, only ever selected so. */
export function bindingSelected(state: EditorState): BindingSelected | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== bindingNode) return null;
  return { pos: selection.from, binding: storedBinding(selection.node) };
}
