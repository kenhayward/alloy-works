import type { ContentDocument } from '../model/document.js';

import type { StageResult } from './migrate.js';
import type { ReportCollector } from './report.js';

/** The component content is being admitted into, and what it needs from its caller. */
export type Receiver = {
  readonly document: ContentDocument;
  /**
   * The condition axes the receiving space has. None exists before REU designs them, so every caller
   * passes `[]` today and every condition is dropped and reported - CNT-Q14's recommendation.
   */
  readonly conditionAxes: readonly string[];
  /**
   * A new identifier, never used before. The caller's, not this package's: the editor's identity
   * plugin allocates 128 random bits, and a platform-free package has no source of randomness it
   * could own. An identifier already in the component, or already allocated here, is drawn again.
   */
  readonly newIdentifier: () => string;
};

/** How many times an identifier that is empty or already used is drawn again before giving up. */
const ATTEMPTS = 8;

class AllocationFailed extends Error {}

/**
 * The fifth stage, over content in the current schema's terms (migrate has run).
 *
 * - **Every block, every footnote and every cross-reference gets a new identifier** (CNT-132), unique
 *   within the receiving component. A copied identifier is never kept, even where the receiving
 *   component lacks it: a duplicate is not a visible defect, and comparison would report a copy as a
 *   move for ever. A cross-reference whose block travelled with it is pointed at the copy.
 * - **Every mark gets a new identifier**, and fragments of one annotation - the same type and the
 *   same identifier on several runs - get the same new one, so it stays one annotation (CNT-004).
 * - **Comments and suggestions are dropped**, one report entry for each annotation rather than each
 *   fragment (CNT-133): their threads and authors belong to the component they were made on. The
 *   text they covered stays as it stood. **A condition whose axis the space lacks is dropped too.**
 */
export function reidentify(
  candidate: Record<string, unknown>,
  receiver: Receiver,
  report: ReportCollector,
): StageResult<Record<string, unknown>> {
  const state: State = {
    taken: identifiersIn(receiver.document),
    axes: new Set(receiver.conditionAxes),
    newIdentifier: receiver.newIdentifier,
    report,
    marks: new Map(),
    dropped: new Set(),
    blocks: 0,
    renamed: new Map(),
    references: [],
  };
  try {
    const content = mapArray(candidate.content, (block) => reidentifyBlock(block, state));
    const repointed = repoint(state);
    if (state.blocks > 0) {
      report.add('reidentify', 'rewritten', 'blockIdentifier', { count: state.blocks });
    }
    if (repointed > 0) {
      report.add('reidentify', 'rewritten', 'crossReferenceTarget', { count: repointed });
    }
    if (state.marks.size > 0) {
      report.add('reidentify', 'rewritten', 'markIdentifier', { count: state.marks.size });
    }
    return { ok: true, value: { ...candidate, content } };
  } catch (error) {
    if (!(error instanceof AllocationFailed)) throw error;
    report.add('reidentify', 'refused', 'identifiers');
    return { ok: false, failure: error.message };
  }
}

type State = {
  readonly taken: Set<string>;
  readonly axes: ReadonlySet<string>;
  readonly newIdentifier: () => string;
  readonly report: ReportCollector;
  /** New mark identifiers, by the type and identifier the mark arrived with. */
  readonly marks: Map<string, string>;
  /** Annotations already reported as dropped, by type and identifier. */
  readonly dropped: Set<string>;
  blocks: number;
  /** Each block's and footnote's new identifier, by the one it arrived with. */
  readonly renamed: Map<string, string>;
  /** Every cross-reference written, to be pointed once every block has its new identifier. */
  readonly references: Record<string, unknown>[];
};

/**
 * A cross-reference to a block of its own component that travelled with it is pointed at the copy,
 * so a figure pasted with the sentence citing it is cited by the copy of that sentence. The second
 * pass, because a reference can come before the block it names. A reference whose block did not
 * travel is left as it stands - resolution names it as missing (STR-029) - and so is one naming
 * another component's block, whose identifiers nothing here renames. Returns how many were pointed.
 */
function repoint(state: State): number {
  let count = 0;
  for (const reference of state.references) {
    const target = asRecord(reference.target);
    if (target?.kind !== 'block' || typeof target.block !== 'string') continue;
    const block = state.renamed.get(target.block);
    if (block === undefined) continue;
    reference.target = { ...target, block };
    count += 1;
  }
  return count;
}

/** Every identifier a document holds: its blocks', its footnotes' and its marks'. */
function identifiersIn(document: ContentDocument): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const member of value) walk(member);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') found.add(record.id);
    for (const member of Object.values(record)) walk(member);
  };
  walk(document.content);
  return found;
}

