import { unitTexts, type ContentDocument, type ThreadAnchor } from '@alloy-works/domain';

/**
 * Where a thread can stand in a component's drawn text, and where each stands (collaboration.md,
 * Threads; the TH plan, Task 3). The drawn text carries no block identifiers, so a block is found by
 * its text, as `unitTexts` - the comparison's and the anchor check's one account of it - gives it: the
 * block whose text holds the words, read with the words before them where two hold the same.
 */

/** The elements that draw a block of text, one per block. */
const BLOCKS = 'p, pre, dt, dd, h1, h2, h3, h4, h5, h6, figcaption, caption';
/** As the service bounds an anchor (TH-B). */
const QUOTE_MAX = 500;
const BEFORE_MAX = 200;

type Units = ReturnType<typeof unitTexts>;

const cellsOf = (units: Units) =>
  [...units].filter(([key]) => key.startsWith('cell:')).map(([key, unit]) => ({ key, unit }));
const blocksOf = (units: Units) =>
  [...units].filter(([key, unit]) => !key.startsWith('cell:') && unit.text.length > 0);

/** The text before a point in a block, as the drawn text holds it. */
function textBefore(block: Element, node: Node, offset: number): string {
  const range = block.ownerDocument.createRange();
  range.setStart(block, 0);
  range.setEnd(node, offset);
  return range.toString();
}

/**
 * The block a drawn block element stands for: the one whose text is its text, or else holds it; where
 * several do, the one in the same place among them.
 */
function blockKeyOf(
  element: Element,
  root: HTMLElement,
  units: Units,
  quote: string,
  before: string,
) {
  const drawn = element.textContent ?? '';
  const holding = blocksOf(units).filter(([, unit]) => unit.text.includes(before + quote));
  const same = holding.filter(([, unit]) => unit.text === drawn);
  const candidates = same.length > 0 ? same : holding;
  if (candidates.length <= 1) return candidates[0]?.[0];
  // Two blocks with one text: the nth such element in the drawn text is the nth such block.
  const elements = [...root.querySelectorAll(BLOCKS)].filter((each) => each.textContent === drawn);
  return candidates[elements.indexOf(element)]?.[0] ?? candidates[0]![0];
}

/**
 * The anchor a reader's selection in one component's drawn text proposes, or none: a selection inside
 * one block is a span of it; a caret in a table's cell is the cell. Anything else - a caret in running
 * text, a selection across blocks, one outside `root` - proposes nothing.
 */
export function anchorFromSelection(
  selection: Selection,
  root: HTMLElement,
  content: ContentDocument,
): ThreadAnchor | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const at = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest(BLOCKS) ?? null;
  const units = unitTexts(content);
  if (range.collapsed) {
    const cell = (
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    )?.closest('td, th');
    if (!cell || !root.contains(cell)) return null;
    const first = cell.querySelector(BLOCKS)?.textContent ?? '';
    const found = cellsOf(units).find(({ key }) => units.get(key.slice(5))?.text === first);
    return found ? { kind: 'cell', table: found.unit.parent, block: found.key.slice(5) } : null;
  }
  const block = at(range.startContainer);
  if (block === null || block !== at(range.endContainer)) return null;
  const quote = range.toString();
  if (quote.trim().length === 0 || quote.length > QUOTE_MAX) return null;
  const before = textBefore(block, range.startContainer, range.startOffset).slice(-BEFORE_MAX);
  const key = blockKeyOf(block, root, units, quote, before);
  return key === undefined ? null : { kind: 'span', block: key, quote, before };
}

/** Where a thread stands, to be marked. */
export interface Placed {
  readonly thread: string;
  readonly anchor: ThreadAnchor;
}

/**
 * Marks where each thread stands in a component's drawn text: a span's words wrapped in a `mark`, a
 * cell marked itself, each carrying its thread's identifier. One that no longer stands marks nothing.
 * Whole-component and node threads are marked by the card and the heading, not here.
 */
export function markAnchors(
  root: HTMLElement,
  content: ContentDocument,
  placed: readonly Placed[],
) {
  const units = unitTexts(content);
  const blocks = [...root.querySelectorAll(BLOCKS)];
  for (const { thread, anchor } of placed) {
    if (anchor.kind === 'cell') {
      const unit = units.get(`cell:${anchor.block}`);
      const first = units.get(anchor.block)?.text;
      if (unit?.parent !== anchor.table || first === undefined) continue;
      const cell = [...root.querySelectorAll('td, th')].find(
        (each) =>
          each.querySelector(BLOCKS)?.textContent === first && !each.hasAttribute('data-thread'),
      );
      cell?.setAttribute('data-thread', thread);
      continue;
    }
    if (anchor.kind !== 'span') continue;
    const unit = units.get(anchor.block);
    if (!unit?.text.includes(anchor.quote)) continue;
    // The block's own element: the nth with its text, where it is the nth block holding that text.
    const same = blocksOf(units).filter(([, each]) => each.text === unit.text);
    const elements = blocks.filter((each) => each.textContent === unit.text);
    const element = elements[same.findIndex(([key]) => key === anchor.block)] ?? elements[0];
    if (!element) continue;
    const drawn = element.textContent ?? '';
    const held = drawn.indexOf(anchor.before + anchor.quote);
    const start = held >= 0 ? held + anchor.before.length : drawn.indexOf(anchor.quote);
    if (start < 0) continue;
    wrap(element, start, start + anchor.quote.length, thread);
  }
}

/** Wraps the characters from `start` to `end` of an element's text in marks, text node by text node. */
function wrap(element: Element, start: number, end: number, thread: string) {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; from: number; to: number }[] = [];
  let seen = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.data.length;
    const from = Math.max(start - seen, 0);
    const to = Math.min(end - seen, length);
    if (from < to) pieces.push({ node, from, to });
    seen += length;
  }
  for (const { node, from, to } of pieces) {
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const mark = document.createElement('mark');
    mark.setAttribute('data-thread', thread);
    range.surroundContents(mark);
  }
}
