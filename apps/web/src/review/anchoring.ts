import { unitTexts, type ContentDocument, type ThreadAnchor } from '@alloy-works/domain';
import { BLOCK_ATTRIBUTE } from '@alloy-works/editor';

/**
 * Where a thread can stand in a component's drawn text, and where each stands (collaboration.md,
 * Threads; the TH plan, Task 3). Each drawn block carries its identifier (`BLOCK_ATTRIBUTE`), so a
 * block is found by who it is, never by its words: two blocks may hold the same ones, and an inline
 * node draws text the stored content does not (the TH final review).
 */

/** As the service bounds an anchor (TH-B). */
const QUOTE_MAX = 500;
const BEFORE_MAX = 200;

const BLOCK = `[${BLOCK_ATTRIBUTE}]`;

/** The innermost drawn block holding a node, inside `root`. */
function blockOf(node: Node, root: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  const block = element?.closest<HTMLElement>(BLOCK) ?? null;
  return block !== null && root.contains(block) ? block : null;
}

/** A drawn block by its identifier. */
const drawnBlock = (root: HTMLElement, id: string) =>
  [...root.querySelectorAll<HTMLElement>(BLOCK)].find(
    (each) => each.getAttribute(BLOCK_ATTRIBUTE) === id,
  ) ?? null;

/** The text before a point in a block, as the drawn text holds it. */
function textBefore(block: Element, node: Node, offset: number): string {
  const range = block.ownerDocument.createRange();
  range.setStart(block, 0);
  range.setEnd(node, offset);
  return range.toString();
}

/**
 * The anchor a reader's selection in one component's drawn text proposes, or none: a selection inside
 * one block is a span of it; a caret in a table's cell is the cell, by its first block. Anything else
 * - a caret in running text, a selection across blocks, one outside `root` - proposes nothing.
 */
export function anchorFromSelection(
  selection: Selection,
  root: HTMLElement,
  content: ContentDocument,
): ThreadAnchor | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const units = unitTexts(content);
  if (range.collapsed) {
    const start = range.startContainer;
    const cell = (start instanceof Element ? start : start.parentElement)?.closest('td, th');
    if (!cell || !root.contains(cell)) return null;
    const first = cell.querySelector(BLOCK)?.getAttribute(BLOCK_ATTRIBUTE);
    const unit = first == null ? undefined : units.get(`cell:${first}`);
    return unit && first ? { kind: 'cell', table: unit.parent, block: first } : null;
  }
  const block = blockOf(range.startContainer, root);
  if (block === null || block !== blockOf(range.endContainer, root)) return null;
  const id = block.getAttribute(BLOCK_ATTRIBUTE)!;
  const quote = range.toString();
  if (!units.has(id) || quote.trim().length === 0 || quote.length > QUOTE_MAX) return null;
  const before = textBefore(block, range.startContainer, range.startOffset).slice(-BEFORE_MAX);
  return { kind: 'span', block: id, quote, before };
}

/** Where a thread stands, to be marked. */
export interface Placed {
  readonly thread: string;
  readonly anchor: ThreadAnchor;
}

/**
 * Marks where each thread stands in a component's drawn text: a span's words wrapped in a `mark` in
 * its own block, a cell marked itself, each carrying its thread's identifier. One that no longer
 * stands marks nothing. Whole-component and node threads are marked by the card and the heading.
 */
export function markAnchors(
  root: HTMLElement,
  content: ContentDocument,
  placed: readonly Placed[],
) {
  const units = unitTexts(content);
  for (const { thread, anchor } of placed) {
    if (anchor.kind === 'cell') {
      if (units.get(`cell:${anchor.block}`)?.parent !== anchor.table) continue;
      drawnBlock(root, anchor.block)?.closest('td, th')?.setAttribute('data-thread', thread);
      continue;
    }
    if (anchor.kind !== 'span') continue;
    if (!units.get(anchor.block)?.text.includes(anchor.quote)) continue;
    const element = drawnBlock(root, anchor.block);
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
