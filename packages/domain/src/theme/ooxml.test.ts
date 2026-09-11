import { describe, expect, it } from 'vitest';

import { scanXml, type XmlElementEvent } from '../content/ooxml/xml.js';
import { exampleTheme } from './example.js';
import { projectStylesXml } from './ooxml.js';
import { resolveTheme } from './resolve.js';

/**
 * Word's projection. Every style states every property; `basedOn` is kept so the hierarchy shows
 * in Word's styles pane, but nothing is left for Word to inherit - Word's inheritance rules are
 * not ours (docs/design/themes.md). Read back rather than string-matched, because attribute order
 * is not what a reader of the file cares about and element order is.
 */
const xml = projectStylesXml(resolveTheme(exampleTheme()));

/** The elements inside one style, in document order. */
function styleElements(id: string): XmlElementEvent[] {
  const events = scanXml(xml);
  const start = events.findIndex(
    (e) =>
      e.kind !== 'text' &&
      e.kind !== 'close' &&
      e.name === 'w:style' &&
      e.attrs['w:styleId'] === id,
  );
  expect(start, `style ${id}`).toBeGreaterThanOrEqual(0);
  const out: XmlElementEvent[] = [];
  for (const event of events.slice(start + 1)) {
    if (event.kind === 'close' && event.name === 'w:style') break;
    if (event.kind === 'open' || event.kind === 'self') out.push(event);
  }
  return out;
}

function attrs(id: string, name: string): Readonly<Record<string, string>> | undefined {
  return styleElements(id).find((e) => e.name === name)?.attrs;
}

describe('projectStylesXml', () => {
  it('states spacing and line spacing in twentieths of a point, line spacing as a minimum', () => {
    expect(attrs('heading', 'w:spacing')).toEqual({
      'w:before': '240',
      'w:after': '120',
      'w:line': '480',
      'w:lineRule': 'atLeast',
    });
  });

  it('states the run properties of a style explicitly, false included', () => {
    expect(attrs('heading', 'w:b')).toEqual({ 'w:val': '1' });
    expect(attrs('heading', 'w:i')).toEqual({ 'w:val': '0' });
    expect(attrs('heading', 'w:sz')).toEqual({ 'w:val': '36' });
    expect(attrs('heading', 'w:color')).toEqual({ 'w:val': '1A1A1A' });
    expect(attrs('heading', 'w:keepNext')).toEqual({});
  });

  it('keeps basedOn for the hierarchy but states what it inherits', () => {
    expect(attrs('quote', 'w:basedOn')).toEqual({ 'w:val': 'body' });
    expect(attrs('quote', 'w:sz')).toEqual({ 'w:val': '22' });
    expect(attrs('quote', 'w:spacing')).toMatchObject({ 'w:before': '240', 'w:line': '280' });
    expect(attrs('quote', 'w:ind')).toEqual({ 'w:firstLine': '360' });
  });

  it('writes paragraph and run properties in the order the schema requires', () => {
    const names = styleElements('heading').map((e) => e.name);
    const pPr = names.slice(names.indexOf('w:pPr') + 1, names.indexOf('w:rPr'));
    expect(pPr).toEqual(['w:keepNext', 'w:spacing', 'w:ind']);
    expect(names.slice(names.indexOf('w:rPr') + 1)).toEqual([
      'w:rFonts',
      'w:b',
      'w:i',
      'w:color',
      'w:sz',
      'w:szCs',
    ]);
  });

  it("uses a typeface's declared Word face where it has one (STY-052)", () => {
    const theme = exampleTheme();
    theme.typefaces = [{ id: 'serif', family: 'Brand Serif', wordFamily: 'Liberation Serif' }];
    const withStandIn = projectStylesXml(resolveTheme(theme));
    expect(withStandIn).toContain('w:ascii="Liberation Serif"');
    expect(withStandIn).not.toContain('Brand Serif');
  });

  it('escapes a style name', () => {
    const theme = exampleTheme();
    theme.paragraphStyles = [{ id: 'body', name: 'Terms & conditions', properties: {} }];
    expect(projectStylesXml(resolveTheme(theme))).toContain('w:val="Terms &amp; conditions"');
  });

  it('writes a character style per mark, stating only what the mark changes', () => {
    const names = styleElements('mark-strong').map((e) => e.name);
    expect(names).toContain('w:b');
    expect(names).not.toContain('w:i');
  });
});
