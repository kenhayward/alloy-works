import { describe, expect, it } from 'vitest';

import { exampleTheme } from './example.js';
import { resolveTheme } from './resolve.js';
import { projectTypst } from './typst.js';

/**
 * The PDF's projection: data for the fixed Typst template (ADR-0013), never Typst source. Numbers
 * are points; the template decides nothing but how to lay the values out.
 */
const typst = projectTypst(resolveTheme(exampleTheme()));

describe('projectTypst', () => {
  it('states every property of a style at its resolved value', () => {
    expect(typst.styles['heading']).toEqual({
      font: 'Liberation Serif',
      size: 18,
      weight: 'bold',
      style: 'normal',
      fill: '#1a1a1a',
      firstLineIndent: 0,
      spaceBefore: 12,
      spaceAfter: 6,
      lineSpacing: 24,
      keepWithNext: true,
      descent: 0.216,
      leading: 6,
    });
  });

  it('carries inherited values, so the template never walks a chain', () => {
    expect(typst.styles['quote']).toMatchObject({ size: 11, lineSpacing: 14, style: 'italic' });
  });

  it('renders a mark by what its character style states, and only that', () => {
    expect(typst.marks).toEqual({ strong: { weight: 'bold' }, emphasis: { style: 'italic' } });
  });

  it('is plain data: it survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(typst))).toEqual(typst);
    expect(typst.paper).toBe('#ffffff');
  });
});
