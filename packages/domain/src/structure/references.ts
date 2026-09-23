import type { CrossReferenceDisplay, CrossReferenceTarget } from '../content/model/inline.js';
import { hasText } from '../content/model/text.js';

import { captionText, type Contribution } from './contributions.js';
import type { NumberingEntry, NumberingTable } from './numbering.js';
import { walkOutline, type OutlineViewNode } from './outline.js';

/**
 * What a reference can point at, as an author is offered it and a reference shows it (structure.md,
 * "Making, showing and printing a reference", XR-A and XR-C): a section, a figure, a table or a
 * footnote - and `block` for any other block, a paragraph or a list, which the dialog never offers and
 * only content written by another route points at, but which a reference must still be able to show.
 */
export type ReferenceKind = 'section' | 'figure' | 'table' | 'footnote' | 'block';

/**
 * One thing a reference could point at, as the author is offered it: `target` exactly as a reference
 * in the component being edited would store it, its kind, and what it prints from - `label` the
 * numbering table's (null where it has none, or none known to whoever is numbering), `title` a
 * section's title's words or a figure's or a table's caption's (null where there are none) - and
 * `relative`, where it stands against the occurrence being edited in document order, or null where
 * that order is not the document's to say.
 */
export interface ReferenceTarget {
  readonly target: CrossReferenceTarget;
  readonly kind: ReferenceKind;
  readonly label: string | null;
  readonly title: string | null;
  readonly relative: 'above' | 'below' | null;
}

/** Every form, in the order the stored enum declares them. */
const EVERY_FORM: readonly CrossReferenceDisplay[] = [
  'number',
  'title',
  'numberAndTitle',
  'page',
  'relative',
];

/**
 * The forms a target has (XR-C). A section, a figure and a table have a number and a title, so all
 * five; a footnote has a number and no title; any other block has neither, and offers a page and a
 * place alone. A page and a place are everything's, because anything printed stands on a page and
 * somewhere in the document.
 */
const FORMS: Readonly<Record<ReferenceKind, readonly CrossReferenceDisplay[]>> = {
  section: EVERY_FORM,
  figure: EVERY_FORM,
  table: EVERY_FORM,
  footnote: ['number', 'page', 'relative'],
  block: ['page', 'relative'],
};

export function formsFor(kind: ReferenceKind): readonly CrossReferenceDisplay[] {
  return FORMS[kind];
}

/**
 * Each kind in one word - what a reference shows where it has nothing better, and what the editor
 * shows beside a caption for a reference it cannot number (_Table: Readings_, R10). English, as
 * `printed`'s words are, until a layout has words of its own (cross-references 2).
 */
const KIND_WORDS: Readonly<Record<ReferenceKind, string>> = {
  section: 'Section',
  figure: 'Figure',
  table: 'Table',
  footnote: 'Footnote',
  block: 'Paragraph',
};

export function kindWord(kind: ReferenceKind): string {
  return KIND_WORDS[kind];
}

/** The sequences whose members a reference may be pointed at from the dialog, and their kinds. */
const OFFERED: Readonly<Record<string, ReferenceKind>> = {
  figure: 'figure',
  table: 'table',
  footnote: 'footnote',
};

/** What `documentTargets` reads: everything the document page already holds, and what it edits. */
export interface DocumentTargetsInput {
  /** The outline as the reader is shown it, or as it is stored: a view's withheld occurrence offers nothing. */
  readonly outline: { readonly nodes: readonly OutlineViewNode[] };
  /** `number`'s table for that outline and those contributions. */
  readonly numbering: NumberingTable;
  /** What each occurrence contributes, keyed by the occurrence's node, as `resolve` takes them. */
  readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
  /** The component being edited, and the occurrence of it being edited in place. */
  readonly editing: { readonly component: string; readonly node: string };
}

