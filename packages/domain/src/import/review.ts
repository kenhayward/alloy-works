import type { BlockNode } from '../content/model/blocks.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from '../content/model/document.js';
import { inBlocks, type ProposedChange, type ProposedThread } from './changes.js';
import { IMPORT_SOURCE_MOST, type ImportPartFlag, type ImportPartReason } from './proposal.js';

/**
 * Reviewing a proposal (the IM plan, IM-E; IMP-002, IMP-028, IMP-029, IMP-031, IMP-041): the
 * importer's edits to the edited set, each validated as made; what it is searched and filtered by;
 * and how much of it was accepted unchanged.
 */

/** A part of the edited set, in order. A component stands under the section before it. */
export interface ReviewPart {
  /** Null for a part this edit made. */
  readonly id: string | null;
  readonly kind: 'section' | 'component';
  readonly title: string;
  readonly blocks: readonly BlockNode[];
  readonly source: string;
  readonly reason: ImportReviewReason;
  readonly flags: readonly ImportPartFlag[];
  /** The parts as read it came from, by their place: more than one once merged. */
  readonly origins: readonly number[];
  /** The reader's identifiers of the headings it stands for (IMc): what a reference to one names. */
  readonly headings: readonly string[];
  /** Its Word authors' changes and its comments (IM-G), each on one of its blocks. */
  readonly changes: readonly ProposedChange[];
  readonly threads: readonly ProposedThread[];
}

/** Where a reference outside the import is pointed (IMP-034): a block of it, another's, or its text. */
export type ImportReferenceTarget =
  | { readonly kind: 'block'; readonly block: string }
  | { readonly kind: 'component'; readonly component: string; readonly block: string }
  | { readonly kind: 'text'; readonly text: string };

/** A part's reason, or that its importer split it there. */
export type ImportReviewReason = ImportPartReason | { readonly rule: 'split' };

export type ImportEdit =
  /** The part's first blocks to the end of the part before, or its last to the start of the next. */
  | {
      readonly edit: 'move';
      readonly part: string;
      readonly to: 'previous' | 'next';
      readonly blocks: number;
    }
  /** A new part after it, under its title, from the block at `at` on. */
  | { readonly edit: 'split'; readonly part: string; readonly at: number; readonly title: string }
  /** The part and the one after it, as one. */
  | { readonly edit: 'merge'; readonly part: string }
  | { readonly edit: 'rename'; readonly part: string; readonly title: string }
  | { readonly edit: 'kind'; readonly part: string; readonly kind: 'section' | 'component' }
  /** A reference outside the import, by its key, pointed elsewhere or made the text it showed. */
  | { readonly edit: 'reference'; readonly reference: string; readonly to: ImportReferenceTarget };

/** Why an edit was refused, by code. */
export type ImportEditRefusal =
  | 'part_missing'
  | 'no_neighbour'
  | 'neighbour_section'
  | 'section_holds_no_blocks'
  | 'blocks_out_of_range'
  | 'kinds_differ'
  | 'title_invalid'
  | 'content_invalid'
  | 'reference_missing'
  | 'target_missing'
  | 'identity_invalid'
  /** A part of an import again matched to what the earlier import did not make, or another holds. */
  | 'match_invalid';

const flagsOf = (
  kind: ReviewPart['kind'],
  blocks: readonly BlockNode[],
  from: readonly ReviewPart[],
): ImportPartFlag[] => [
  ...(kind === 'component' && blocks.length === 0 ? (['empty'] as const) : []),
  ...(from.some((part) => part.flags.includes('refused')) ? (['refused'] as const) : []),
];

const withBlocks = (part: ReviewPart, blocks: readonly BlockNode[]): ReviewPart => ({
  ...part,
  blocks,
  flags: flagsOf(part.kind, blocks, [part]),
});

