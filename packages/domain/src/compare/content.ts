import type { BlockNode, ContentDocument, InlineNode } from '../content/model/index.js';
import type {
  OutlineDocument,
  OutlineNode,
  OutlineView,
  OutlineViewNode,
} from '../structure/outline.js';
import { canonicalJson } from '../stored/canonical.js';

/**
 * Two versions of a component compared as **anchored changes** (comparison.md; ADR-0058; the CP plan,
 * CP-A to CP-C): every unit - a block, a list item, a table cell, a footnote's content - matched by
 * its key, then by similarity, then placed by the longest run kept in order, each matched one's text
 * compared word by word. The result is what every rendering reads, and what a suggestion records.
 */

/** A word, a run of spaces, a punctuation mark, or an inline node that is not text. */
interface Token {
  /** What equality compares: the text, or the node's identity. */
  readonly key: string;
  /** What a redline prints: the text, or U+FFFC for a node. */
  readonly text: string;
}

/** One step of a word-level comparison, consecutive tokens of one kind joined. */
export interface WordOp {
  readonly op: 'keep' | 'insert' | 'delete';
  readonly text: string;
}

/** A block's text compared: its operations, or `whole` past the bound a block is compared within. */
export type TextEdit = { readonly ops: readonly WordOp[] } | { readonly whole: true };

/** One unit's change, in the newer side's reading order, deletions where they stood. */
export type UnitChange =
  | {
      readonly change: 'inserted';
      readonly newer: string;
      readonly type: string;
      readonly parent: string;
      /** The unit it stands after under its parent, or null at the parent's start. */
      readonly after: string | null;
    }
  | {
      readonly change: 'deleted';
      readonly older: string;
      readonly type: string;
      readonly parent: string;
    }
  | {
      readonly change: 'matched';
      readonly older: string;
      readonly newer: string;
      readonly type: string;
      readonly parent: string;
      /** How the two were found to be one (VER-029). */
      readonly matched: 'identity' | 'similarity';
      /** Where it now stands, if it moved; null where it kept its place. */
      readonly moved: { readonly after: string | null } | null;
      /** Its text compared, or null where it is the same. */
      readonly edited: TextEdit | null;
      /** Each attribute that differs: `style`, `kind`, `shape`, `marks` and the rest. */
      readonly changed: readonly string[];
      /** The block its end became, where it was split. */
      readonly split: string | null;
      /** The block taken into it, where one was joined to it. */
      readonly joined: string | null;
    };

export interface ContentComparison {
  readonly changes: readonly UnitChange[];
  /**
   * Whether the units left over were too many to score for similarity (CP-C): those were deleted and
   * inserted rather than matched, and a reader is told so.
   */
  readonly similarityBounded: boolean;
}

/** What a comparison cost, counted (VER-051): pairs scored for similarity, cells of word tables. */
export interface Meter {
  similarityPairs: number;
  wordCells: number;
}

export const createMeter = (): Meter => ({ similarityPairs: 0, wordCells: 0 });

/** A block's words compared within this many cells; past it, the block is `whole` (CP-C). */
const WORD_CELLS_MAX = 250_000;

/** The most pairs scored for similarity in one comparison: past it, none are (CP-C). */
const SIMILARITY_PAIRS_MAX = 250_000;

/** The content model spike's threshold, tuned on one case (VER's open question Q05). */
export const SIMILARITY_THRESHOLD = 0.4;

interface Unit {
  readonly key: string;
  readonly type: string;
  readonly parent: string;
  /** Its place among its parent's units. */
  readonly index: number;
  /** Its own inline text as tokens, or null for a unit that holds none. */
  readonly tokens: readonly Token[] | null;
  /** Each attribute by name, canonical, compared field by field. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The first unit beneath it, which a container is matched through when its key is not. */
  firstChild: string | null;
}

const ROOT = 'root';
const WORD = /\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

function tokensOf(inlines: readonly InlineNode[] | undefined): Token[] {
  const tokens: Token[] = [];
  for (const node of inlines ?? []) {
    if (node.type === 'text') {
      for (const word of node.value.match(WORD) ?? []) tokens.push({ key: `t${word}`, text: word });
    } else if (node.type === 'footnote') {
      // By identifier: its content is compared beneath it, never as part of the text it stands in.
      tokens.push({ key: `f${node.id}`, text: '￼' });
    } else if (node.type === 'messageForm') {
      // The form by its identity and binding, then each arm's words in key order, each arm opened by a
      // token of its own, so a word changed in one arm is that word's change (the MF plan, MF-D).
      tokens.push({ key: `m${canonicalJson({ id: node.id, binding: node.binding })}`, text: '￼' });
      for (const key of Object.keys(node.arms).sort()) {
        tokens.push({ key: `a${key}`, text: ' ' });
        for (const each of node.arms[key as keyof typeof node.arms]!) {
          if (each.type === 'messageValue') tokens.push({ key: 'v', text: '￼' });
          else for (const word of each.value.match(WORD) ?? []) tokens.push({ key: `t${word}`, text: word });
        }
      }
    } else tokens.push({ key: `n${canonicalJson(node)}`, text: '￼' });
  }
  return tokens;
}