const EXHAUSTED = `${ATTEMPTS} identifiers in a row were empty or already used in the receiving component`;

/**
 * `newIdentifier` is the caller's, and a caller can throw (the identity plugin not being ready, say)
 * instead of returning. That is refused the same way as running out of usable identifiers - the same
 * subject, the same fixed message - never the thrown error's own message, which is the caller's and
 * not something to repeat in an author-facing report (decision 5: an outcome, never an exception).
 */
function allocate(state: State): string {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let identifier: unknown;
    try {
      identifier = state.newIdentifier();
    } catch {
      throw new AllocationFailed(EXHAUSTED);
    }
    if (typeof identifier === 'string' && identifier !== '' && !state.taken.has(identifier)) {
      state.taken.add(identifier);
      return identifier;
    }
  }
  throw new AllocationFailed(EXHAUSTED);
}

function mapArray(value: unknown, map: (member: unknown) => unknown[]): unknown {
  return Array.isArray(value) ? value.flatMap(map) : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function reidentifyBlock(value: unknown, state: State): unknown[] {
  const block = asRecord(value);
  if (!block) return [value];
  const out: Record<string, unknown> = { ...block, id: allocate(state) };
  state.blocks += 1;
  if (typeof block.id === 'string') state.renamed.set(block.id, out.id as string);
  const blocks = (member: unknown) => mapArray(member, (child) => reidentifyBlock(child, state));
  const inlines = (member: unknown) => mapArray(member, (child) => reidentifyInline(child, state));

  if (block.type === 'paragraph') out.content = inlines(block.content);
  if (block.type === 'blockquote') {
    out.content = blocks(block.content);
    if ('attribution' in block) out.attribution = inlines(block.attribution);
  }
  if (block.type === 'list') {
    out.items = mapArray(block.items, (item) => {
      const record = asRecord(item);
      return [record ? { ...record, content: blocks(record.content) } : item];
    });
  }
  if (block.type === 'table') {
    out.rows = mapArray(block.rows, (row) => {
      const record = asRecord(row);
      if (!record) return [row];
      const cells = mapArray(record.cells, (cell) => {
        const cellRecord = asRecord(cell);
        return [cellRecord ? { ...cellRecord, content: blocks(cellRecord.content) } : cell];
      });
      return [{ ...record, cells }];
    });
    if ('note' in block) out.note = inlines(block.note);
  }
  return [out];
}

function reidentifyInline(value: unknown, state: State): unknown[] {
  const inline = asRecord(value);
  if (!inline) return [value];
  if (inline.type === 'text') {
    return [{ ...inline, marks: mapArray(inline.marks, (mark) => reidentifyMark(mark, state)) }];
  }
  if (inline.type === 'crossReference') {
    const out: Record<string, unknown> = { ...inline, id: allocate(state) };
    state.blocks += 1;
    state.references.push(out);
    return [out];
  }
  if (inline.type === 'footnote') {
    const id = allocate(state);
    state.blocks += 1;
    if (typeof inline.id === 'string') state.renamed.set(inline.id, id);
    return [
      {
        ...inline,
        id,
        content: mapArray(inline.content, (block) => reidentifyBlock(block, state)),
      },
    ];
  }
  return [inline];
}

function reidentifyMark(value: unknown, state: State): unknown[] {
  const mark = asRecord(value);
  if (!mark) return [value];
  const key = typeof mark.id === 'string' ? `${String(mark.type)}\u{0}${mark.id}` : undefined;
  const firstSighting = key === undefined || !state.dropped.has(key);

  if (mark.type === 'comment' || mark.type === 'suggestion') {
    if (firstSighting) state.report.add('reidentify', 'discarded', mark.type);
    if (key !== undefined) state.dropped.add(key);
    return [];
  }
  if (mark.type === 'condition' && !(typeof mark.axis === 'string' && state.axes.has(mark.axis))) {
    if (firstSighting) {
      state.report.add(
        'reidentify',
        'discarded',
        'condition',
        typeof mark.axis === 'string' ? { detail: mark.axis } : {},
      );
    }
    if (key !== undefined) state.dropped.add(key);
    return [];
  }

  if (key === undefined) {
    const id = allocate(state);
    state.marks.set(`\u{0}${id}`, id);
    return [{ ...mark, id }];
  }
  let id = state.marks.get(key);
  if (id === undefined) {
    id = allocate(state);
    state.marks.set(key, id);
  }
  return [{ ...mark, id }];
}
