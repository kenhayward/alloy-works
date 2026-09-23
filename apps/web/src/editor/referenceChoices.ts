import {
  formsFor,
  kindWord,
  printed,
  type CrossReferenceDisplay,
  type CrossReferenceTarget,
  type ReferenceKind,
  type ReferenceTarget,
} from '@alloy-works/domain';
import {
  ownTargets,
  referenceAt,
  referenceContextOf,
  referencesShown,
  type EditorView,
  type ReferenceContext,
} from '@alloy-works/editor';

/**
 * One thing the Reference dialog offers (cross-references 1, ruling R11): what a reference to it
 * stores, what the author is shown it as, the forms it has, and what a reference in each of those
 * forms will show.
 */
export interface ReferenceOption {
  /** Unique among the options: the target, spelled out. */
  readonly key: string;
  readonly target: CrossReferenceTarget;
  /** How the list names it: as a reader will see it. */
  readonly name: string;
  readonly forms: readonly CrossReferenceDisplay[];
  /** What a reference to it in that form shows on the surface, which is what the dialog says. */
  readonly shows: (display: CrossReferenceDisplay) => string;
}

/** Each form in the words the dialog offers it in: plain words, never the stored enum. */
export const FORM_WORDS: Readonly<Record<CrossReferenceDisplay, string>> = {
  number: 'Number',
  title: 'Title',
  numberAndTitle: 'Number and title',
  page: 'Page',
  relative: 'Above or below',
};

/** Every form, in the stored enum's order: a section's are all of them. */
const EVERY_FORM = formsFor('section');

/**
 * **What the list calls a target: the one naming, used for every option.** Numbered, it is what a
 * generated list prints - _1.2 Setup_, _Table 1.1 Readings_ - and a footnote, whose label is a bare
 * number, is _Footnote 3_. Not numbered - on its own, placed since the page last numbered the
 * document, or a number the page cannot know - it is its kind and its caption, _Table: Readings_,
 * which is exactly what the surface shows a reference to it as (ruling R10), so the list and the
 * surface agree about what the author is looking at.
 */
export function targetName(target: ReferenceTarget): string {
  const word = kindWord(target.kind);
  if (target.label === null) return target.title === null ? word : `${word}: ${target.title}`;
  if (target.kind === 'footnote') return `${word} ${target.label}`;
  return printed(target, 'numberAndTitle', null);
}

/** A target's key: equal for two targets exactly when a reference stores the same thing. */
export function keyOf(target: CrossReferenceTarget): string {
  switch (target.kind) {
    case 'block':
      return `block\u{0}${target.block}`;
    case 'component':
      return `component\u{0}${target.component}\u{0}${target.block}`;
    case 'node':
      return `node\u{0}${target.node}`;
  }
}

/** The reference the dialog was opened on, where it points somewhere the list does not offer. */
export interface Standing {
  readonly target: CrossReferenceTarget;
  readonly display: CrossReferenceDisplay;
  /** What the surface shows it as today - _Broken reference_, _Paragraph_ - or null if unknown. */
  readonly shown: string | null;
}

/**
 * **What the dialog offers, in order** (ruling R11), pure:
 *
 * - **on its own** (no context), the component's own figures, tables and footnotes, from the live
 *   document, each by its kind and caption;
 * - **in a document**, the context's sections and other components' targets in document order, with
 *   the component's own in the occurrence's place - after everything above it. **The live document
 *   decides which of its own are offered**, and the page's numbering what they are called: a table
 *   placed since the page last numbered the document is offered by its caption, and one deleted since
 *   is not offered at all, whatever the page last heard.
 *
 * `own` carries each own target's _above_ or _below_ against where the reference would stand, which
 * only the editor knows; a numbered one keeps its label and takes that. **A numbered target shows what
 * `printed` says in each form; any other shows its name whatever the form**, as the surface draws it.
 *
 * `standing`, where the dialog opens on a reference whose target is none of these - a paragraph a
 * paste pointed at, a table since deleted, a section on its own - puts that target first, named as
 * the surface shows it, so opening the dialog on a reference and pressing Change keeps it (the plan's
 * "one stored by another route is shown and kept"). Its forms are its kind's and the one it has.
 *
 * **Two options of the same name are told apart by a count**: the second and later take _(2)_,
 * _(3)_ in the order listed - two footnotes on their own are _Footnote_ and _Footnote (2)_, two
 * uncaptioned tables _Table_ and _Table (2)_ - so each radio's accessible name is its own. The count
 * is the list's alone: what each **shows** stays what the surface draws, which has no count to give.
 */
