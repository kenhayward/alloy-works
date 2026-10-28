import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import type { Term, TermLabel } from '../library/term.js';
import type { TermExpansion } from '../theme/schema.js';

import { speaksFor } from './layout.js';

/**
 * **Terms published** (terms.md, "Printing"; the TM plan, TM-C to TM-F, TM-H): what a use of a term
 * prints, what the glossary and the list of abbreviations hold, and what a publish reports of them.
 * Pure: `assemble` prints by it, and the store reports by it when a publish is asked for.
 */

/** A term as a publish reads it: its latest approved revision, and whether it stands deprecated. */
export interface PublishingTerm {
  readonly term: Term;
  readonly deprecated: boolean;
}

/**
 * What a publish reports of its terms, never stopping it: a term printed as the words it covers
 * (draft, unreadable or missing alike, so nothing is said of one the publisher may not read), a
 * deprecated one printed (LIB-018, its replacement named), and a label in the base language where the
 * document's has none (LIB-050). Each once a term, counting its uses.
 */
export type TermWarning =
  | { readonly code: 'term_unresolved'; readonly term: string; readonly count: number }
  | {
      readonly code: 'term_deprecated';
      readonly term: string;
      readonly count: number;
      readonly replacedBy?: string;
    }
  | {
      readonly code: 'term_fallback';
      readonly term: string;
      readonly count: number;
      readonly language: string;
    };

type TextNode = Extract<InlineNode, { type: 'text' }>;

/** One use of a term: the text nodes one mark covers, side by side; a mark split is two uses. */
export interface TermSpan {
  readonly term: string;
  readonly nodes: readonly [TextNode, ...TextNode[]];
}

const termMark = (inline: InlineNode) =>
  inline.type === 'text' ? inline.marks.find((mark) => mark.type === 'definedTerm') : undefined;

/** Each use in a run of inline content, in order (TM-E). */
export function termSpans(inlines: readonly InlineNode[]): TermSpan[] {
  const spans: { term: string; mark: string; nodes: [TextNode, ...TextNode[]] }[] = [];
  let open: (typeof spans)[number] | null = null;
  for (const inline of inlines) {
    const mark = termMark(inline);
    if (mark === undefined || inline.type !== 'text') {
      open = null;
      continue;
    }
    if (open !== null && open.mark === mark.id) {
      open.nodes.push(inline);
      continue;
    }
    open = { term: mark.term, mark: mark.id, nodes: [inline] };
    spans.push(open);
  }
  return spans.map(({ term, nodes }) => ({ term, nodes }));
}

/** Every use a component holds, in stored order, notes at their mark: what the store reports by. */
export function termPlaces(content: ContentDocument): TermSpan[] {
  const found: TermSpan[] = [];
  const inlines = (each: readonly InlineNode[] | undefined) => {
    for (const span of termSpans(each ?? [])) found.push(span);
    for (const inline of each ?? []) {
      if (inline.type === 'footnote') blocks(inline.content as readonly BlockNode[]);
    }
  };
  const blocks = (each: readonly BlockNode[]): void => {
    for (const stored of each) {
      switch (stored.type) {
        case 'paragraph':
          inlines(stored.content);
          break;
        case 'list':
          for (const item of stored.items) {
            inlines(item.term);
            blocks(item.content);
          }
          break;
        case 'blockquote':
          blocks(stored.content);
          inlines(stored.attribution);
          break;
        case 'table':
          inlines(stored.caption);
          for (const row of stored.rows) for (const cell of row.cells) blocks(cell.content);
          inlines(stored.note);
          break;
        case 'boundTable':
          for (const part of [stored.caption, stored.empty, stored.note, stored.source]) {
            inlines(part);
          }
          break;
        case 'figure':
          inlines(stored.caption);
          break;
        default:
          break;
      }
    }
  };
  blocks(content.content);
  return found;
}

/**
 * A term's label for a document in `language` (LIB-014, LIB-050): the one in that language, else one
 * whose language serves it, else the base language's, which is a fallback.
 */
export function termLabelIn(
  term: Term,
  language: string,
): { readonly label: TermLabel; readonly fallback: boolean } {
  const exact = term.labels.find((each) => each.language === language);
  if (exact) return { label: exact, fallback: false };
  const served = term.labels.find((each) => speaksFor(each.language, language));
  if (served) return { label: served, fallback: false };
  const base = term.labels.find((each) => each.language === term.base)!;
  return { label: base, fallback: !speaksFor(base.language, language) };
}

/** Its definition in the label's language, else the base language's, or none. */
function definitionFor(term: Term, language: string): string | null {
  return (
    term.definition.find((each) => each.language === language)?.text ??
    term.definition.find((each) => speaksFor(each.language, language))?.text ??
    term.definition.find((each) => each.language === term.base)?.text ??
    null
  );
}

/** A use found where it is read: the node it stands in and the first text node it covers. */
export interface TermUse {
  readonly node: string;
  readonly term: string;
  readonly first: InlineNode;
}

/** One glossary entry (PUB-039): its anchor, `g-<term>`, its label and its definition. */
export interface GlossaryEntry {
  readonly anchor: string;
  readonly label: string;
  readonly definition: string;
}

