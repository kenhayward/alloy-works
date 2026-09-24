import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type {
  CrossReferenceDisplay,
  CrossReferenceTarget,
  InlineNode,
} from '../content/model/inline.js';
import { hasText } from '../content/model/text.js';

import { captionText, type Contribution } from './contributions.js';
import type { NumberingEntry, NumberingTable } from './numbering.js';
import { walkOutline, type OutlineNode, type OutlineViewNode } from './outline.js';

/**
 * What a reference can point at, as an author is offered it and a reference shows it (structure.md,
 * "Making, showing and printing a reference", XR-A and XR-C): a section, a figure, a table, a footnote
 * or a block equation (equations 2, ruling R7) - and `block` for any other block, a paragraph or a
 * list, which the dialog never offers and only content written by another route points at, but which a
 * reference must still be able to show.
 */
export type ReferenceKind = 'section' | 'figure' | 'table' | 'footnote' | 'equation' | 'block';

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
 * five; a footnote and an equation have a number and no title - an equation's number is its label, and
 * what it says is maths, which a reference cannot print as words; any other block has neither, and
 * offers a page and a place alone. A page and a place are everything's, because anything printed stands
 * on a page and somewhere in the document.
 */
const FORMS: Readonly<Record<ReferenceKind, readonly CrossReferenceDisplay[]>> = {
  section: EVERY_FORM,
  figure: EVERY_FORM,
  table: EVERY_FORM,
  footnote: ['number', 'page', 'relative'],
  equation: ['number', 'page', 'relative'],
  block: ['page', 'relative'],
};

export function formsFor(kind: ReferenceKind): readonly CrossReferenceDisplay[] {
  return FORMS[kind];
}

/**
 * Each kind in one word - what a reference shows where it has nothing better, and what the editor
 * shows beside a caption for a reference it cannot number (_Table: Readings_, R10), and what a
 * caption's reference to a target with no number prints where a title form reads that caption. English,
 * as `printed`'s _page of_ is: a layout's own words are for above and below alone (cross-references 2,
 * ruling R9), and nothing gives these yet.
 */
const KIND_WORDS: Readonly<Record<ReferenceKind, string>> = {
  section: 'Section',
  figure: 'Figure',
  table: 'Table',
  footnote: 'Footnote',
  equation: 'Equation',
  block: 'Paragraph',
};

export function kindWord(kind: ReferenceKind): string {
  return KIND_WORDS[kind];
}

/**
 * The sequences whose members a reference may be pointed at from the dialog, and their kinds. An
 * equation is offered where it is numbered alone: one the author left unnumbered takes no number, and
 * is pointed at by nothing the dialog offers (equations 2, ruling R7).
 */
const OFFERED: Readonly<Record<string, ReferenceKind>> = {
  figure: 'figure',
  table: 'table',
  footnote: 'footnote',
  equation: 'equation',
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
 * in each occurrence's place, every figure, table, footnote and numbered equation it contributes, each
 * by its label and a figure's or a table's caption. Which target each is stored as is the component's view of it:
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
 * names a footnote in a title. A block equation is offered where it is numbered, by its number
 * (equations 2, ruling R7); one left unnumbered is not, and an inline equation is no target at all.
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
      const words = titleWords(node.title, labelOf);
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
      if (kind === undefined || !contribution.numbered) continue;
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
 * **A section's title, in its own words, its own reference resolved** (cross-references 2, ruling
 * R9's part 2): a title's reference is always a `node` target and always a number
 * (`checkInlineContent` enforces both, so a title never needs the full resolution `assemble` runs),
 * so it prints the same label `labelOf` already gives that section for every other target - "Results
 * of 1", not "Results of " with the reference silently dropped, as `captionText` would read it.
 */
const titleWords = (
  title: readonly InlineNode[],
  labelOf: (node: string, block: string | null) => string | null,
): string =>
  title
    .map((inline) => {
      if (inline.type === 'text') return inline.value;
      if (inline.type === 'crossReference' && inline.target.kind === 'node') {
        return labelOf(inline.target.node, null) ?? '';
      }
      return '';
    })
    .join('');

/**
 * **What a reference prints** in a form (XR-C): `number` the label; `title` the title; `numberAndTitle`
 * both with a space between, as a generated list sets them; `page` _page of_ and the label or the
 * title, since the page is known only once the document is typeset; `relative` `words`' _above_ or
 * _below_ as the caller says, or both, joined by "or", where the order is not known. `relative` is the
 * caller's rather than the target's because only the caller knows it for a block of the occurrence
 * being edited: the editor, by position in the component.
 *
 * **Total, and never empty.** A form asks for what the target may lack - a number not known, a
 * caption with no words, a paragraph with neither - so each falls back to what the target has, and in
 * the end to the kind of thing it is. `words` is the layout's own, in its own language
 * (cross-references 2, ruling R9); without it - a component opened on its own, or a layout with none -
 * the English literal, as before layouts gave any.
 */
export function printed(
  target: ReferenceTarget,
  display: CrossReferenceDisplay,
  relative: 'above' | 'below' | null,
  words?: { readonly above: string; readonly below: string },
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
      if (relative === null) return words ? `${words.above} or ${words.below}` : 'above or below';
      return words ? words[relative] : relative;
  }
}

