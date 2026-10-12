import {
  parseContentDocument,
  type BlockNode,
  type ContentDocument,
} from '../content/model/index.js';
import { canonicalJson } from '../stored/canonical.js';

/** A place a suggestion no longer fits the current version, and why (COL-052). */
export interface StalePlace {
  /** The top-level block, or null for the document's own members. */
  readonly block: string | null;
  /** The document's member, where `block` is null. */
  readonly member?: 'title' | 'language' | 'direction';
  /**
   * `changed`: somebody changed it since the suggestion was made; `gone`: it is no longer there;
   * `anchor_gone`: the block a suggested block follows is no longer there; `invalid`: each place
   * fits, but the whole would not be a content document (two empty paragraphs side by side, say).
   */
  readonly why: 'changed' | 'gone' | 'anchor_gone' | 'invalid';
  /** Why the whole would not be one, for `invalid`. */
  readonly problem?: string;
}

export type Applied =
  | { readonly applies: true; readonly content: ContentDocument }
  | { readonly applies: false; readonly stale: readonly StalePlace[] };

const MEMBERS = ['title', 'language', 'direction'] as const;

const same = (left: unknown, right: unknown) =>
  left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right);

/** Every identifier anywhere in a value: a block's, an item's, a footnote's. */
function identifiersIn(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const each of value) identifiersIn(each, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value)) {
      if (key === 'id' && typeof member === 'string') into.add(member);
      else identifiersIn(member, into);
    }
  }
  return into;
}

/** A copy of a value with each identifier in `renamed` replaced by its new one. */
function renaming<T>(value: T, renamed: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) return value.map((each) => renaming(each, renamed)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        key === 'id' && typeof member === 'string'
          ? (renamed.get(member) ?? member)
          : renaming(member, renamed),
      ]),
    ) as T;
  }
  return value;
}

