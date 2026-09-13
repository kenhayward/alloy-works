import { describe, expect, it } from 'vitest';

import { markTypes } from './marks.js';
import { outputMapping } from './mapping.js';

const blockTypes = [
  'paragraph',
  'list',
  'table',
  'figure',
  'preformatted',
  'blockquote',
  'equation',
];
const inlineTypes = [
  'text',
  'equation',
  'footnote',
  'crossReference',
  'citation',
  'variable',
  'binding',
  'image',
];

describe('the output mapping', () => {
  it('ADR-0005 has a row for every block type, so no block exists without a way out', () => {
    for (const type of blockTypes) expect(outputMapping.blocks[type], type).toBeDefined();
    expect(Object.keys(outputMapping.blocks).sort()).toEqual([...blockTypes].sort());
  });

  it('ADR-0005 has a row for every inline type', () => {
    for (const type of inlineTypes) expect(outputMapping.inline[type], type).toBeDefined();
    expect(Object.keys(outputMapping.inline).sort()).toEqual([...inlineTypes].sort());
  });

  it('ADR-0005 has a row for every mark type', () => {
    for (const type of markTypes) expect(outputMapping.marks[type], type).toBeDefined();
    expect(Object.keys(outputMapping.marks).sort()).toEqual([...markTypes].sort());
  });

  it('ADR-0005 admits no blank cell, because a node with no way out is a design finding', () => {
    for (const group of [outputMapping.blocks, outputMapping.inline, outputMapping.marks]) {
      for (const [type, row] of Object.entries(group)) {
        expect(row.ooxml.length, `${type} ooxml`).toBeGreaterThan(0);
        expect(row.tagged.length, `${type} tagged PDF`).toBeGreaterThan(0);
      }
    }
  });
});
