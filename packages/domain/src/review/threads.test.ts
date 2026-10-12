import { describe, expect, it } from 'vitest';

import type { BlockNode, ContentDocument } from '../content/model/index.js';
import { OUTLINE_SCHEMA_VERSION, type OutlineDocument } from '../structure/outline.js';
import { anchorStands, commentPartsSchema, mentionsIn, threadAnchorSchema } from './threads.js';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(value)],
});
const docOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});
const table: BlockNode = {
  type: 'table',
  id: 't1',
  style: 'table',
  caption: [text('Doses')],
  headerRows: 0,
  headerColumns: 0,
  rows: [{ cells: [{ content: [para('c1', 'Five')], colspan: 1, rowspan: 1 }] }],
};
const outline: OutlineDocument = {
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'Report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    {
      type: 'section',
      id: 's'.repeat(26),
      title: [text('Method')],
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    },
  ],
};
const MENTIONED = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('a thread’s anchor and its text', () => {
  it('COL-012 COL-016 stands on a span while its block holds the quoted text, wherever the text around it moved', () => {
    const anchor = { kind: 'span' as const, block: 'p1', quote: 'the tray', before: 'Set ' };
    expect(anchorStands(anchor, { content: docOf(para('p1', 'Set the tray, then wait.')) })).toBe(
      true,
    );
    expect(
      anchorStands(anchor, {
        content: docOf(para('p0', 'First, check.'), para('p1', 'Now set the tray.')),
      }),
    ).toBe(true);
    // COL-017: the text gone, or the block gone, and it no longer stands.
    expect(anchorStands(anchor, { content: docOf(para('p1', 'Set the lid.')) })).toBe(false);
    expect(anchorStands(anchor, { content: docOf(para('p2', 'Set the tray.')) })).toBe(false);
  });

  it('COL-012 stands on a table’s cell by its first block, a whole component, and an outline node', () => {
    expect(
      anchorStands({ kind: 'cell', table: 't1', block: 'c1' }, { content: docOf(table) }),
    ).toBe(true);
    expect(
      anchorStands({ kind: 'cell', table: 't9', block: 'c1' }, { content: docOf(table) }),
    ).toBe(false);
    expect(anchorStands({ kind: 'component' }, { content: docOf() })).toBe(true);
    expect(anchorStands({ kind: 'node', node: 's'.repeat(26) }, { outline })).toBe(true);
    expect(anchorStands({ kind: 'node', node: 'x'.repeat(26) }, { outline })).toBe(false);
  });

  it('holds an anchor’s quote to 500 characters and its context to 200', () => {
    expect(
      threadAnchorSchema.safeParse({
        kind: 'span',
        block: 'p1',
        quote: 'a'.repeat(501),
        before: '',
      }).success,
    ).toBe(false);
    expect(
      threadAnchorSchema.safeParse({
        kind: 'span',
        block: 'p1',
        quote: 'tray',
        before: 'b'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('holds a comment to words and mentions: 1 to 4,000 characters, at most 20 mentions', () => {
    const parts = [{ text: 'Is this right, ' }, { mention: MENTIONED }, { text: '?' }];
    expect(commentPartsSchema.parse(parts)).toEqual(parts);
    expect(mentionsIn(parts)).toEqual([MENTIONED]);
    expect(commentPartsSchema.safeParse([]).success).toBe(false);
    expect(commentPartsSchema.safeParse([{ text: 'a'.repeat(4001) }]).success).toBe(false);
    expect(
      commentPartsSchema.safeParse(Array.from({ length: 21 }, () => ({ mention: MENTIONED })))
        .success,
    ).toBe(false);
  });
});
