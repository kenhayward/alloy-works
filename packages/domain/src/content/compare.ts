import type { BlockNode, ContentDocument } from './document.js';
import { doc, paragraph } from './document.js';

/**
 * Block-level comparison between two versions of a document.
 *
 * The thing this exists to get right is telling a MOVE apart from a delete plus an insert. A
 * positional diff cannot, and calling one reordered paragraph "gone, and here is a new one" is the
 * commonest way a comparison view becomes noise rather than information.
 *
 * Two ways of establishing that two blocks are the same block, in order of trustworthiness:
 *
 *   1. `id` - exact, free, and available whenever both versions descend from content this system
 *      wrote. This is the ordinary case.
 *   2. content similarity - a fallback for versions that share no identity, which happens after a
 *      restore, after an import, or between components authored in unrelated sessions.
 *
 * Every change record says which was used, because a reader needs to know how much to trust it.
 */

export type BlockChangeKind =
  'unchanged' | 'edited' | 'moved' | 'moved-and-edited' | 'inserted' | 'removed';

export interface BlockChange {
  readonly kind: BlockChangeKind;
  /** Present when the block carries one in the version it came from. */
  readonly id?: string;
  /** Index in the earlier version, for everything but an insertion. */
  readonly from?: number;
  /** Index in the later version, for everything but a removal. */
  readonly to?: number;
  readonly matchedBy: 'id' | 'similarity' | 'none';
}

/** A block matches by similarity above this. Tuned against case 7; see the spike findings. */
const SIMILARITY_THRESHOLD = 0.4;

export function stripBlockIds(document: ContentDocument): ContentDocument {
  return doc(
    document.content.map((block) =>
      block.type === 'paragraph' ? paragraph(block.content) : block,
    ),
  );
}

function blockText(block: BlockNode): string {
  return block.type === 'paragraph'
    ? block.content.map((node) => node.text).join('')
    : `${block.query.id} ${block.columns.join(' ')}`;
}

/**
 * Everything but identity counts as content, so adding a condition to a paragraph is an edit and
 * a block that merely moved is not. `id: undefined` drops the key rather than nulling it, because
 * two blocks differing only by id are the same content.
 */
function blockSignature(block: BlockNode): string {
  return JSON.stringify({ ...block, id: undefined });
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Dice coefficient over word tokens. Word-level rather than character-level because the common
 * edit is adding or replacing words - "Bravo" against "Bravo, revised" scores 0.67 on tokens and
 * only 0.47 on character bigrams, and the second would have missed the match this case is about.
 */
function similarity(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

interface Pairing {
  readonly from: number;
  readonly to: number;
  readonly matchedBy: 'id' | 'similarity';
}

function pairBlocks(before: readonly BlockNode[], after: readonly BlockNode[]): Pairing[] {
  const pairs: Pairing[] = [];
  const takenBefore = new Set<number>();
  const takenAfter = new Set<number>();

  before.forEach((block, from) => {
    if (block.id === undefined) return;
    const to = after.findIndex((other, index) => !takenAfter.has(index) && other.id === block.id);
    if (to === -1) return;
    pairs.push({ from, to, matchedBy: 'id' });
    takenBefore.add(from);
    takenAfter.add(to);
  });

  // Everything identity could not settle, best-scoring pair first so a strong match is never
  // stolen by a weaker one that happened to come earlier in the document.
  const candidates: (Pairing & { score: number })[] = [];
  before.forEach((block, from) => {
    if (takenBefore.has(from)) return;
    after.forEach((other, to) => {
      if (takenAfter.has(to)) return;
      const score = similarity(blockText(block), blockText(other));
      if (score >= SIMILARITY_THRESHOLD) {
        candidates.push({ from, to, score, matchedBy: 'similarity' });
      }
    });
  });

  candidates.sort((left, right) => right.score - left.score);
  for (const candidate of candidates) {
    if (takenBefore.has(candidate.from) || takenAfter.has(candidate.to)) continue;
    pairs.push({ from: candidate.from, to: candidate.to, matchedBy: candidate.matchedBy });
    takenBefore.add(candidate.from);
    takenAfter.add(candidate.to);
  }

  return pairs.sort((left, right) => left.from - right.from);
}

/**
 * The longest set of pairs whose order is the same in both versions. Those blocks stayed put; the
 * rest are what actually moved. Without this, one paragraph moving past three others reports as
 * four moves, which is the same noise problem in a different costume.
 */
function longestStableRun(pairs: readonly Pairing[]): Set<number> {
  if (pairs.length === 0) return new Set();

  const length = pairs.map(() => 1);
  const previous = pairs.map(() => -1);
  let best = 0;

  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (pairs[j]!.to < pairs[i]!.to && length[j]! + 1 > length[i]!) {
        length[i] = length[j]! + 1;
        previous[i] = j;
      }
    }
    if (length[i]! > length[best]!) best = i;
  }

  const stable = new Set<number>();
  for (let index = best; index !== -1; index = previous[index]!) stable.add(index);
  return stable;
}

export function compareBlocks(before: ContentDocument, after: ContentDocument): BlockChange[] {
  const pairs = pairBlocks(before.content, after.content);
  const stable = longestStableRun(pairs);

  const changes: BlockChange[] = [];

  pairs.forEach((pair, index) => {
    const earlier = before.content[pair.from]!;
    const later = after.content[pair.to]!;
    const moved = !stable.has(index);
    const edited = blockSignature(earlier) !== blockSignature(later);
    const kind: BlockChangeKind = moved
      ? edited
        ? 'moved-and-edited'
        : 'moved'
      : edited
        ? 'edited'
        : 'unchanged';

    changes.push({
      kind,
      ...(later.id === undefined ? {} : { id: later.id }),
      from: pair.from,
      to: pair.to,
      matchedBy: pair.matchedBy,
    });
  });

  const pairedBefore = new Set(pairs.map((pair) => pair.from));
  const pairedAfter = new Set(pairs.map((pair) => pair.to));

  before.content.forEach((block, from) => {
    if (pairedBefore.has(from)) return;
    changes.push({
      kind: 'removed',
      ...(block.id === undefined ? {} : { id: block.id }),
      from,
      matchedBy: 'none',
    });
  });

  after.content.forEach((block, to) => {
    if (pairedAfter.has(to)) return;
    changes.push({
      kind: 'inserted',
      ...(block.id === undefined ? {} : { id: block.id }),
      to,
      matchedBy: 'none',
    });
  });

  return changes;
}