/**
 * **What a document offers a reference** (XR-A, XR-B), in document order - the order an author reads
 * the page in: every section, as a `node` target, by its number's label and its title's words; and,
 * in each occurrence's place, every figure, table and footnote it contributes, each by its label and a
 * figure's or a table's caption. Which target each is stored as is the component's view of it:
 *
 * - **the occurrence being edited**: a `block` target, which resolves to whichever occurrence is being
 *   read (STR-056). Its order against the reference is the editor's to say, not the outline's, so its
 *   `relative` is null;
 * - **another component placed once**: a `component` target;
 * - **another component placed more than once**: nothing, since which of its occurrences a reference
 *   meant cannot be known, and one naming it cannot resolve (STR-062). The same holds for another
 *   occurrence of the component being edited, whose blocks are the ones offered where it is edited;
 * - **an occurrence the reader may not read** (its component withheld), **or one whose contributions
 *   the page has not heard about**: nothing, since what it holds is not known here.
 *
 * `relative` is by preorder against `editing.node`: a section holding the occurrence is above it, its
 * heading printed first, and a section the occurrence holds is below, printed after its content. Where
 * `editing.node` is not in the outline, nothing is known to be above or below it.
 *
 * A section title's own footnotes are not offered: a `node` target names the section, and no target
 * names a footnote in a title. An equation is not offered either, until references to one are planned.
 */
export function documentTargets({
  outline,
  numbering,
  contributions,
  editing,
}: DocumentTargetsInput): readonly ReferenceTarget[] {
  const entries = new Map<string, NumberingEntry>();
  for (const entry of numbering.entries) entries.set(entryKey(entry.node, entry.block), entry);
  const labelOf = (node: string, block: string | null): string | null => {
    const entry = entries.get(entryKey(node, block));
    return entry === undefined ? null : (entry.label ?? entry.number);
  };

  // How many times each component occurs, counted over the whole outline before anything is offered,
  // since an occurrence early in the document is ambiguous because of one late in it.
  const occurs = new Map<string, number>();
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'reference' && node.component !== null) {
      occurs.set(node.component, (occurs.get(node.component) ?? 0) + 1);
    }
  });

  let found = false;
  walkOutline(outline.nodes, (node) => {
    if (node.id === editing.node) found = true;
  });

  const targets: ReferenceTarget[] = [];
  let passed = false;
  walkOutline(outline.nodes, (node) => {
    const own = node.id === editing.node;
    if (own) passed = true;
    const relative = !found || own ? null : passed ? 'below' : 'above';
    if (node.type === 'section') {
      const words = captionText(node.title);
      targets.push({
        target: { kind: 'node', node: node.id },
        kind: 'section',
        label: labelOf(node.id, null),
        title: hasText(words) ? words : null,
        relative,
      });
      return;
    }
    const component = node.component;
    const held = contributions.get(node.id);
    if (component === null || held === undefined) return;
    if (!own && (component === editing.component || occurs.get(component) !== 1)) return;
    for (const contribution of held) {
      const kind = OFFERED[contribution.sequence];
      if (kind === undefined) continue;
      const caption = contribution.caption;
      targets.push({
        target: own
          ? { kind: 'block', block: contribution.block }
          : { kind: 'component', component, block: contribution.block },
        kind,
        label: labelOf(node.id, contribution.block),
        title: kind !== 'footnote' && caption !== undefined && hasText(caption) ? caption : null,
        relative,
      });
    }
  });
  return targets;
}

/** A numbering entry's key: its node, and its block where it is one. */
const entryKey = (node: string, block: string | null) => `${node}\u{0}${block ?? ''}`;

/**
 * **What a reference prints** in a form (XR-C): `number` the label; `title` the title; `numberAndTitle`
 * both with a space between, as a generated list sets them; `page` _page of_ and the label or the
 * title, since the page is known only once the document is typeset; `relative` _above_ or _below_ as
 * the caller says, or _above or below_ where the order is not known. `relative` is the caller's rather
 * than the target's because only the caller knows it for a block of the occurrence being edited: the
 * editor, by position in the component.
 *
 * **Total, and never empty.** A form asks for what the target may lack - a number not known, a
 * caption with no words, a paragraph with neither - so each falls back to what the target has, and in
 * the end to the kind of thing it is. English words: the layout's own arrive with cross-references 2.
 */
export function printed(
  target: ReferenceTarget,
  display: CrossReferenceDisplay,
  relative: 'above' | 'below' | null,
): string {
  const { label, title } = target;
  const named = label ?? title ?? kindWord(target.kind);
  switch (display) {
    case 'number':
      return named;
    case 'title':
      return title ?? label ?? kindWord(target.kind);
    case 'numberAndTitle':
      return label !== null && title !== null ? `${label} ${title}` : named;
    case 'page':
      return `page of ${named}`;
    case 'relative':
      return relative ?? 'above or below';
  }
}
