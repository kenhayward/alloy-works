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
 *   move for ever. A cross-reference whose block travelled with it is pointed at the copy - unless the
 *   old identifier arrived on more than one block, in which case which one it meant cannot be known, so
 *   it is left as it stands rather than guessed: failed by name, never guessed.
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
  const held = namesIn(receiver.document.content);
  const state: State = {
    taken: new Set([...held.reserved, ...namesIn(candidate.content).reserved]),
    axes: new Set(receiver.conditionAxes),
    newIdentifier: receiver.newIdentifier,
    report,
    marks: new Map(),
    dropped: new Set(),
    reidentified: 0,
    renamed: new Map(),
    ambiguous: new Set(),
    references: [],
  };
  try {
    const content = mapArray(candidate.content, (block) => reidentifyBlock(block, state));
    const { repointed, leftStanding } = repoint(state, held.targetable);
    if (state.reidentified > 0) {
      report.add('reidentify', 'rewritten', 'blockIdentifier', { count: state.reidentified });
    }
    if (repointed > 0) {
      report.add('reidentify', 'rewritten', 'crossReferenceTarget', { count: repointed });
    }
    if (leftStanding > 0) {
      report.add('reidentify', 'kept', 'crossReferenceUnresolved', { count: leftStanding });
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
  /** How many blocks, footnotes and cross-references have been given a new identifier so far. */
  reidentified: number;
  /** Each block's and footnote's new identifier, by the one it arrived with - unless ambiguous. */
  readonly renamed: Map<string, string>;
  /** Old identifiers that arrived on more than one block or footnote, so no single new one answers. */
  readonly ambiguous: Set<string>;
  /** Every cross-reference written, to be pointed once every block has its new identifier. */
  readonly references: Record<string, unknown>[];
};

/**
 * Records a block's or footnote's old identifier against its new one - unless that old identifier
 * has been seen before, in which case which block a reference naming it meant cannot be known, so it
 * is marked ambiguous instead and any earlier mapping is withdrawn. A range copied across two
 * occurrences of one component can bring two blocks sharing one identifier; guessing which one a
 * reference meant would be exactly the silent misdirection this stage exists to avoid - failed by
 * name (STR-029, at resolution), never guessed.
 */
function recordRenamed(state: State, from: string, to: string): void {
  if (state.ambiguous.has(from)) return;
  if (state.renamed.has(from)) {
    state.renamed.delete(from);
    state.ambiguous.add(from);
    return;
  }
  state.renamed.set(from, to);
}

/**
 * A cross-reference to a block of its own component that travelled with it is pointed at the copy,
 * so a figure pasted with the sentence citing it is cited by the copy of that sentence. The second
 * pass, because a reference can come before the block it names. A reference whose block did not
 * travel, or whose old identifier is ambiguous, is left as it stands - resolution names it as missing
 * (STR-029) - and so is one naming another component's block, whose identifiers nothing here renames
 * and which this count leaves out. Returns how many were pointed at a copy, and how many `block`
 * targets were left standing that the receiving component does not hold - `held`, its blocks' and
 * footnotes' identifiers - so the author is told here rather than only at resolution. One left
 * standing that the receiver does hold, as a sentence copied within one component does, resolves as
 * the original does, and is not counted: telling the author its target did not arrive would be false.
 * No new identifier can be one a target names (`namesIn` reserved them), so what the receiver held
 * before the paste is all a standing target can resolve to.
 */
function repoint(
  state: State,
  held: ReadonlySet<string>,
): { repointed: number; leftStanding: number } {
  let repointed = 0;
  let leftStanding = 0;
  for (const reference of state.references) {
    const target = asRecord(reference.target);
    if (target?.kind !== 'block' || typeof target.block !== 'string') continue;
    const block = state.renamed.get(target.block);
    if (block === undefined) {
      if (!held.has(target.block)) leftStanding += 1;
      continue;
    }
    reference.target = { ...target, block };
    repointed += 1;
  }
  return { repointed, leftStanding };
}

/**
 * Every identifier a value holds - a block's, a footnote's, a cross-reference's, a mark's - and every
 * `block` target its cross-references name, wherever they sit. Run over the receiving component and
 * over what arrived, and reserved in `taken` before anything is allocated, so a new identifier can
 * never coincide with any of them. A target is reserved as well as an identifier because a reference
 * can outlive its block: the receiver's own reference to a figure since deleted, or a pasted one whose
 * block did not travel (or is ambiguous, and so is left unrepointed), keeps naming the old identifier
 * literally - and a counter or an unlucky draw handing that exact string to a pasted block would
 * silently make the reference point at it. Also returns `targetable`: the identifiers a `block`
 * target can name - a block's and a footnote's, never a mark's or a cross-reference's.
 */
function namesIn(value: unknown): { reserved: Set<string>; targetable: Set<string> } {
  const reserved = new Set<string>();
  const targetable = new Set<string>();
  const walk = (node: unknown, inMarks: boolean): void => {
    if (Array.isArray(node)) {
      for (const member of node) walk(member, inMarks);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record.id === 'string') {
      reserved.add(record.id);
      if (!inMarks && record.type !== 'crossReference') targetable.add(record.id);
    }
    if (record.type === 'crossReference') {
      const target = asRecord(record.target);
      if (target?.kind === 'block' && typeof target.block === 'string') reserved.add(target.block);
    }
    for (const [name, member] of Object.entries(record)) walk(member, name === 'marks');
  };
  walk(value, false);
  return { reserved, targetable };
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
  state.reidentified += 1;
  if (typeof block.id === 'string') recordRenamed(state, block.id, out.id as string);
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
    state.reidentified += 1;
    state.references.push(out);
    return [out];
  }
  if (inline.type === 'footnote') {
    const id = allocate(state);
    state.reidentified += 1;
    if (typeof inline.id === 'string') recordRenamed(state, inline.id, id);
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
