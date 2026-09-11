import { describe, expect, it } from 'vitest';

import { exampleTheme } from './example.js';
import { ThemeError, resolveStyle, resolveTheme } from './resolve.js';
import type { Theme } from './schema.js';

/**
 * The resolver is the only place style rules live (STY-035). Everything it hands on is concrete,
 * so a projection has nothing left to decide - and so nothing it could decide differently.
 */
function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ThemeError ? error.code : `not a ThemeError: ${String(error)}`;
  }
  return undefined;
}

function withStyles(styles: Theme['paragraphStyles']): Theme {
  return { ...exampleTheme(), paragraphStyles: styles };
}

describe('resolveTheme', () => {
  it('resolves a style that states nothing to the defaults', () => {
    const theme = resolveTheme(exampleTheme());
    expect(resolveStyle(theme, 'body').properties).toEqual(exampleTheme().defaults);
  });

  it('lets a style override what it states and keeps the defaults for the rest', () => {
    const heading = resolveStyle(resolveTheme(exampleTheme()), 'heading').properties;
    expect(heading).toMatchObject({ size: 18, bold: true, lineSpacing: 24, spaceBefore: 12 });
    expect(heading).toMatchObject({ keepWithNext: true, colour: '#1a1a1a', spaceAfter: 6 });
  });

  it('inherits through basedOn, and remembers the parent for projections that show hierarchy', () => {
    const quote = resolveStyle(resolveTheme(exampleTheme()), 'quote');
    expect(quote.basedOn).toBe('body');
    expect(quote.properties).toEqual({
      ...exampleTheme().defaults,
      italic: true,
      colour: '#444444',
      firstLineIndent: 18,
      spaceBefore: 12,
      spaceAfter: 12,
    });
  });

  it('names a parent the theme does not contain', () => {
    const orphan = { id: 'orphan', name: 'Orphan', basedOn: 'missing', properties: {} };
    expect(code(() => resolveTheme(withStyles([orphan])))).toBe('unknown-parent');
  });

  it('refuses an inheritance cycle rather than walking it for ever', () => {
    const a = { id: 'a', name: 'A', basedOn: 'b', properties: {} };
    const b = { id: 'b', name: 'B', basedOn: 'a', properties: {} };
    expect(code(() => resolveTheme(withStyles([a, b])))).toBe('cycle');
    const self = { id: 'self', name: 'Self', basedOn: 'self', properties: {} };
    expect(code(() => resolveTheme(withStyles([self])))).toBe('cycle');
  });

  it('refuses two styles with one identifier', () => {
    const body = { id: 'body', name: 'Body', properties: {} };
    expect(code(() => resolveTheme(withStyles([body, body])))).toBe('duplicate-style');
  });

  it('refuses a typeface the theme does not declare', () => {
    const odd = { id: 'odd', name: 'Odd', properties: { typeface: 'sans' } };
    expect(code(() => resolveTheme(withStyles([odd])))).toBe('unknown-typeface');
  });

  it('fails on a style the theme does not contain rather than substituting one (STY-027)', () => {
    expect(code(() => resolveStyle(resolveTheme(exampleTheme()), 'missing'))).toBe('unknown-style');
  });

  it('is a pure function of its input (STY-038)', () => {
    const input = exampleTheme();
    const snapshot = structuredClone(input);
    expect(resolveTheme(input)).toEqual(resolveTheme(input));
    expect(input).toEqual(snapshot);
  });
});