/** The identifiers of `order`'s blocks that keep their relative order in `to`: their longest run. */
function keptInOrder(order: readonly string[], to: readonly string[]): Set<string> {
  const lengths = order.map(() => to.map(() => 0));
  for (let i = order.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        order[i] === to[j]
          ? 1 + (lengths[i + 1]?.[j + 1] ?? 0)
          : Math.max(lengths[i + 1]?.[j] ?? 0, lengths[i]![j + 1] ?? 0);
    }
  }
  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < order.length && j < to.length) {
    if (order[i] === to[j]) {
      kept.add(order[i]!);
      i += 1;
      j += 1;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return kept;
}

/**
 * A suggestion applied to the component as it is now (collaboration.md, Suggestions; ADR-0058): a
 * three-way merge over the top-level blocks, by identifier, of what the reviewer drafted (`proposed`)
 * from the version they opened (`base`) into the version standing (`current`). Only the suggestion's
 * own acts are applied - a block it changed, removed, moved or added, and the document's title,
 * language and direction - in the current version's order, so nothing the author did meanwhile is
 * undone. A block counts as changed when anything in it differs; one the suggestion acts on must be
 * as it was in `base`, or the suggestion is stale there. Every place is said, and then nothing is
 * applied (COL-023, COL-052). Every kept block keeps its identifier (CNT-009); an added block's
 * identifiers already taken in the result are given fresh ones by `fresh`.
 */
export function applySuggestion(
  base: ContentDocument,
  proposed: ContentDocument,
  current: ContentDocument,
  fresh: () => string,
): Applied {
  const byId = (document: ContentDocument) =>
    new Map(document.content.map((block) => [block.id, block] as const));
  const was = byId(base);
  const now = byId(current);
  const drafted = proposed.content.map((block) => block.id);
  const draftedSet = new Set(drafted);
  const stale: StalePlace[] = [];
  /** Whether a block the suggestion acts on stands as it did, saying so where it does not. */
  const standing = (id: string): boolean => {
    const there = now.get(id);
    if (there === undefined) {
      stale.push({ block: id, why: 'gone' });
      return false;
    }
    if (!same(there, was.get(id))) {
      stale.push({ block: id, why: 'changed' });
      return false;
    }
    return true;
  };

  // The current version's order, as the merge's starting point.
  const order = current.content.map((block) => block.id);
  const taking = new Map<string, BlockNode>(now);

  // Removed: gone from the draft. One the author removed meanwhile is removed already.
  for (const id of was.keys()) {
    if (draftedSet.has(id) || !now.has(id)) continue;
    if (standing(id)) order.splice(order.indexOf(id), 1);
  }
  // Changed: in both, differing. One already as the draft has it, by somebody's hand, is done.
  for (const block of proposed.content) {
    const before = was.get(block.id);
    if (before === undefined || same(before, block) || same(now.get(block.id), block)) continue;
    if (standing(block.id)) taking.set(block.id, block);
  }
  // Moved: out of the longest run the base and the draft keep in order.
  const common = base.content.map((block) => block.id).filter((id) => draftedSet.has(id));
  const kept = keptInOrder(
    common,
    drafted.filter((id) => was.has(id)),
  );
  /** The block a drafted block follows in the draft, or null at the start. */
  const follows = (index: number) => (index === 0 ? null : drafted[index - 1]!);
  const placeAfter = (id: string, after: string | null, pastOthers = false) => {
    let at = after === null ? 0 : order.indexOf(after) + 1;
    // An added block goes after any other added since the version opened that follows the same
    // block, so suggestions accepted one after another stand in the order they were accepted.
    if (pastOthers) while (at < order.length && !was.has(order[at]!)) at += 1;
    order.splice(at, 0, id);
  };
  const taken = identifiersIn(current.content, new Set());
  // Each added block's identifier as placed, by its identifier in the draft.
  const placedAs = new Map<string, string>();
  // Moved and added blocks placed in the draft's order, so each one's predecessor is placed first.
  for (const [index, id] of drafted.entries()) {
    if (was.has(id) && kept.has(id)) continue;
    const before = follows(index);
    const after = before === null ? null : (placedAs.get(before) ?? before);
    if (after !== null && !order.includes(after)) {
      // What it follows was a block of the version opened that is gone now, or a block of the
      // suggestion's own that could not be placed.
      stale.push({ block: id, why: 'anchor_gone' });
      continue;
    }
    if (was.has(id)) {
      // Moved: it must still be there; its content is the current version's, or the change above.
      if (!now.has(id)) {
        stale.push({ block: id, why: 'gone' });
        continue;
      }
      order.splice(order.indexOf(id), 1);
      placeAfter(id, after);
      continue;
    }
    // Added: one already there as drafted, by somebody's hand, is done; identifiers already taken
    // are given fresh ones (CNT-009).
    const block = proposed.content[index]!;
    if (same(now.get(id), block)) continue;
    const renamed = new Map<string, string>();
    for (const each of identifiersIn(block, new Set())) {
      if (taken.has(each)) renamed.set(each, fresh());
    }
    const placed = renaming(block, renamed);
    for (const each of identifiersIn(placed, new Set())) taken.add(each);
    placedAs.set(id, placed.id);
    taking.set(placed.id, placed);
    placeAfter(placed.id, after, before === null || !placedAs.has(before));
  }
  // The document's own members.
  const members: Partial<Record<(typeof MEMBERS)[number], string>> = {};
  for (const member of MEMBERS) {
    if (proposed[member] === base[member]) continue;
    if (current[member] !== base[member]) stale.push({ block: null, member, why: 'changed' });
    else members[member] = proposed[member];
  }

  if (stale.length > 0) return { applies: false, stale };
  // Each place fits; the whole must still be a content document (CNT-002, CNT-023).
  try {
    const content = parseContentDocument({
      ...current,
      ...members,
      content: order.map((id) => taking.get(id)!),
    });
    return { applies: true, content };
  } catch (error) {
    return {
      applies: false,
      stale: [{ block: null, why: 'invalid', problem: (error as Error).message }],
    };
  }
}