/** Each change and thread of the parts given, carried to whichever of these now holds its block. */
function carried(from: readonly ReviewPart[], into: readonly ReviewPart[]): ReviewPart[] {
  const changes = from.flatMap((part) => part.changes);
  const threads = from.flatMap((part) => part.threads);
  const was = new Set(from.flatMap((each) => each.flags));
  return into.map((part) => {
    const tops = new Set(part.blocks.map((block) => block.id));
    const kept = changes.filter((change) => tops.has(change.block));
    const on = threads.filter((thread) => inBlocks(part.blocks, thread.block));
    const others = part.flags.filter(
      (flag) => flag !== 'changeClamped' && flag !== 'commentClamped',
    );
    return {
      ...part,
      changes: kept,
      threads: on,
      flags: [
        ...others,
        ...(was.has('changeClamped') && kept.length > 0 ? (['changeClamped'] as const) : []),
        ...(on.some((thread) => thread.clamped) ? (['commentClamped'] as const) : []),
      ],
    };
  });
}

/** A value with each reference to `key` given to `replace`: what it stands as, or nothing. */
function referred(
  value: unknown,
  key: string,
  replace: (node: Record<string, unknown>) => unknown[],
): { readonly value: unknown; readonly found: number } {
  let found = 0;
  const walk = (each: unknown): unknown => {
    if (Array.isArray(each)) {
      return each.flatMap((member) => {
        const node = member as Record<string, unknown> | null;
        const target = node?.['target'] as Record<string, unknown> | undefined;
        if (
          node?.['type'] === 'crossReference' &&
          target?.['kind'] === 'block' &&
          target['block'] === key
        ) {
          found += 1;
          return replace(node);
        }
        return [walk(member)];
      });
    }
    if (typeof each !== 'object' || each === null) return each;
    return Object.fromEntries(Object.entries(each).map(([name, member]) => [name, walk(member)]));
  };
  return { value: walk(value), found };
}

