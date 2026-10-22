import { closeHistory } from 'prosemirror-history';
import type { Mapping } from 'prosemirror-transform';
import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { positionedText } from './marks.js';
import { editorSchema } from './schema.js';

/*
 * Terms in the editor (the TM plan, TMc; terms.md): a term offered as its abbreviation or a label is
 * typed (TM-L, LIB-019), and a deprecated or unreadable one flagged where it is used (LIB-018). The
 * host hands in the space's index and each used term's standing; the service decides both.
 */

const termType = editorSchema.marks.definedTerm!;

/** A term as the suggestions offer it: every label, alternative and abbreviation, in any language. */
export interface TermOffered {
  readonly id: string;
  /** Its preferred label in its base language. */
  readonly label: string;
  readonly abbreviation: string | null;
  readonly forms: readonly string[];
}

/** A used term as the service answers it to its reader. */
export interface TermStanding {
  readonly standing: 'approved' | 'draft' | 'deprecated' | 'unavailable';
  readonly label: string | null;
  readonly replacedBy: { readonly id: string; readonly label: string | null } | null;
}

export type TermStandings = ReadonlyMap<string, TermStanding>;

/** An offer standing at the caret: each term over its own words, all ending at `to`. */
export interface TermSuggestion {
  readonly to: number;
  /** Where the first offer's words start. */
  readonly from: number;
  readonly offers: readonly { readonly term: TermOffered; readonly from: number }[];
  readonly active: number;
  /** Whether an arrow has moved the active term: only then does Enter apply it. */
  readonly moved: boolean;
}

/** The most terms one offer holds. */
export const OFFERED_MOST = 5;

interface Indexed {
  /** The terms as the host handed them in. */
  readonly offered: readonly TermOffered[];
  /** Each form by its last word, lower-cased. */
  readonly byLast: ReadonlyMap<string, readonly { form: string; term: TermOffered }[]>;
}

interface TermsState {
  readonly index: Indexed | null;
  readonly suggestion: TermSuggestion | null;
  /** The words an offer was dismissed over, mapped through every change. */
  readonly dismissed: readonly { readonly from: number; readonly to: number }[];
  readonly standings: TermStandings | null;
}

type Meta =
  | { readonly index: readonly TermOffered[] | null }
  | { readonly standings: TermStandings | null }
  | { readonly typed: true }
  | { readonly dismiss: true }
  | { readonly active: number }
  | { readonly close: true };

export const termsKey = new PluginKey<TermsState>('terms');

const LAST_WORD = /[\p{L}\p{N}]+$/u;
const WORD = /[\p{L}\p{N}]/u;
const BOUNDARY = /[\s\p{P}]/u;

function indexOf(terms: readonly TermOffered[]): Indexed {
  const byLast = new Map<string, { form: string; term: TermOffered }[]>();
  for (const term of terms) {
    for (const form of new Set(term.forms)) {
      const last = LAST_WORD.exec(form)?.[0].toLowerCase();
      if (last === undefined) continue;
      if (!byLast.has(last)) byLast.set(last, []);
      byLast.get(last)!.push({ form, term });
    }
  }
  return { offered: terms, byLast };
}

/** What the caret offers: the word or words before it, or before one space or mark after them. */
function suggest(state: EditorState, value: TermsState): TermSuggestion | null {
  const { selection } = state;
  if (value.index === null || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.inlineContent || !$from.parent.type.allowsMarkType(termType)) return null;
  const before = positionedText($from.parent).slice(0, $from.parentOffset);
  const end =
    before.length > 0 && BOUNDARY.test(before.at(-1)!) ? before.length - 1 : before.length;
  const text = before.slice(0, end);
  const last = LAST_WORD.exec(text)?.[0].toLowerCase();
  if (last === undefined) return null;
  const start = $from.start();
  const to = start + end;
  const found = new Map<string, { term: TermOffered; from: number; abbreviated: boolean }>();
  for (const { form, term } of value.index.byLast.get(last) ?? []) {
    const at = text.length - form.length;
    if (at < 0 || text.slice(at).toLowerCase() !== form.toLowerCase()) continue;
    if (at > 0 && WORD.test(text[at - 1]!)) continue;
    const from = start + at;
    if (state.doc.rangeHasMark(from, to, termType)) continue;
    if (value.dismissed.some((each) => each.from === from && each.to === to)) continue;
    const held = found.get(term.id);
    if (held !== undefined && held.from <= from) continue;
    found.set(term.id, { term, from, abbreviated: form === term.abbreviation });
  }
  // The longest words first, then an abbreviation, then by label.
  const offers = [...found.values()]
    .sort(
      (a, b) =>
        a.from - b.from ||
        Number(b.abbreviated) - Number(a.abbreviated) ||
        a.term.label.localeCompare(b.term.label),
    )
    .slice(0, OFFERED_MOST)
    .map(({ term, from }) => ({ term, from }));
  return offers.length === 0
    ? null
    : { to, from: offers[0]!.from, offers, active: 0, moved: false };
}