/** The marks over a run of text, by run - an arm's runs among them - which formatting changes alone touch. */
const marksOf = (inlines: readonly InlineNode[] | undefined) =>
  canonicalJson(
    (inlines ?? []).map((node) =>
      node.type === 'text'
        ? node.marks
        : node.type === 'messageForm'
          ? Object.fromEntries(
              Object.entries(node.arms).map(([key, arm]) => [
                key,
                arm.map((each) => (each.type === 'text' ? each.marks : null)),
              ]),
            )
          : null,
    ),
  );

const plain = (tokens: readonly Token[] | null) => (tokens ?? []).map((each) => each.text).join('');

/** Every unit of a document, in reading order, each under its parent's key. */
function unitsOf(document: ContentDocument): Unit[] {
  const units: Unit[] = [];
  const byKey = new Map<string, Unit>();
  const children = new Map<string, number>();
  const add = (
    key: string,
    type: string,
    parent: string,
    tokens: Token[] | null,
    attrs: Record<string, string>,
  ) => {
    const index = children.get(parent) ?? 0;
    children.set(parent, index + 1);
    const unit: Unit = { key, type, parent, index, tokens, attrs, firstChild: null };
    const above = byKey.get(parent);
    if (above && above.firstChild === null) above.firstChild = key;
    units.push(unit);
    byKey.set(key, unit);
  };
  const footnotes = (inlines: readonly InlineNode[] | undefined, parent: string) => {
    for (const node of inlines ?? []) {
      if (node.type !== 'footnote') continue;
      const key = `footnote:${node.id}`;
      add(key, 'footnote', parent, null, { anchor: canonicalJson(node.anchor) });
      blocks(node.content as BlockNode[], key);
    }
  };
  const blocks = (list: readonly BlockNode[], parent: string) => {
    for (const block of list) {
      switch (block.type) {
        case 'paragraph':
          add(block.id, block.type, parent, tokensOf(block.content), {
            style: block.style,
            marks: marksOf(block.content),
          });
          footnotes(block.content, block.id);
          break;
        case 'list':
          add(block.id, block.type, parent, null, {
            kind: block.kind,
            start: canonicalJson(block.start ?? null),
            format: canonicalJson(block.format ?? null),
          });
          block.items.forEach((item, index) => {
            const key = `item:${item.content[0]?.id ?? `${block.id}#${index}`}`;
            add(key, 'item', block.id, item.term ? tokensOf(item.term) : null, {
              marks: marksOf(item.term),
            });
            footnotes(item.term, key);
            blocks(item.content, key);
          });
          break;
        case 'table': {
          const { id, caption, note, rows, ...rest } = block;
          add(id, block.type, parent, tokensOf(caption), {
            ...Object.fromEntries(
              Object.entries(rest).map(([name, value]) => [name, canonicalJson(value ?? null)]),
            ),
            note: canonicalJson(note ?? null),
            shape: canonicalJson(rows.map((row) => row.cells.length)),
            marks: marksOf(caption),
          });
          footnotes(caption, id);
          footnotes(note, id);
          rows.forEach((row, r) =>
            row.cells.forEach((cell, c) => {
              // By the block it holds, as an item is, so a row added above moves no cell.
              const key = `cell:${cell.content[0]?.id ?? `${id}:${r}:${c}`}`;
              add(key, 'cell', id, null, {
                colspan: `${cell.colspan}`,
                rowspan: `${cell.rowspan}`,
              });
              blocks(cell.content, key);
            }),
          );
          break;
        }
        case 'blockquote':
          add(block.id, block.type, parent, tokensOf(block.attribution), {
            marks: marksOf(block.attribution),
          });
          footnotes(block.attribution, block.id);
          blocks(block.content, block.id);
          break;
        case 'preformatted':
          add(
            block.id,
            block.type,
            parent,
            (block.text.match(WORD) ?? []).map((word) => ({ key: `t${word}`, text: word })),
            { language: canonicalJson(block.language ?? null) },
          );
          break;
        default: {
          // A figure, a bound table or an equation: its caption its text, the rest attributes.
          const { id, ...rest } = block as BlockNode & { caption?: InlineNode[] };
          const { caption, notes, ...attributes } = rest as typeof rest & {
            caption?: InlineNode[];
            notes?: InlineNode[];
          };
          add(
            id,
            block.type,
            parent,
            caption ? tokensOf(caption) : null,
            Object.fromEntries(
              Object.entries(attributes).map(([name, value]) => [
                name,
                canonicalJson(value ?? null),
              ]),
            ),
          );
          footnotes(caption, id);
          footnotes(notes, id);
        }
      }
    }
  };
  blocks(document.content, ROOT);
  return units;
}

