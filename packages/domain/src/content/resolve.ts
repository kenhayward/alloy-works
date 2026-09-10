import type {
  BlockNode,
  ContentDocument,
  InlineNode,
  Mark,
  ParagraphNode,
  SuggestionMark,
  TextNode,
} from './document.js';
import { doc, paragraph } from './document.js';

/**
 * Resolution: turning a stored document into the one a reader gets. Suggestions are accepted or
 * rejected, and conditions are evaluated against a profile.
 *
 * Every operation here works on a mark ID rather than on a position, which is what lets an
 * annotation split across fragments by an overlap still be handled as one thing. That property is
 * the whole claim of ADR-0005, so it is exercised by case 1 rather than assumed.
 */

/** The value a document declares for each profiling axis. */
export type Profile = Record<string, readonly string[]>;

export interface Fragment {
  readonly text: string;
  readonly marks: readonly Mark[];
}

function isParagraph(block: BlockNode): block is ParagraphNode {
  return block.type === 'paragraph';
}

function isText(node: InlineNode): node is TextNode {
  return node.type === 'text';
}

function textNodes(document: ContentDocument): TextNode[] {
  return document.content.filter(isParagraph).flatMap((block) => block.content.filter(isText));
}

/**
 * Every piece of text carrying the given mark, in document order. One annotation over an
 * overlapping range appears here as several fragments sharing one id - which is the point.
 */
export function fragmentsOf(document: ContentDocument, id: string): Fragment[] {
  return textNodes(document).filter((node) => node.marks.some((mark) => mark.id === id));
}

export function plainText(document: ContentDocument): string {
  return document.content
    .filter(isParagraph)
    .map((block) =>
      block.content
        .filter(isText)
        .map((node) => node.text)
        .join(''),
    )
    .join('\n');
}

/**
 * Rebuilds the document from a per-text-node decision: replace with these nodes, or drop. Block
 * ids are carried through - resolution is not an edit, and a block that lost its identity to a
 * resolution pass would compare as a deletion and an insertion for ever afterwards.
 */
function rewrite(
  document: ContentDocument,
  decide: (node: TextNode) => TextNode | undefined,
): ContentDocument {
  return doc(
    document.content.map((block) =>
      isParagraph(block)
        ? paragraph(
            block.content.flatMap((node) => (isText(node) ? (decide(node) ?? []) : node)),
            block.id,
          )
        : block,
    ),
  );
}

function withoutMark(node: TextNode, id: string): TextNode {
  return { ...node, marks: node.marks.filter((mark) => mark.id !== id) };
}

function suggestionOperation(
  document: ContentDocument,
  id: string,
): SuggestionMark['operation'] | undefined {
  for (const node of textNodes(document)) {
    for (const mark of node.marks) {
      if (mark.id === id && mark.type === 'suggestion') return mark.operation;
    }
  }
  return undefined;
}

/**
 * Applies a suggestion. A deletion takes its text with it; an insertion keeps its text. Either
 * way the mark is gone afterwards, everywhere, in one call - an unknown id is a no-op rather than
 * an error, because a suggestion already resolved by somebody else is a race, not a bug.
 */
export function acceptSuggestion(document: ContentDocument, id: string): ContentDocument {
  const operation = suggestionOperation(document, id);
  if (operation === undefined) return document;

  return rewrite(document, (node) => {
    if (!node.marks.some((mark) => mark.id === id)) return node;
    return operation === 'delete' ? undefined : withoutMark(node, id);
  });
}

/** The mirror image: a rejected deletion keeps its text, a rejected insertion loses it. */
export function rejectSuggestion(document: ContentDocument, id: string): ContentDocument {
  const operation = suggestionOperation(document, id);
  if (operation === undefined) return document;

  return rewrite(document, (node) => {
    if (!node.marks.some((mark) => mark.id === id)) return node;
    return operation === 'delete' ? withoutMark(node, id) : undefined;
  });
}

/**
 * Content marked with a condition survives only when the profile selects one of the mark's values.
 * An axis the profile says nothing about excludes: inclusion is stated, never inferred, because
 * the failure mode of the opposite default is publishing something to an audience it was written
 * to be withheld from.
 */
export function resolveConditions(document: ContentDocument, profile: Profile): ContentDocument {
  const selected = (mark: Mark): boolean => {
    if (mark.type !== 'condition') return true;
    const declared = profile[mark.axis] ?? [];
    return mark.values.some((value) => declared.includes(value));
  };

  return rewrite(document, (node) => (node.marks.every(selected) ? node : undefined));
}