/** One abbreviation and the preferred label it stands for. */
export interface AbbreviationEntry {
  readonly abbreviation: string;
  readonly label: string;
}

export interface PrintedTerms {
  /** What each use prints, by node and then the first text node it covers; absent, its words. */
  readonly forms: ReadonlyMap<string, ReadonlyMap<InlineNode, string>>;
  readonly glossary: readonly GlossaryEntry[];
  readonly abbreviations: readonly AbbreviationEntry[];
  readonly warnings: readonly TermWarning[];
}

/** A glossary entry's anchor: the term's identity, so a document holds one entry for it. */
export const glossaryAnchor = (term: string) => `g-${term}`;

/**
 * **Every use printed at once, in reading order** (TM-C to TM-F): under `firstUse` the first prints
 * "preferred (abbreviation)" and the rest the abbreviation, `always` the first form throughout and
 * `never` the abbreviation; a term with none prints its preferred label. A use whose term is not here
 * prints its words. `titled` are the terms a heading prints, which are no use but are listed. The
 * glossary and the abbreviations hold the approved terms used, sorted in the document language's
 * collation (TM-H).
 */
export function printTerms(
  uses: readonly TermUse[],
  titled: readonly { readonly node: string; readonly term: string }[],
  terms: ReadonlyMap<string, ReadonlyMap<string, PublishingTerm>>,
  expand: TermExpansion,
  language: string,
): PrintedTerms {
  const forms = new Map<string, Map<InlineNode, string>>();
  const seen = new Set<string>();
  const used = new Map<string, PublishingTerm>();
  for (const use of uses) {
    const found = terms.get(use.node)?.get(use.term);
    if (found === undefined) continue;
    used.set(use.term, found);
    const { label } = termLabelIn(found.term, language);
    const full =
      label.abbreviation === undefined
        ? label.preferred
        : `${label.preferred} (${label.abbreviation})`;
    const short = label.abbreviation ?? label.preferred;
    const first = !seen.has(use.term);
    seen.add(use.term);
    const printed = expand === 'never' ? short : expand === 'always' || first ? full : short;
    if (!forms.has(use.node)) forms.set(use.node, new Map());
    forms.get(use.node)!.set(use.first, printed);
  }
  for (const { node, term } of titled) {
    const found = terms.get(node)?.get(term);
    if (found !== undefined) used.set(term, found);
  }
  const collator = collatorFor(language);
  const labelled = [...used].map(([id, each]) => ({
    id,
    label: termLabelIn(each.term, language).label,
    definition: definitionFor(each.term, language),
  }));
  const glossary = labelled
    .flatMap((each) =>
      each.definition === null
        ? []
        : [
            {
              anchor: glossaryAnchor(each.id),
              label: each.label.preferred,
              definition: each.definition,
            },
          ],
    )
    .sort((a, b) => collator.compare(a.label, b.label));
  const abbreviations = labelled
    .flatMap((each) =>
      each.label.abbreviation === undefined
        ? []
        : [{ abbreviation: each.label.abbreviation, label: each.label.preferred }],
    )
    .sort((a, b) => collator.compare(a.abbreviation, b.abbreviation));
  return {
    forms,
    glossary,
    abbreviations,
    // A heading's terms are reported as a use's are, though none is a use.
    warnings: termWarnings(
      [...uses.map(({ node, term }) => ({ node, term })), ...titled],
      terms,
      language,
    ),
  };
}

/** The document language's collation, or the root's where the tag is one `Intl` refuses. */
export function collatorFor(language: string): Intl.Collator {
  try {
    return new Intl.Collator(language);
  } catch {
    return new Intl.Collator();
  }
}

/** What uses report (LIB-018, LIB-050), in the order each term is first met. */
export function termWarnings(
  uses: readonly { readonly node: string; readonly term: string }[],
  terms: ReadonlyMap<string, ReadonlyMap<string, PublishingTerm>>,
  language: string,
): TermWarning[] {
  const counts = new Map<string, { term: string; found: PublishingTerm | undefined; n: number }>();
  for (const { node, term } of uses) {
    const found = terms.get(node)?.get(term);
    const key = `${found === undefined ? 'u' : 'r'} ${term}`;
    const counted = counts.get(key) ?? { term, found, n: 0 };
    counted.n += 1;
    counts.set(key, counted);
  }
  const warnings: TermWarning[] = [];
  for (const { term, found, n: count } of counts.values()) {
    if (found === undefined) {
      warnings.push({ code: 'term_unresolved', term, count });
      continue;
    }
    if (found.deprecated) {
      const { replacedBy } = found.term;
      warnings.push({
        code: 'term_deprecated',
        term,
        count,
        ...(replacedBy === undefined ? {} : { replacedBy }),
      });
    }
    const { label, fallback } = termLabelIn(found.term, language);
    // Named by the language it had no label in, the document's.
    if (fallback && label.language !== language) {
      warnings.push({ code: 'term_fallback', term, count, language });
    }
  }
  return warnings;
}