/**
 * **What a reference is bound to** once resolved in the document publishing it (structure 4's
 * `references`, cross-references 2, ruling R1): `node` the occurrence that holds the target - or, for
 * a `node` target, the node itself - `block` the block or footnote there, null for a node, and what it
 * prints from, as `ReferenceTarget` has it: its kind, `label` the numbering table's, and `title` a
 * section's title's words, an occurrence's component's title, or a figure's or a table's caption's -
 * each null where there is none. It carries no display form: which of those it can print is
 * `printableForms`'s to say, and what the form prints is `assemble`'s.
 */
export interface BoundTarget {
  readonly node: string;
  readonly block: string | null;
  readonly kind: ReferenceKind;
  readonly label: string | null;
  readonly title: string | null;
}

/**
 * Why a reference did not resolve, for the failure that names it (STR-029, STR-062):
 *
 * - `missing`: the occurrence it is bound to holds no such block or footnote - or its content is not
 *   the publisher's to read, which the request has already failed by name - or the outline holds no
 *   such node, or a `block` target is read where no occurrence is;
 * - `componentAbsent`: a `component` target whose component the document places nowhere;
 * - `componentRepeated`: one it places more than once, so which occurrence was meant cannot be known.
 */
export type UnresolvedReason = 'missing' | 'componentAbsent' | 'componentRepeated';

export type ReferenceResolution =
  | { readonly ok: true; readonly target: BoundTarget }
  | { readonly ok: false; readonly reason: UnresolvedReason };

/**
 * What resolution reads - exactly what `assemble` holds when it walks a document, so it is handed
 * over rather than adapted: the **stored** outline, whose every occurrence names its component (a
 * reader's view withholds some, and a `component` target counted over it could take one occurrence
 * for the only one); the content of each occurrence the publisher may read, keyed by its node; and
 * `number`'s table for that outline and those contents.
 */
export interface ResolvingDocument {
  readonly outline: { readonly nodes: readonly OutlineNode[] };
  readonly occurrences: ReadonlyMap<string, ContentDocument>;
  readonly numbering: NumberingTable;
}

/** Where a reference is read: the node of the occurrence it stands in, or of the section it titles. */
export interface Reading {
  readonly node: string;
}