/** A unit as a redline prints it: its type, its parent's key and its own text. */
export interface UnitText {
  readonly type: string;
  readonly parent: string;
  readonly text: string;
}

/**
 * Every unit of a document by its key, as a redline prints an inserted or a deleted one: an inline
 * node that is not text stands as U+FFFC, and a unit holding no text of its own has none.
 */
export function unitTexts(document: ContentDocument): ReadonlyMap<string, UnitText> {
  return new Map(
    unitsOf(document).map((unit) => [
      unit.key,
      { type: unit.type, parent: unit.parent, text: plain(unit.tokens) },
    ]),
  );
}

/** Every node of an outline by its identifier: a section's title as its text, a reference none. */
export function outlineTexts(
  outline: OutlineDocument | OutlineView,
): ReadonlyMap<string, UnitText> {
  return new Map(
    outlineUnits(outline).map((unit) => [
      unit.key,
      { type: unit.type, parent: unit.parent, text: plain(unit.tokens) },
    ]),
  );
}

/** The spike's similarity tokens: lower-cased words, no punctuation - what 0.4 was tuned on. */
const similarityWords = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0),
  );

function dice(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** The word-level operations from one token list to another: LCS, walked forward. */
function diffTokens(older: readonly Token[], newer: readonly Token[], meter: Meter): TextEdit {
  const n = older.length;
  const m = newer.length;
  if (n * m > WORD_CELLS_MAX) return { whole: true };
  meter.wordCells += n * m;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        older[i]!.key === newer[j]!.key
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const ops: WordOp[] = [];
  const push = (op: WordOp['op'], text: string) => {
    const last = ops[ops.length - 1];
    if (last?.op === op) ops[ops.length - 1] = { op, text: last.text + text };
    else ops.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && older[i]!.key === newer[j]!.key) {
      push('keep', newer[j]!.text);
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      push('delete', older[i]!.text);
      i += 1;
    } else {
      push('insert', newer[j]!.text);
      j += 1;
    }
  }
  return { ops };
}

/** The indexes, in order, of the longest increasing run of `values`: what stood still. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const length = values.map(() => 1);
  const previous = values.map(() => -1);
  let best = -1;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (values[j]! < values[i]! && length[j]! + 1 > length[i]!) {
        length[i] = length[j]! + 1;
        previous[i] = j;
      }
    }
    if (best === -1 || length[i]! > length[best]!) best = i;
  }
  const kept = new Set<number>();
  for (let index = best; index !== -1; index = previous[index]!) kept.add(index);
  return kept;
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Two versions of a component compared (VER-024's content level; VER-027 to VER-029). Pure: the same
 * two documents give the same changes. `meter` counts what it cost (VER-051).
 */
export function compareContent(
  older: ContentDocument,
  newer: ContentDocument,
  meter: Meter = createMeter(),
): ContentComparison {
  return compareUnits(unitsOf(older), unitsOf(newer), meter);
}

/**
 * Two documents' outlines compared (VER-024's structural level): each node by its identifier, a
 * section's title as its text, a reference's component and mode and every node's place as attributes.
 */
/**
 * An outline withheld for its reader (`withholdComponents`) compares as one stored: a withheld
 * reference is its node, equal to itself on both sides.
 */
export function compareOutlines(
  older: OutlineDocument | OutlineView,
  newer: OutlineDocument | OutlineView,
  meter: Meter = createMeter(),
): ContentComparison {
  return compareUnits(outlineUnits(older), outlineUnits(newer), meter);
}