/** Whether a component's blocks are content, on the content schema's terms (CNT-013). */
function valid(
  part: ReviewPart,
  context: { readonly language: string; readonly direction: 'ltr' | 'rtl' },
): boolean {
  if (part.blocks.length === 0) return true;
  try {
    parseContentDocument({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      title: part.title,
      language: context.language,
      direction: context.direction,
      content: part.blocks,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The edited set after an edit, or why it is refused (IMP-041): every component it changes validated
 * as the importer's proposal is, so what it produces can be accepted.
 */
export function editProposal(
  parts: readonly ReviewPart[],
  edit: ImportEdit,
  context: { readonly language: string; readonly direction: 'ltr' | 'rtl' },
):
  | { readonly ok: true; readonly parts: readonly ReviewPart[] }
  | { readonly ok: false; readonly refusal: ImportEditRefusal } {
  const refuse = (refusal: ImportEditRefusal) => ({ ok: false as const, refusal });
  if (edit.edit === 'reference') return retarget(parts, edit, context);
  const at = parts.findIndex((part) => part.id === edit.part);
  const part = parts[at];
  if (!part) return refuse('part_missing');
  const out = [...parts];
  let changed: ReviewPart[];

  switch (edit.edit) {
    case 'rename':
    case 'split': {
      const title = edit.title.trim();
      if (title === '') return refuse('title_invalid');
      if (edit.edit === 'rename') {
        out[at] = { ...part, title };
        return { ok: true, parts: out };
      }
      if (!Number.isInteger(edit.at) || edit.at < 1 || edit.at >= part.blocks.length) {
        return refuse('blocks_out_of_range');
      }
      const after: ReviewPart = {
        ...withBlocks(part, part.blocks.slice(edit.at)),
        id: null,
        title,
        reason: { rule: 'split' },
        headings: [],
      };
      changed = carried([part], [withBlocks(part, part.blocks.slice(0, edit.at)), after]);
      out.splice(at, 1, ...changed);
      break;
    }
    case 'move': {
      const there = edit.to === 'previous' ? at - 1 : at + 1;
      const other = parts[there];
      if (!other) return refuse('no_neighbour');
      if (part.kind === 'section' || other.kind === 'section') return refuse('neighbour_section');
      if (!Number.isInteger(edit.blocks) || edit.blocks < 1 || edit.blocks >= part.blocks.length) {
        return refuse('blocks_out_of_range');
      }
      const moving =
        edit.to === 'previous'
          ? part.blocks.slice(0, edit.blocks)
          : part.blocks.slice(-edit.blocks);
      const kept =
        edit.to === 'previous'
          ? part.blocks.slice(edit.blocks)
          : part.blocks.slice(0, -edit.blocks);
      const received = withBlocks(
        other,
        edit.to === 'previous' ? [...other.blocks, ...moving] : [...moving, ...other.blocks],
      );
      changed = carried([part, other], [withBlocks(part, kept), received]);
      out[at] = changed[0]!;
      out[there] = changed[1]!;
      break;
    }
    case 'merge': {
      const following = parts[at + 1];
      if (!following) return refuse('no_neighbour');
      if (following.kind !== part.kind) return refuse('kinds_differ');
      const blocks = [...part.blocks, ...following.blocks];
      const merged: ReviewPart = {
        ...part,
        blocks,
        source: `${part.source}\n${following.source}`.slice(0, IMPORT_SOURCE_MOST),
        flags: flagsOf(part.kind, blocks, [part, following]),
        origins: [...new Set([...part.origins, ...following.origins])].sort((a, b) => a - b),
        headings: [...part.headings, ...following.headings],
      };
      changed = carried([part, following], [merged]);
      out.splice(at, 2, ...changed);
      break;
    }
    case 'kind': {
      if (edit.kind === part.kind) return { ok: true, parts: out };
      if (edit.kind === 'section' && part.blocks.length > 0) {
        return refuse('section_holds_no_blocks');
      }
      out[at] = { ...part, kind: edit.kind, flags: flagsOf(edit.kind, part.blocks, [part]) };
      return { ok: true, parts: out };
    }
  }
  if (!changed.every((each) => valid(each, context))) return refuse('content_invalid');
  return { ok: true, parts: out };
}

/**
 * A reference outside the import retargeted, or made the text it showed (IMP-034): every one under
 * its key, in each part's blocks and its suggested changes, each part it changes validated. A block
 * of the import must be one; another component's is the caller's to check.
 */
function retarget(
  parts: readonly ReviewPart[],
  edit: Extract<ImportEdit, { edit: 'reference' }>,
  context: { readonly language: string; readonly direction: 'ltr' | 'rtl' },
):
  | { readonly ok: true; readonly parts: readonly ReviewPart[] }
  | { readonly ok: false; readonly refusal: ImportEditRefusal } {
  const { to } = edit;
  if (to.kind === 'block' && !parts.some((part) => inBlocks(part.blocks, to.block))) {
    return { ok: false, refusal: 'target_missing' };
  }
  const replace = (node: Record<string, unknown>): unknown[] => {
    if (to.kind === 'text') {
      return to.text === '' ? [] : [{ type: 'text', value: to.text, marks: [] }];
    }
    const target =
      to.kind === 'block'
        ? { kind: 'block', block: to.block }
        : { kind: 'component', component: to.component, block: to.block };
    return [{ ...node, target }];
  };
  let found = 0;
  const out = parts.map((part) => {
    const blocks = referred(part.blocks, edit.reference, replace);
    const changes = referred(part.changes, edit.reference, replace);
    found += blocks.found + changes.found;
    if (blocks.found + changes.found === 0) return part;
    return {
      ...part,
      blocks: blocks.value as BlockNode[],
      changes: changes.value as ProposedChange[],
    };
  });
  if (found === 0) return { ok: false, refusal: 'reference_missing' };
  if (!out.every((part, index) => part === parts[index] || valid(part, context))) {
    return { ok: false, refusal: 'content_invalid' };
  }
  return { ok: true, parts: out };
}

/** How the parts accepted compare with the proposal as read (IMP-031), each counted once. */
export interface AcceptedCounts {
  readonly unchanged: number;
  readonly edited: number;
  readonly merged: number;
  readonly split: number;
  readonly renamed: number;
}

/**
 * Each accepted part counted in the first that applies: merged (from more than one part as read),
 * split (sharing what it came from with another), edited (its kind or blocks changed), renamed, or
 * unchanged.
 */
export function acceptedCounts(
  read: readonly Pick<ReviewPart, 'kind' | 'title' | 'blocks'>[],
  edited: readonly Pick<ReviewPart, 'kind' | 'title' | 'blocks' | 'origins'>[],
): AcceptedCounts {
  const counts = { unchanged: 0, edited: 0, merged: 0, split: 0, renamed: 0 };
  const uses = new Map<number, number>();
  for (const part of edited) {
    for (const origin of part.origins) uses.set(origin, (uses.get(origin) ?? 0) + 1);
  }
  for (const part of edited) {
    const was = read[part.origins[0] ?? -1];
    if (part.origins.length > 1) counts.merged += 1;
    else if ((uses.get(part.origins[0]!) ?? 0) > 1) counts.split += 1;
    else if (
      !was ||
      was.kind !== part.kind ||
      JSON.stringify(was.blocks) !== JSON.stringify(part.blocks)
    ) {
      counts.edited += 1;
    } else if (was.title !== part.title) counts.renamed += 1;
    else counts.unchanged += 1;
  }
  return counts;
}

/** The text a part is found by (IMP-029): its title and its blocks' text. */
function textOf(value: unknown, into: string[]): string[] {
  if (Array.isArray(value)) for (const each of value) textOf(each, into);
  else if (typeof value === 'object' && value !== null) {
    const node = value as Record<string, unknown>;
    if (node['type'] === 'text' && typeof node['value'] === 'string') into.push(node['value']);
    for (const [key, each] of Object.entries(node)) if (key !== 'value') textOf(each, into);
  }
  return into;
}

/** A block as its text, for review beside its source (IMP-028): a line for each run of text. */
export function blockText(block: BlockNode): string {
  const lines: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== 'object' || value === null) return;
    const content = (value as { content?: unknown }).content;
    const inline =
      Array.isArray(content) &&
      content.some((each) => (each as { type?: unknown } | null)?.type === 'text');
    if (inline) lines.push(textOf(content, []).join(''));
    else Object.values(value).forEach(walk);
  };
  walk(block);
  return lines.join('\n');
}

/** Whether a part's title or text holds the words asked, ignoring case. */
export function partMatches(part: Pick<ReviewPart, 'title' | 'blocks'>, query: string): boolean {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted === '') return true;
  return [part.title, textOf(part.blocks, []).join(' ')].some((text) =>
    text.toLocaleLowerCase().includes(wanted),
  );
}

/**
 * What review filters a part by (IMP-029): what it holds, and what the report said of the parts as
 * read it came from: not read yet, left out, or kept differently.
 */
export type ImportReviewFlag = ImportPartFlag | 'notYetRead' | 'leftOut' | 'keptDifferently';

export const importReviewFlags: readonly ImportReviewFlag[] = [
  'empty',
  'refused',
  'changeClamped',
  'commentClamped',
  'notYetRead',
  'leftOut',
  'keptDifferently',
];

export function reviewFlags(
  part: Pick<ReviewPart, 'flags' | 'origins'>,
  report: readonly {
    readonly action: string;
    readonly subject: string;
    readonly part: number | null;
  }[],
): ImportReviewFlag[] {
  const about = report.filter((entry) => entry.part !== null && part.origins.includes(entry.part));
  const has = new Set<ImportReviewFlag>(part.flags);
  for (const entry of about) {
    if (entry.subject === 'notYetRead') has.add('notYetRead');
    else if (entry.action === 'discarded') has.add('leftOut');
    else if (entry.action === 'rewritten' || entry.action === 'kept') has.add('keptDifferently');
  }
  return importReviewFlags.filter((flag) => has.has(flag));
}
