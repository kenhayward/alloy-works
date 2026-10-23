import type { BlockNode } from '../content/model/blocks.js';
import { nodesIn } from './changes.js';
import { blockText, type ReviewPart } from './review.js';

/**
 * **Importing again** (the IM plan, IM-K; IMP-036, IMP-037): each part of a file imported again
 * matched to a component the earlier import made, and what changed against that component as it is
 * now, so edits made in the space show as differences and are never overwritten.
 */

/** A component the earlier import made, in its outline's order. */
export interface AgainCandidate {
  readonly component: string;
  /** The heading the earlier import read it from (its provenance); null where none was recorded. */
  readonly heading: string | null;
  /** Its title now, which the space may have changed. */
  readonly title: string;
}

/** How a part was matched: what the earlier import read it from, its heading, its place, or by hand. */
export type AgainMatchedBy = 'provenance' | 'heading' | 'position' | 'importer';

export interface AgainMatch {
  readonly component: string;
  readonly by: AgainMatchedBy;
}

const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** The heading a part was read from, else its title. */
const readFrom = (part: Pick<ReviewPart, 'title' | 'reason'>) =>
  normal('text' in part.reason && part.reason.text !== undefined ? part.reason.text : part.title);

/**
 * Each part's match (IM-K), a section's always none: first the component read from the same heading
 * as the earlier import read it, then one whose title now is the part's, then, between two parts
 * matched so, the components left there paired in order. What no part matches is gone.
 */
export function matchAgain(
  parts: readonly Pick<ReviewPart, 'kind' | 'title' | 'reason'>[],
  candidates: readonly AgainCandidate[],
): { readonly matches: readonly (AgainMatch | null)[]; readonly gone: readonly string[] } {
  const matches: (AgainMatch | null)[] = parts.map(() => null);
  const taken = new Set<number>();
  const pass = (
    by: 'provenance' | 'heading',
    same: (candidate: AgainCandidate, part: (typeof parts)[number]) => boolean,
  ) =>
    parts.forEach((part, index) => {
      if (part.kind !== 'component' || matches[index] !== null) return;
      const at = candidates.findIndex((each, place) => !taken.has(place) && same(each, part));
      if (at === -1) return;
      taken.add(at);
      matches[index] = { component: candidates[at]!.component, by };
    });
  pass(
    'provenance',
    (each, part) => each.heading !== null && normal(each.heading) === readFrom(part),
  );
  pass('heading', (each, part) => normal(each.title) === normal(part.title));

  // Between two matched parts (or an end), the components left between theirs, paired in order.
  const placeOf = (index: number) =>
    candidates.findIndex((each) => each.component === matches[index]?.component);
  let index = 0;
  while (index < parts.length) {
    if (parts[index]!.kind !== 'component' || matches[index] !== null) {
      index += 1;
      continue;
    }
    const gap: number[] = [];
    let end = index;
    for (; end < parts.length && matches[end] === null; end += 1) {
      if (parts[end]!.kind === 'component') gap.push(end);
    }
    let before = -1;
    for (let back = index - 1; back >= 0; back -= 1) {
      if (matches[back] !== null) {
        before = placeOf(back);
        break;
      }
    }
    const after = end < parts.length ? placeOf(end) : candidates.length;
    const left = candidates
      .map((_, place) => place)
      .filter((place) => place > before && place < after && !taken.has(place));
    gap.forEach((part, at) => {
      const place = left[at];
      if (place === undefined) return;
      taken.add(place);
      matches[part] = { component: candidates[place]!.component, by: 'position' };
    });
    index = end;
  }
  return {
    matches,
    gone: candidates.filter((_, place) => !taken.has(place)).map((each) => each.component),
  };
}

/** Each block as its kind and its text: what a part is compared by. */
const linesOf = (blocks: readonly BlockNode[]) =>
  blocks.map((block) => ({
    key: `${block.type}\u0000${blockText(block)}`,
    text: blockText(block),
  }));

/**
 * A part against its component as it is now (IM-K): `unchanged` where each block's kind and text are
 * its; `new` where it matches none. Formatting alone is not compared.
 */