/**
 * **Resolution** (structure.md, "Cross-references"; cross-references 2, ruling R1): the document is
 * indexed once, and the function returned binds each reference read in it, pure and in any order.
 *
 * - **A `block` target** reaches a block or footnote of **the occurrence it is read in** - never the
 *   component, so one component placed twice resolves "see Figure 2" in each to its own (STR-056,
 *   STR-028).
 * - **A `component` target** reaches a block or footnote of that component's **one** occurrence in this
 *   document, and fails where the document places it in none or in several rather than taking the
 *   first (STR-062). It resolves alike wherever it is read - **except in an occurrence of the very
 *   component it names**, where it is a block of its own and resolves exactly as a `block` target, to
 *   the occurrence it is read in (STR-056, STR-062). Such a target is stored by a reference pasted
 *   from another component into this one: admission (`repoint`) leaves every `component` target
 *   standing, and one placed twice is not ambiguous where it is read.
 * - **A `node` target** reaches the node: a section, by its number and its title's words, or an
 *   occurrence, which is a heading, by its number and its component's title.
 *
 * Bound to an occurrence, a block is looked up in its content, wherever it is nested - a list's item
 * at any depth, a quotation, a table's cell - and a footnote wherever `contributionsOf` finds one. A
 * figure, a table, a footnote and a block equation take their label from the numbering table - an
 * equation the author left unnumbered has none, and a number form of it fails as a paragraph's does
 * (equations 2, ruling R7); any other block - a paragraph, a list, a quotation, preformatted text - is
 * a `block`, with neither label nor title, which a page or a relative form can still name (XR-C). **So is a footnote's own paragraph** (CNT-125: any
 * block), set in its note at the foot of the page its text stands on: a label at the start of it, a
 * page reference to it and a link to it were measured against the pinned engine - a note carried on
 * to the next page included - and print and land on the page that paragraph stands on (the final
 * review of cross-references 2).
 */
export function referenceResolver(
  document: ResolvingDocument,
): (target: CrossReferenceTarget, reading: Reading) => ReferenceResolution {
  const entries = new Map<string, NumberingEntry>();
  for (const entry of document.numbering.entries)
    entries.set(entryKey(entry.node, entry.block), entry);
  const labelOf = (node: string, block: string | null): string | null => {
    const entry = entries.get(entryKey(node, block));
    return entry === undefined ? null : (entry.label ?? entry.number);
  };

  // Every node by its identifier, and every component's occurrences, counted over the whole outline
  // before anything is resolved: an occurrence early in the document is ambiguous because of a late one.
  const nodes = new Map<string, OutlineNode>();
  const placements = new Map<string, string[]>();
  walkOutline(document.outline.nodes, (node) => {
    nodes.set(node.id, node);
    if (node.type === 'reference') {
      placements.set(node.component, [...(placements.get(node.component) ?? []), node.id]);
    }
  });

  // Each occurrence's blocks, walked the first time a reference asks for one.
  const indexed = new Map<string, ReadonlyMap<string, Found>>();
  const blocksOf = (node: string): ReadonlyMap<string, Found> | undefined => {
    const content = document.occurrences.get(node);
    if (content === undefined) return undefined;
    let found = indexed.get(node);
    if (found === undefined) {
      const index = new Map<string, Found>();
      for (const block of content.content) findIn(block, index);
      indexed.set(node, index);
      found = index;
    }
    return found;
  };

  const inOccurrence = (node: string, block: string): ReferenceResolution => {
    const found = blocksOf(node)?.get(block);
    if (found === undefined) return { ok: false, reason: 'missing' };
    const numbered = found.kind !== 'block';
    return {
      ok: true,
      target: {
        node,
        block,
        kind: found.kind,
        label: numbered ? labelOf(node, block) : null,
        title: found.caption !== null && hasText(found.caption) ? found.caption : null,
      },
    };
  };

  return (target, reading) => {
    switch (target.kind) {
      case 'block':
        return inOccurrence(reading.node, target.block);
      case 'component': {
        // Read in an occurrence of the component it names, it is a block of its own (STR-056).
        const reader = nodes.get(reading.node);
        if (reader?.type === 'reference' && reader.component === target.component) {
          return inOccurrence(reading.node, target.block);
        }
        const [only, ...others] = placements.get(target.component) ?? [];
        if (only === undefined) return { ok: false, reason: 'componentAbsent' };
        if (others.length > 0) return { ok: false, reason: 'componentRepeated' };
        return inOccurrence(only, target.block);
      }
      case 'node': {
        const node = nodes.get(target.node);
        if (node === undefined) return { ok: false, reason: 'missing' };
        const words =
          node.type === 'section'
            ? captionText(node.title)
            : (document.occurrences.get(node.id)?.title ?? '');
        return {
          ok: true,
          target: {
            node: node.id,
            block: null,
            kind: 'section',
            label: labelOf(node.id, null),
            title: hasText(words) ? words : null,
          },
        };
      }
      default: {
        // **Unreachable, and named rather than left to fall through**: a fourth kind of target - a
        // bibliography entry, when LIB says what one is - fails to compile here until it resolves.
        const unreachable: never = target;
        throw new Error(
          `No resolution for a target of kind ${(unreachable as CrossReferenceTarget).kind}`,
        );
      }
    }
  };
}