const mapped = (suggestion: TermSuggestion, mapping: Mapping): TermSuggestion => ({
  ...suggestion,
  to: mapping.map(suggestion.to, -1),
  from: mapping.map(suggestion.from),
  offers: suggestion.offers.map((each) => ({ ...each, from: mapping.map(each.from) })),
});

/** Applies the offer chosen over its words, as one undo step of its own; false where none stands. */
export function applySuggestedTerm(newIdentifier: () => string, choice?: number): Command {
  return (state, dispatch) => {
    const suggestion = termSuggestionOf(state);
    const offer = suggestion?.offers[choice ?? suggestion.active];
    if (suggestion === null || offer === undefined) return false;
    if (dispatch) {
      const mark = termType.create({ id: newIdentifier(), term: offer.term.id });
      const tr = state.tr
        .addMark(offer.from, suggestion.to, mark)
        .setMeta(termsKey, { close: true });
      dispatch(closeHistory(tr));
    }
    return true;
  };
}

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** Dismisses the offer standing, which is not made over those words again. */
export const dismissTermSuggestion: Command = (state, dispatch) => {
  if (termSuggestionOf(state) === null) return false;
  dispatch?.(state.tr.setMeta(termsKey, { dismiss: true }).setMeta('addToHistory', false));
  return true;
};

/** Moves the offer's active term by `by`, round. */
const moveActive =
  (by: number): Command =>
  (state, dispatch) => {
    const suggestion = termSuggestionOf(state);
    if (suggestion === null || suggestion.offers.length < 2) return false;
    const count = suggestion.offers.length;
    const active = (suggestion.active + by + count) % count;
    dispatch?.(state.tr.setMeta(termsKey, { active }).setMeta('addToHistory', false));
    return true;
  };

let surfaces = 0;

/**
 * The offer as a listbox below the caret, the caret staying in the surface, which names its active
 * option (`aria-activedescendant`), and a polite live region saying what is offered: the ARIA
 * combobox pattern's, on a surface that stays a textbox.
 */
