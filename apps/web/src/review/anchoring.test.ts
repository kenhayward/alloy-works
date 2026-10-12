import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import { renderContent } from '@alloy-works/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { anchorFromSelection, markAnchors } from './anchoring.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(value)],
});
const content: ContentDocument = {
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    para('p1', 'Set the tray, then wait.'),
    para('p2', 'Set the tray again.'),
    {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Doses')],
      headerRows: 0,
      headerColumns: 0,
      rows: [
        {
          cells: [
            { content: [para('c1', 'Five')], colspan: 1, rowspan: 1 },
            { content: [para('c2', 'Ten')], colspan: 1, rowspan: 1 },
          ],
        },
      ],
    },
  ],
};

/** The content drawn as the document's text draws it, in the page. */
function drawn(): HTMLElement {
  const host = document.createElement('div');
  host.append(renderContent(content, document)!);
  document.body.append(host);
  return host;
}

/** Selects `length` characters of the text node holding `holding`, from `offset`. */
function select(host: HTMLElement, holding: string, offset: number, length: number): Selection {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let found: Node | null = null;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent === holding) found = walker.currentNode;
  }
  const range = document.createRange();
  range.setStart(found!, offset);
  range.setEnd(found!, offset + length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('a thread’s anchor, from what the reader selected', () => {
  it('COL-012 anchors a selection to its block, the text it quotes and the text before it', () => {
    const host = drawn();
    expect(anchorFromSelection(select(host, 'Set the tray again.', 4, 8), host, content)).toEqual({
      kind: 'span',
      block: 'p2',
      quote: 'the tray',
      before: 'Set ',
    });
  });

  it('COL-012 anchors a caret in a table’s cell to the cell, by its table and first block', () => {
    const host = drawn();
    expect(anchorFromSelection(select(host, 'Ten', 1, 0), host, content)).toEqual({
      kind: 'cell',
      table: 't1',
      block: 'c2',
    });
  });

  it('offers no anchor for a caret outside a cell, or a selection across blocks', () => {
    const host = drawn();
    expect(anchorFromSelection(select(host, 'Set the tray, then wait.', 2, 0), host, content)).toBe(
      null,
    );
    const range = document.createRange();
    const [first, second] = host.querySelectorAll('p');
    range.setStart(first!.firstChild!, 0);
    range.setEnd(second!.firstChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(anchorFromSelection(selection, host, content)).toBe(null);
  });

  it('marks where each thread stands in the drawn text: a span’s words and a cell', () => {
    const host = drawn();
    markAnchors(host, content, [
      { thread: 'a', anchor: { kind: 'span', block: 'p2', quote: 'the tray', before: 'Set ' } },
      { thread: 'b', anchor: { kind: 'cell', table: 't1', block: 'c1' } },
      // An anchor that no longer stands marks nothing.
      { thread: 'c', anchor: { kind: 'span', block: 'p1', quote: 'the lid', before: '' } },
    ]);
    const marks = [...host.querySelectorAll('[data-thread]')];
    expect(
      marks.map((each) => [each.tagName, each.getAttribute('data-thread'), each.textContent]),
    ).toEqual([
      ['MARK', 'a', 'the tray'],
      ['TD', 'b', 'Five'],
    ]);
    // In the second block, where its text before it says, not the first holding the same words.
    expect(marks[0]!.closest('p')!.textContent).toBe('Set the tray again.');
  });
});