export function againStatus(
  blocks: readonly BlockNode[],
  current: readonly BlockNode[] | null,
): 'unchanged' | 'changed' | 'new' {
  if (current === null) return 'new';
  const ours = linesOf(blocks).map((each) => each.key);
  const theirs = linesOf(current).map((each) => each.key);
  return ours.length === theirs.length && ours.every((each, at) => each === theirs[at])
    ? 'unchanged'
    : 'changed';
}

export interface AgainLine {
  readonly change: 'same' | 'added' | 'removed';
  readonly text: string;
}

/** The most blocks a part and its component may differ by, each, and still be paired block by block. */
export const AGAIN_DIFF_MOST = 2000;

/**
 * Which blocks of a part are blocks of its component as it is now, by their places, in order: the
 * longest common run, past the start and end they share. A middle longer than `AGAIN_DIFF_MOST`
 * either side pairs nothing, so it is shown replaced rather than costing a table of its size.
 */
function againPairs(current: readonly BlockNode[], incoming: readonly BlockNode[]) {
  const a = linesOf(current).map((each) => each.key);
  const b = linesOf(incoming).map((each) => each.key);
  const pairs: [number, number][] = [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    pairs.push([head, head]);
    head += 1;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const rows = a.length - head - tail;
  const columns = b.length - head - tail;
  if (rows > 0 && columns > 0 && rows <= AGAIN_DIFF_MOST && columns <= AGAIN_DIFF_MOST) {
    // The longest common run, from the end, so the walk below reads forwards.
    const longest = Array.from({ length: rows + 1 }, () => new Uint16Array(columns + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = columns - 1; j >= 0; j -= 1) {
        longest[i]![j] =
          a[head + i] === b[head + j]
            ? longest[i + 1]![j + 1]! + 1
            : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < columns) {
      if (a[head + i] === b[head + j]) {
        pairs.push([head + i, head + j]);
        i += 1;
        j += 1;
      } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) i += 1;
      else j += 1;
    }
  }
  for (let at = tail; at > 0; at -= 1) pairs.push([a.length - at, b.length - at]);
  return pairs;
}

/** What a part changes of its component as it is now, block by block, as text (IMP-036). */
export function againDiff(
  current: readonly BlockNode[],
  incoming: readonly BlockNode[],
): AgainLine[] {
  const a = linesOf(current);
  const b = linesOf(incoming);
  const lines: AgainLine[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...againPairs(current, incoming), [a.length, b.length] as const]) {
    for (; i < pi; i += 1) lines.push({ change: 'removed', text: a[i]!.text });
    for (; j < pj; j += 1) lines.push({ change: 'added', text: b[j]!.text });
    if (pi < a.length) {
      lines.push({ change: 'same', text: b[pj]!.text });
      i += 1;
      j += 1;
    }
  }
  return lines;
}

/** Every identified node of a block, its marks' too, by kind, in order. */
const identifiersIn = (block: BlockNode) =>
  [...nodesIn(block, true)].flatMap((node) =>
    typeof node.id === 'string' ? [{ id: node.id, type: String(node.type) }] : [],
  );

/**
 * The identifiers a part's blocks take from its component as it is now (IMP-037): each block paired
 * with one of the component's its own, and those inside it, where both hold the same kinds in the same
 * order, so an unchanged block keeps its identity and what anchors to it stands. By the part's.
 */
export function againIdentifiers(
  current: readonly BlockNode[],
  incoming: readonly BlockNode[],
): Map<string, string> {
  const carried = new Map<string, string>();
  for (const [i, j] of againPairs(current, incoming)) {
    const theirs = identifiersIn(current[i]!);
    const ours = identifiersIn(incoming[j]!);
    if (ours.length === theirs.length && ours.every((each, at) => each.type === theirs[at]!.type)) {
      ours.forEach((each, at) => carried.set(each.id, theirs[at]!.id));
    } else carried.set(incoming[j]!.id, current[i]!.id);
  }
  return carried;
}
