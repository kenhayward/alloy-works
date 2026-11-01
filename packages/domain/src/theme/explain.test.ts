import { describe, expect, it } from 'vitest';

import { DEFAULT_CATALOGUES } from './default.js';
import { explainStyle } from './explain.js';
import { resolved } from './theme.fixture.js';

/**
 * Where a style's values come from (SY-E): each property's resolved value and the style that states
 * it, or the catalogue's base, walked by the reader's own chain so the two cannot disagree.
 */
const paragraphs = DEFAULT_CATALOGUES.paragraph;
type Paragraphs = typeof paragraphs;

describe('explainStyle', () => {
  it('STY-057 takes each property from the nearest ancestor that states it, and names that ancestor', () => {
    const outcome = explainStyle(paragraphs, 'heading-4');
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusals));
    // heading-4 states nothing; heading-3 states its size, heading-1 its weight, the base its face.
    expect(outcome.properties.size).toEqual({ value: 11, from: 'heading-3' });
    expect(outcome.properties.bold).toEqual({ value: true, from: 'heading-1' });
    expect(outcome.properties.typeface).toEqual({
      value: paragraphs.base.typeface,
      from: null,
    });
  });

  it('STY-057 gives every property the value the reader resolves, for every style of the default theme', () => {
    const theme = resolved();
    for (const style of paragraphs.styles) {
      const outcome = explainStyle(paragraphs, style.id);
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusals));
      const values = Object.fromEntries(
        Object.entries(outcome.properties).map(([key, { value }]) => [key, value]),
      );
      expect(values).toEqual(theme.paragraphStyles.get(style.id)!.properties);
    }
  });

  it('STY-056 refuses a style whose chain is a cycle, naming it, rather than walking forever', () => {
    const looped: Paragraphs = {
      ...paragraphs,
      styles: paragraphs.styles.map((style) =>
        style.id === 'body' ? { ...style, basedOn: 'heading-1' } : style,
      ),
    };
    const outcome = explainStyle(looped, 'heading-2');
    expect(outcome).toMatchObject({ ok: false, refusals: [{ code: 'style_cycle' }] });
  });

  it('refuses a style the catalogue does not contain, and one whose parent it does not contain', () => {
    expect(explainStyle(paragraphs, 'nowhere')).toMatchObject({
      ok: false,
      refusals: [{ code: 'style_missing' }],
    });
    const orphaned: Paragraphs = {
      ...paragraphs,
      styles: paragraphs.styles.map((style) =>
        style.id === 'heading-1' ? { ...style, basedOn: 'gone' } : style,
      ),
    };
    expect(explainStyle(orphaned, 'heading-4')).toMatchObject({
      ok: false,
      refusals: [{ code: 'style_parent_missing' }],
    });
  });
});