/** A block or footnote found in an occurrence: its kind, and a figure's or a table's caption words. */
interface Found {
  readonly kind: ReferenceKind;
  readonly caption: string | null;
}

/**
 * Every footnote in some inline content, as `inlineContributions` finds one, and each of its own
 * paragraphs, as a block with neither number nor title. Its paragraphs hold no footnote (CNT-129), so
 * nothing is looked for in them.
 */
function footnotesIn(inlines: readonly InlineNode[], index: Map<string, Found>): void {
  for (const inline of inlines) {
    if (inline.type !== 'footnote') continue;
    index.set(inline.id, { kind: 'footnote', caption: null });
    const paragraphs = inline.content as readonly Extract<BlockNode, { type: 'paragraph' }>[];
    for (const paragraph of paragraphs) index.set(paragraph.id, { kind: 'block', caption: null });
  }
}

/**
 * A block and everything it holds, into the index by identifier. **A branch per stored block kind,
 * and a `default:` that refuses what it cannot name**, as `blockContributions` has, so an eighth kind
 * fails to compile here rather than its blocks going unfound. It walks where `blockContributions`
 * walks, so a footnote is found exactly where it takes a number.
 */
function findIn(block: BlockNode, index: Map<string, Found>): void {
  switch (block.type) {
    case 'paragraph':
      index.set(block.id, { kind: 'block', caption: null });
      footnotesIn(block.content, index);
      return;
    case 'list':
      index.set(block.id, { kind: 'block', caption: null });
      for (const item of block.items) for (const each of item.content) findIn(each, index);
      return;
    case 'blockquote':
      index.set(block.id, { kind: 'block', caption: null });
      for (const each of block.content) findIn(each, index);
      footnotesIn(block.attribution ?? [], index);
      return;
    case 'preformatted':
      index.set(block.id, { kind: 'block', caption: null });
      return;
    case 'equation':
      index.set(block.id, { kind: 'equation', caption: null });
      return;
    case 'table':
      index.set(block.id, { kind: 'table', caption: captionText(block.caption) });
      footnotesIn(block.caption, index);
      for (const row of block.rows) {
        for (const cell of row.cells) for (const each of cell.content) findIn(each, index);
      }
      footnotesIn(block.note ?? [], index);
      return;
    case 'figure':
      index.set(block.id, { kind: 'figure', caption: captionText(block.caption) });
      footnotesIn(block.caption, index);
      return;
    default: {
      const unreachable: never = block;
      throw new Error(`No resolution rule for a block of kind ${(unreachable as BlockNode).type}`);
    }
  }
}

/**
 * **The forms a bound target can print**: those its kind offers (`formsFor`, XR-C), less those it has
 * nothing to print for - a number where the table gives it none, an unnumbered section's among them,
 * and a title where it has no words. A form asked of a target outside these is
 * `cross_reference_form_unavailable` at publish, where `printed` in the editor would fall back.
 */
export function printableForms(target: BoundTarget): readonly CrossReferenceDisplay[] {
  return formsFor(target.kind).filter((form) => {
    const needsNumber = form === 'number' || form === 'numberAndTitle';
    const needsTitle = form === 'title' || form === 'numberAndTitle';
    return (!needsNumber || target.label !== null) && (!needsTitle || target.title !== null);
  });
}