function outlineUnits(outline: OutlineDocument | OutlineView): Unit[] {
  const units: Unit[] = [];
  const walk = (nodes: readonly (OutlineNode | OutlineViewNode)[], parent: string) => {
    nodes.forEach((node, index) => {
      const { id, children, ...rest } = node;
      const { title, ...attributes } = rest as typeof rest & { title?: InlineNode[] };
      units.push({
        key: id,
        type: node.type,
        parent,
        index,
        tokens: title ? tokensOf(title) : null,
        attrs: Object.fromEntries(
          Object.entries(attributes).map(([name, value]) => [name, canonicalJson(value ?? null)]),
        ),
        firstChild: children[0]?.id ?? null,
      });
      walk(children, id);
    });
  };
  walk(outline.nodes, ROOT);
  return units;
}

function compareUnits(
  before: readonly Unit[],
  after: readonly Unit[],
  meter: Meter,
): ContentComparison {
  const beforeByKey = new Map(before.map((unit) => [unit.key, unit]));
  const afterByKey = new Map(after.map((unit) => [unit.key, unit]));
  /** Each older key's newer partner, and how it was found. */
  const partner = new Map<string, { key: string; matched: 'identity' | 'similarity' }>();
  const partnered = new Set<string>();
  const pair = (from: string, to: string, matched: 'identity' | 'similarity') => {
    partner.set(from, { key: to, matched });
    partnered.add(to);
  };
  const childrenOf = (units: readonly Unit[]) => {
    const children = new Map<string, Unit[]>();
    for (const unit of units) {
      const list = children.get(unit.parent);
      if (list) list.push(unit);
      else children.set(unit.parent, [unit]);
    }
    return children;
  };
  const beforeChildren = childrenOf(before);
  const afterChildren = childrenOf(after);

  // By key, where the type agrees.
  for (const unit of before) {
    const other = afterByKey.get(unit.key);
    if (other && other.type === unit.type) pair(unit.key, other.key, 'identity');
  }
  // By similarity, among blocks of one type holding text, best first (VER-028), within a bound: past
  // it, what is left over is deleted and inserted, and the comparison says so (CP-C).
  const containers = new Set(['item', 'cell', 'footnote']);
  const leftBefore = before.filter(
    (unit) => !partner.has(unit.key) && !containers.has(unit.type) && plain(unit.tokens) !== '',
  );
  const leftAfter = after.filter(
    (unit) => !partnered.has(unit.key) && !containers.has(unit.type) && plain(unit.tokens) !== '',
  );
  const similarityBounded = leftBefore.length * leftAfter.length > SIMILARITY_PAIRS_MAX;
  if (!similarityBounded) {
    const words = new Map(
      [...leftBefore, ...leftAfter].map((unit) => [unit, similarityWords(plain(unit.tokens))]),
    );
    const candidates: { from: Unit; to: Unit; score: number }[] = [];
    for (const from of leftBefore) {
      for (const to of leftAfter) {
        if (from.type !== to.type) continue;
        meter.similarityPairs += 1;
        const score = dice(words.get(from)!, words.get(to)!);
        if (score >= SIMILARITY_THRESHOLD) candidates.push({ from, to, score });
      }
    }
    candidates.sort((left, right) => right.score - left.score);
    for (const { from, to } of candidates) {
      if (partner.has(from.key) || partnered.has(to.key)) continue;
      pair(from.key, to.key, 'similarity');
    }
  }
  // A container left over, through any unit beneath it that matched one beneath a container of its
  // type also left over: an item whose first block moved down is still that item.
  for (const unit of before) {
    if (partner.has(unit.key) || !containers.has(unit.type)) continue;
    for (const child of beforeChildren.get(unit.key) ?? []) {
      const through = partner.get(child.key);
      const candidate = through && afterByKey.get(afterByKey.get(through.key)!.parent);
      if (candidate && candidate.type === unit.type && !partnered.has(candidate.key)) {
        pair(unit.key, candidate.key, through.matched);
        break;
      }
    }
  }

  const newerOf = (key: string) => (key === ROOT ? ROOT : partner.get(key)?.key);
  const olderOf = new Map([...partner].map(([from, to]) => [to.key, from]));
  // What stood still under each parent: the longest run of older places in newer order.
  const moved = new Set<string>();
  for (const [parent, units] of afterChildren) {
    const matched = units.filter((unit) => olderOf.has(unit.key));
    const stays = matched.filter(
      (unit) => newerOf(beforeByKey.get(olderOf.get(unit.key)!)!.parent) === parent,
    );
    const staying = new Set(stays);
    for (const unit of matched) if (!staying.has(unit)) moved.add(unit.key);
    const kept = longestIncreasing(
      stays.map((unit) => beforeByKey.get(olderOf.get(unit.key)!)!.index),
    );
    stays.forEach((unit, index) => {
      if (!kept.has(index)) moved.add(unit.key);
    });
  }

  const previousSibling = new Map<string, string | null>();
  for (const units of afterChildren.values()) {
    units.forEach((unit, index) => previousSibling.set(unit.key, units[index - 1]?.key ?? null));
  }
  const siblingAfter = (units: ReadonlyMap<string, Unit[]>, unit: Unit) =>
    units.get(unit.parent)?.[unit.index + 1];

  const changeOf = new Map<string, UnitChange>();
  for (const unit of after) {
    const from = olderOf.get(unit.key);
    if (from === undefined) {
      changeOf.set(unit.key, {
        change: 'inserted',
        newer: unit.key,
        type: unit.type,
        parent: unit.parent,
        after: previousSibling.get(unit.key) ?? null,
      });
      continue;
    }
    const old = beforeByKey.get(from)!;
    const sameText =
      old.tokens === null && unit.tokens === null
        ? true
        : (old.tokens ?? []).map((each) => each.key).join('\u0000') ===
          (unit.tokens ?? []).map((each) => each.key).join('\u0000');
    const names = [...new Set([...Object.keys(old.attrs), ...Object.keys(unit.attrs)])];
    const edited = sameText ? null : diffTokens(old.tokens ?? [], unit.tokens ?? [], meter);
    // Split and joined: a block that kept its key and lost its end, where the next is new and is
    // that end; a block that took in the one after it, which is gone.
    let split: string | null = null;
    let joined: string | null = null;
    if (edited !== null) {
      const following = siblingAfter(afterChildren, unit);
      const gone = siblingAfter(beforeChildren, old);
      if (
        following &&
        !olderOf.has(following.key) &&
        following.type === unit.type &&
        collapse(plain(old.tokens)) === collapse(`${plain(unit.tokens)} ${plain(following.tokens)}`)
      ) {
        split = following.key;
      } else if (
        gone &&
        !partner.has(gone.key) &&
        gone.type === old.type &&
        collapse(plain(unit.tokens)) === collapse(`${plain(old.tokens)} ${plain(gone.tokens)}`)
      ) {
        joined = gone.key;
      }
    }
    changeOf.set(unit.key, {
      change: 'matched',
      older: old.key,
      newer: unit.key,
      type: unit.type,
      parent: unit.parent,
      matched: partner.get(from)!.matched,
      moved: moved.has(unit.key) ? { after: previousSibling.get(unit.key) ?? null } : null,
      edited,
      changed: names.filter((name) => old.attrs[name] !== unit.attrs[name]),
      split,
      joined,
    });
  }

  // One tree of both sides, in reading order: the newer side's units under their parents, and each
  // deletion among its older siblings' places - after the nearest that is still under the same
  // parent, after a deletion before it, or first - with a deleted container's units beneath it.
  const NEW = (key: string) => `n ${key}`;
  const OLD = (key: string) => `o ${key}`;
  const tree = new Map<string, string[]>();
  const childrenAt = (node: string) => {
    let list = tree.get(node);
    if (!list) tree.set(node, (list = []));
    return list;
  };
  for (const unit of after)
    childrenAt(unit.parent === ROOT ? NEW(ROOT) : NEW(unit.parent)).push(NEW(unit.key));
  for (const unit of before) {
    if (partner.has(unit.key)) continue;
    const above =
      unit.parent === ROOT
        ? NEW(ROOT)
        : partner.has(unit.parent)
          ? NEW(partner.get(unit.parent)!.key)
          : OLD(unit.parent);
    const siblings = childrenAt(above);
    let at = 0;
    for (let index = unit.index - 1; index >= 0; index -= 1) {
      const previous = beforeChildren.get(unit.parent)![index]!;
      const here = siblings.indexOf(
        partner.has(previous.key) ? NEW(partner.get(previous.key)!.key) : OLD(previous.key),
      );
      if (here !== -1) {
        at = here + 1;
        break;
      }
    }
    siblings.splice(at, 0, OLD(unit.key));
  }
  const changes: UnitChange[] = [];
  const emit = (node: string) => {
    for (const child of tree.get(node) ?? []) {
      const key = child.slice(2);
      if (child.startsWith('n ')) changes.push(changeOf.get(key)!);
      else {
        const unit = beforeByKey.get(key)!;
        changes.push({ change: 'deleted', older: key, type: unit.type, parent: unit.parent });
      }
      emit(child);
    }
  };
  emit(NEW(ROOT));
  return { changes, similarityBounded };
}
