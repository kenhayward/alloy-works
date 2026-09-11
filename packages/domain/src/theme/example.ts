import type { Theme } from './schema.js';

/**
 * A small theme exercising what the prototype tests: a body style that is all defaults, a heading
 * that overrides size, weight, line spacing and keep-with-next, and a quote that inherits from body
 * and changes spacing on both sides - so that body followed by quote puts 6pt after against 12pt
 * before, and the rule for combining them shows.
 *
 * Used by the unit tests and by spikes/theme-conformance, so both measure the same theme.
 */
export function exampleTheme(): Theme {
  return {
    id: 'example',
    paper: '#ffffff',
    // Liberation Serif's hhea metrics: 1825 and 443 units in a 2048-unit em.
    typefaces: [{ id: 'serif', family: 'Liberation Serif', ascent: 0.891, descent: 0.216 }],
    defaults: {
      typeface: 'serif',
      size: 11,
      bold: false,
      italic: false,
      colour: '#1a1a1a',
      firstLineIndent: 0,
      spaceBefore: 0,
      spaceAfter: 6,
      lineSpacing: 14,
      keepWithNext: false,
    },
    paragraphStyles: [
      { id: 'body', name: 'Body', properties: {} },
      {
        id: 'heading',
        name: 'Heading',
        properties: { size: 18, bold: true, lineSpacing: 24, spaceBefore: 12, keepWithNext: true },
      },
      {
        id: 'quote',
        name: 'Quote',
        basedOn: 'body',
        properties: {
          italic: true,
          colour: '#444444',
          firstLineIndent: 18,
          spaceBefore: 12,
          spaceAfter: 12,
        },
      },
    ],
    characterStyles: [
      { mark: 'strong', bold: true },
      { mark: 'emphasis', italic: true },
    ],
  };
}
