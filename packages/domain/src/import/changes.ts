import type { AdmissionOutcome } from '../content/admission/admit.js';
import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import { anchorStands } from '../review/threads.js';
import type { ImportChangeMark, ImportComment, ImportReply } from './structure.js';

/**
 * Tracked changes and comments as a proposal holds them (the IM plan, IM-G): a component's blocks as
 * every change rejected, each Word author's changes as the blocks they replace, and each comment as a
 * thread on its span. Matched across the versions admitted through the identifiers the reader gave.
 */

/**
 * One Word author's changes to one of a component's blocks: the blocks that stand in its place with
 * them made, the block's own identifier kept, what they insert new. A component's become one
 * suggestion for each author, against its 0.1, at acceptance.
 */
export interface ProposedChange {
  readonly author: string;
  /** The block, of the component's top level, it stands in place of. */
  readonly block: string;
  readonly proposed: readonly BlockNode[];
}

/**
 * A comment proposed as a thread: on its span in `block` where it stands there, else on the
 * component, `block` then where it was found; `clamped` where it was anchored short of its range.
 */
export interface ProposedThread extends ImportReply {
  readonly comment: string;
  readonly block: string;
  readonly span: boolean;
  readonly quote: string;
  readonly before: string;
  readonly clamped: boolean;
  readonly replies: readonly ImportReply[];
}

type Candidate = Record<string, unknown>;
type Admitted = Extract<AdmissionOutcome, { ok: true }>;

const isRecord = (value: unknown): value is Candidate =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every object beneath, its marks too where asked. */
export function* nodesIn(value: unknown, marks = false): Generator<Candidate> {
  if (Array.isArray(value)) for (const each of value) yield* nodesIn(each, marks);
  else if (isRecord(value)) {
    yield value;
    for (const [key, each] of Object.entries(value)) {
      if (marks || key !== 'marks') yield* nodesIn(each, marks);
    }
  }
}

const IDENTIFIED = new Set(['paragraph', 'list', 'table', 'figure', 'footnote', 'blockquote']);

/** A copy, every block and footnote identified, so each version admitted can be matched to another. */
export function identified(value: unknown, next: () => string): unknown {
  if (Array.isArray(value)) return value.map((each) => identified(each, next));
  if (!isRecord(value)) return value;
  const out: Candidate = {};
  for (const [key, each] of Object.entries(value)) out[key] = identified(each, next);
  if (
    typeof value.type === 'string' &&
    IDENTIFIED.has(value.type) &&
    typeof value.id !== 'string'
  ) {
    out.id = next();
  }
  return out;
}

export const changeOf = (value: unknown): ImportChangeMark | undefined =>
  isRecord(value) && isRecord(value.change)
    ? (value.change as unknown as ImportChangeMark)
    : undefined;

/** A paragraph every run of which one author inserted: theirs, or nobody's. */
export function insertedBy(block: unknown): string | undefined {
  if (!isRecord(block) || block.type !== 'paragraph' || !Array.isArray(block.content)) return;
  const changes = block.content.map(changeOf);
  if (changes.length === 0 || changes.some((each) => each?.kind !== 'insert')) return;
  return changes[0]!.author;
}

/**
 * The candidate with the changes `made` says are made, the rest rejected: an insertion's text kept
 * only where made, a deletion's only where not; and no change's mark left.
 */
export function settled(value: unknown, made: (change: ImportChangeMark) => boolean): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((each) => {
      const change = changeOf(each);
      if (change && (change.kind === 'insert') !== made(change)) return [];
      return [settled(each, made)];
    });
  }
  if (!isRecord(value)) return value;
  const out: Candidate = {};
  for (const [key, each] of Object.entries(value)) {
    if (key !== 'change') out[key] = settled(each, made);
  }
  return out;
}

const holds = (value: unknown, made: (change: ImportChangeMark) => boolean) =>
  [...nodesIn(value)].some((each) => {
    const change = changeOf(each);
    return change !== undefined && made(change);
  });

/** Whether a block or footnote of this identifier stands anywhere in these blocks. */
export const inBlocks = (blocks: readonly unknown[], id: string) =>
  [...nodesIn(blocks)].some((each) => each.id === id);

/** The block of the top level holding the one of this identifier. */
export const topOf = (blocks: readonly BlockNode[], id: string | undefined) =>
  id === undefined ? undefined : blocks.find((each) => inBlocks([each], id))?.id;

/**
 * An author's variant as the blocks each block of the base they changed is replaced by: matched
 * through the identifiers both were read with, the base's own given back - a block's, a footnote's,
 * a reference's and a mark's - so a suggestion changes only what its author changed. A paragraph they
 * inserted whole goes with the block before it, or the first where none is.
 */