export function referenceOptions(
  context: ReferenceContext | null,
  own: readonly ReferenceTarget[],
  standing: Standing | null = null,
): readonly ReferenceOption[] {
  const numbered = new Map(context?.targets.map((each) => [keyOf(each.target), each]));
  const option = (target: ReferenceTarget, isNumbered: boolean): ReferenceOption => {
    const name = targetName(target);
    return {
      key: keyOf(target.target),
      target: target.target,
      name,
      forms: formsFor(target.kind),
      shows: (display) =>
        isNumbered ? printed(target, display, target.relative, context?.words) : name,
    };
  };
  const mine = own.map((each) => {
    const found = numbered.get(keyOf(each.target));
    return found === undefined
      ? option(each, false)
      : option({ ...found, relative: each.relative }, true);
  });
  let options: ReferenceOption[] = mine;
  if (context !== null) {
    const others = context.targets.filter((each) => each.target.kind !== 'block');
    const below = others.findIndex((each) => each.relative !== 'above');
    const at = below === -1 ? others.length : below;
    options = [
      ...others.slice(0, at).map((each) => option(each, true)),
      ...mine,
      ...others.slice(at).map((each) => option(each, true)),
    ];
  }
  if (standing !== null && !options.some((each) => each.key === keyOf(standing.target))) {
    const kind: ReferenceKind = standing.target.kind === 'node' ? 'section' : 'block';
    const has = formsFor(kind);
    const name = standing.shown ?? kindWord(kind);
    options = [
      {
        key: keyOf(standing.target),
        target: standing.target,
        name,
        forms: EVERY_FORM.filter((form) => has.includes(form) || form === standing.display),
        shows: () => name,
      },
      ...options,
    ];
  }
  return distinctlyNamed(options);
}

/** Each option whose name an earlier one already has, given a count in brackets: _Footnote (2)_. */
function distinctlyNamed(options: readonly ReferenceOption[]): readonly ReferenceOption[] {
  const seen = new Map<string, number>();
  return options.map((each) => {
    const count = (seen.get(each.name) ?? 0) + 1;
    seen.set(each.name, count);
    return count === 1 ? each : { ...each, name: `${each.name} (${count})` };
  });
}

/** What the dialog opens with: its options, whether it is in a document, and the reference it changes. */
export interface ReferenceChoices {
  readonly options: readonly ReferenceOption[];
  readonly inDocument: boolean;
  /** The reference selected whole, which the dialog changes, or null where it places a new one. */
  readonly current: {
    readonly key: string;
    readonly display: CrossReferenceDisplay;
    readonly pos: number;
  } | null;
}

/**
 * The dialog's choices over a view (ruling R11): `editing` is where the toolbar acts - the surface,
 * or a footnote's open editor - and `surface` the component's own, whose document holds every target
 * and whose state holds the page's context. In a footnote, positions are the footnote's, and where
 * the reference stands in the component is the footnote's place there plus its place in the footnote,
 * as the surface draws a footnote's references.
 */
export function referenceChoicesIn(surface: EditorView, editing: EditorView): ReferenceChoices {
  const context = referenceContextOf(surface.state);
  const within =
    editing === surface
      ? undefined
      : { component: surface.state.doc, offset: surface.state.selection.from + 1 };
  const current = referenceAt(editing.state);
  const local = current?.pos ?? editing.state.selection.to;
  const own = ownTargets(surface.state.doc, (within?.offset ?? 0) + local);
  const shown =
    current === null
      ? null
      : (referencesShown(editing.state.doc, context, within).find(
          (each) => each.pos === current.pos,
        )?.text ?? null);
  return {
    options: referenceOptions(
      context,
      own,
      current === null ? null : { target: current.target, display: current.display, shown },
    ),
    inDocument: context !== null,
    current:
      current === null
        ? null
        : { key: keyOf(current.target), display: current.display, pos: current.pos },
  };
}