class OfferView {
  private readonly list: HTMLElement;
  private readonly said: HTMLElement;
  private readonly id = `aw-terms-${(surfaces += 1)}`;
  private shown: TermSuggestion | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly newIdentifier: () => string,
  ) {
    const document = view.dom.ownerDocument;
    this.list = document.createElement('ul');
    this.list.id = this.id;
    this.list.className = 'aw-term-suggestions';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Suggested terms');
    this.list.hidden = true;
    this.said = document.createElement('div');
    // Polite and no status role, so it is not taken for the page's own status line.
    this.said.setAttribute('aria-live', 'polite');
    this.said.className = 'aw-visually-hidden';
    document.body.append(this.list, this.said);
    view.dom.setAttribute('aria-autocomplete', 'list');
    this.update();
  }

  update() {
    const suggestion = termSuggestionOf(this.view.state);
    if (suggestion === this.shown) return;
    const was = this.shown;
    this.shown = suggestion;
    const surface = this.view.dom;
    if (suggestion === null) {
      this.list.hidden = true;
      this.list.replaceChildren();
      surface.removeAttribute('aria-controls');
      surface.removeAttribute('aria-activedescendant');
      if (was !== null) this.said.textContent = '';
      return;
    }
    const document = surface.ownerDocument;
    this.list.replaceChildren(
      ...suggestion.offers.map(({ term }, at) => {
        const option = document.createElement('li');
        option.id = `${this.id}-${at}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(at === suggestion.active));
        option.textContent = said(term);
        // Chosen by pointer without taking the caret out of the surface.
        option.addEventListener('mousedown', (event) => {
          event.preventDefault();
          applySuggestedTerm(this.newIdentifier, at)(this.view.state, this.view.dispatch);
        });
        return option;
      }),
    );
    this.list.hidden = false;
    surface.setAttribute('aria-controls', this.id);
    surface.setAttribute('aria-activedescendant', `${this.id}-${suggestion.active}`);
    try {
      const at = this.view.coordsAtPos(suggestion.to);
      this.list.style.left = `${at.left}px`;
      this.list.style.top = `${at.bottom + 2}px`;
    } catch {
      // A surface not laid out, as in a test, places it nowhere in particular.
    }
    const count = suggestion.offers.length;
    const active = suggestion.offers[suggestion.active]!.term;
    this.said.textContent =
      `${count === 1 ? 'Term' : `${count} terms`} offered: ${said(active)}. ` +
      `Tab to apply, ${count === 1 ? '' : 'the arrows and Enter to choose, '}Escape to dismiss.`;
  }

  destroy() {
    this.list.remove();
    this.said.remove();
    for (const name of ['aria-autocomplete', 'aria-controls', 'aria-activedescendant']) {
      this.view.dom.removeAttribute(name);
    }
  }
}

const said = (term: TermOffered) =>
  term.abbreviation === null ? term.label : `${term.label} (${term.abbreviation})`;

/**
 * Holds the space's term index, the offer at the caret and each used term's standing. An offer is
 * made only after the author's own typing here (`handleTextInput`), never while an input method
 * composes, and goes when the caret leaves it or anything else changes the text.
 */
export function termsPlugin(newIdentifier: () => string): Plugin<TermsState> {
  return new Plugin<TermsState>({
    key: termsKey,
    state: {
      init: () => ({ index: null, suggestion: null, dismissed: [], standings: null }),
      apply: (tr, value, _old, state) => {
        const meta = tr.getMeta(termsKey) as Meta | undefined;
        const next: TermsState = tr.docChanged
          ? {
              ...value,
              dismissed: value.dismissed.map((each) => ({
                from: tr.mapping.map(each.from),
                to: tr.mapping.map(each.to, -1),
              })),
            }
          : value;
        if (meta !== undefined && 'index' in meta) {
          return { ...next, index: meta.index === null ? null : indexOf(meta.index) };
        }
        if (meta !== undefined && 'standings' in meta)
          return { ...next, standings: meta.standings };
        if (meta !== undefined && 'active' in meta && next.suggestion !== null) {
          return {
            ...next,
            suggestion: { ...next.suggestion, active: meta.active, moved: true },
          };
        }
        if (meta !== undefined && 'close' in meta) return { ...next, suggestion: null };
        if (meta !== undefined && 'dismiss' in meta && next.suggestion !== null) {
          const { from, to } = next.suggestion;
          return { ...next, suggestion: null, dismissed: [...next.dismissed, { from, to }] };
        }
        if (meta !== undefined && 'typed' in meta)
          return { ...next, suggestion: suggest(state, next) };
        if (next.suggestion !== null && tr.docChanged && tr.getMeta('appendedTransaction')) {
          // What the surface's own repairs append to the typing moves the offer, and keeps it.
          return { ...next, suggestion: mapped(next.suggestion, tr.mapping) };
        }
        if (next.suggestion !== null && (tr.docChanged || tr.selectionSet)) {
          const kept =
            !tr.docChanged && state.selection.empty && state.selection.from === next.suggestion.to;
          return kept ? next : { ...next, suggestion: null };
        }
        return next;
      },
    },
    props: {
      handleTextInput: (view, _from, _to, _text, deflt) => {
        if (view.composing) return false;
        view.dispatch(deflt().setMeta(termsKey, { typed: true }));
        return true;
      },
      handleKeyDown: (view, event) => {
        const state = view.state;
        if (termSuggestionOf(state) === null) return false;
        const dispatch = view.dispatch.bind(view);
        const plain = !(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey);
        switch (event.key) {
          case 'Tab':
            return plain && applySuggestedTerm(newIdentifier)(state, dispatch);
          case 'Enter':
            // Enter applies only a choice the author moved to; else it does its own job, the offer
            // closed first.
            if (plain && termSuggestionOf(state)!.moved) {
              return applySuggestedTerm(newIdentifier)(state, dispatch);
            }
            dispatch(state.tr.setMeta(termsKey, { close: true }).setMeta('addToHistory', false));
            return false;
          case 'Escape':
            return dismissTermSuggestion(state, dispatch);
          case 'ArrowDown':
            return moveActive(1)(state, dispatch);
          case 'ArrowUp':
            return moveActive(-1)(state, dispatch);
          default:
            return false;
        }
      },
    },
    view: (view) => new OfferView(view, newIdentifier),
  });
}

/** The offer at the caret, or null. */
export const termSuggestionOf = (state: EditorState): TermSuggestion | null =>
  termsKey.getState(state)?.suggestion ?? null;

/** The index a surface's state holds, as handed in, or null. */
export const termIndexOf = (state: EditorState): readonly TermOffered[] | null =>
  termsKey.getState(state)?.index?.offered ?? null;

/** The standings a surface's state holds, or null where none have been heard. */
export const termStandingsOf = (state: EditorState): TermStandings | null =>
  termsKey.getState(state)?.standings ?? null;

type Viewed = { readonly state: EditorState; dispatch: (tr: Transaction) => void };

/** Hands a surface the space's terms it may offer: a change of no document, never undone. */
export function setTermIndex(view: Viewed, index: readonly TermOffered[] | null): void {
  view.dispatch(view.state.tr.setMeta(termsKey, { index }).setMeta('addToHistory', false));
}

/** Tells a surface each used term's standing, as `setCitationFlags` does. */
export function setTermStandings(view: Viewed, standings: TermStandings | null): void {
  view.dispatch(view.state.tr.setMeta(termsKey, { standings }).setMeta('addToHistory', false));
}

/** Every term `doc` uses, once each, in reading order: what the host asks the standing of. */
export function termsIn(doc: Node): string[] {
  const found = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) if (mark.type === termType) found.add(mark.attrs.term as string);
    return true;
  });
  return [...found];
}

/** What a flag says of a term's standing, or null for one that needs none. */
function flagOf(standing: TermStanding | undefined): string | null {
  if (standing?.standing === 'unavailable') return 'Term unavailable';
  if (standing?.standing !== 'deprecated') return null;
  const instead = standing.replacedBy?.label;
  return instead == null ? 'Deprecated' : `Deprecated: use ${instead}`;
}

/**
 * A deprecated or unreadable term flagged where it is used (LIB-018), as a flagged citation is: its
 * words classed, and the flag said after them in a widget a screen reader reads.
 */
export function termDecorations(doc: Node, standings: TermStandings | null): DecorationSet {
  if (standings === null) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  let open: { term: string; id: string; to: number } | null = null;
  const close = () => {
    if (open === null) return;
    const flag = flagOf(standings.get(open.term));
    if (flag !== null) {
      const text = flag;
      decorations.push(
        Decoration.widget(
          open.to,
          (view) => {
            const shown = view.dom.ownerDocument.createElement('span');
            shown.className = 'aw-term-flag';
            shown.contentEditable = 'false';
            shown.textContent = ` (${text})`;
            return shown;
          },
          {
            side: -1,
            key: `term-flag:${open.term}:${text}`,
            termFlag: text,
            ignoreSelection: true,
          },
        ),
      );
    }
    open = null;
  };
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = termType.isInSet(node.marks);
    if (mark === undefined || (open !== null && open.id !== mark.attrs.id)) close();
    if (mark === undefined) return false;
    const term = mark.attrs.term as string;
    const flag = flagOf(standings.get(term));
    if (flag !== null) {
      decorations.push(
        Decoration.inline(pos, pos + node.nodeSize, {
          class: flag === 'Term unavailable' ? 'aw-term-unavailable' : 'aw-term-deprecated',
        }),
      );
    }
    if (open !== null && open.id === mark.attrs.id) open.to = pos + node.nodeSize;
    else open = { term, id: mark.attrs.id as string, to: pos + node.nodeSize };
    return false;
  });
  close();
  return DecorationSet.create(doc, decorations);
}