export function changesOf(
  candidate: readonly Candidate[],
  base: Admitted,
  variant: Admitted,
  author: string,
  made: (change: ImportChangeMark) => boolean,
): ProposedChange[] {
  const read = new Map<string, string>();
  for (const [from, to] of variant.renamed) read.set(to, from);
  const owner = new Map<string, string>();
  const changed = new Set<string>();
  const first = candidate.find((each) => insertedBy(each) === undefined)?.id as string | undefined;
  let previous = first;
  for (const each of candidate) {
    const id = each.id as string;
    const by = insertedBy(each);
    if (by === undefined) {
      previous = id;
      owner.set(id, id);
      if (holds(each, made)) changed.add(id);
    } else if (by === author && previous !== undefined) {
      owner.set(id, previous);
      changed.add(previous);
    }
  }
  const baseOf = (readId: string | undefined) =>
    readId === undefined ? undefined : base.renamed.get(readId);
  const groups = new Map<string, BlockNode[]>();
  for (const block of variant.content) {
    const key = owner.get(read.get(block.id) ?? '');
    if (key === undefined || !changed.has(key)) continue;
    const at = base.content.find((each) => each.id === baseOf(key));
    groups.set(key, [...(groups.get(key) ?? []), restored(block, read, baseOf, at)]);
  }
  return [...groups].flatMap(([key, proposed]) => {
    const block = baseOf(key);
    return block === undefined ? [] : [{ author, block, proposed }];
  });
}

/** A reference's and each mark's kind, by which their identifiers are matched in order. */
const kindOf = (node: Candidate): string | undefined =>
  node.type === 'crossReference'
    ? 'crossReference'
    : typeof node.id === 'string' &&
        typeof node.type === 'string' &&
        node.type !== 'binding' &&
        !IDENTIFIED.has(node.type)
      ? `mark:${node.type}`
      : undefined;

/** A variant's block with the base's identifiers given back where both were read as one. */
function restored(
  block: BlockNode,
  read: ReadonlyMap<string, string>,
  baseOf: (readId: string | undefined) => string | undefined,
  at: BlockNode | undefined,
): BlockNode {
  const own = new Map<string, string[]>();
  for (const node of at === undefined ? [] : nodesIn(at, true)) {
    const kind = kindOf(node);
    if (kind !== undefined) own.set(kind, [...(own.get(kind) ?? []), node.id as string]);
  }
  const seen = new Map<string, number>();
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isRecord(value)) return value;
    const out: Candidate = {};
    const kind = kindOf(value);
    if (kind !== undefined) {
      const count = seen.get(kind) ?? 0;
      seen.set(kind, count + 1);
      const mine = own.get(kind)?.[count];
      if (mine !== undefined) out.id = mine;
    }
    for (const [key, each] of Object.entries(value)) {
      if (key === 'id' && kind !== undefined && out.id !== undefined) continue;
      out[key] = walk(each);
    }
    if (typeof value.id === 'string' && kind === undefined) {
      const given = baseOf(read.get(value.id));
      if (given !== undefined) out.id = given;
    }
    if (
      value.type === 'crossReference' &&
      isRecord(value.target) &&
      value.target.kind === 'block'
    ) {
      const given = baseOf(read.get(value.target.block as string));
      if (given !== undefined) out.target = { ...value.target, block: given };
    }
    return out;
  };
  return walk(block) as BlockNode;
}

/**
 * The comments starting in a component as threads (IM-G): each on its span where its quote stands
 * in its block, clamped to it, else on the component; one on the component's heading on the component.
 */
export function threadsOf(
  comments: readonly ImportComment[],
  part: { readonly headings: readonly string[]; readonly document: ContentDocument },
  base: Admitted,
): ProposedThread[] {
  const blocks = part.document.content;
  const threads: ProposedThread[] = [];
  for (const comment of comments) {
    const onHeading = part.headings.includes(comment.block);
    const block = onHeading ? undefined : base.renamed.get(comment.block);
    if (!onHeading && (block === undefined || !inBlocks(blocks, block))) continue;
    if (blocks.length === 0) continue;
    const quote = comment.quote.slice(0, 500);
    const before = comment.before.slice(-200);
    const span =
      block !== undefined &&
      quote !== '' &&
      anchorStands({ kind: 'span', block, quote, before }, { content: part.document });
    const { id, crossed, author, initials, date, text, replies } = comment;
    threads.push({
      author,
      initials,
      date,
      text,
      replies,
      comment: id,
      block: span ? block! : (topOf(blocks, block) ?? blocks[0]!.id),
      span,
      quote: span ? quote : '',
      before: span ? before : '',
      clamped: crossed || quote !== comment.quote || (!span && !onHeading),
    });
  }
  return threads;
}
