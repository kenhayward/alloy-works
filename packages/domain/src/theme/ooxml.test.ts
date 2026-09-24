import { describe, expect, it } from 'vitest';

import { scanXml, type XmlElementEvent } from '../content/ooxml/xml.js';
import { projectStylesXml } from './ooxml.js';
import { defaultInputs, resolved } from './theme.fixture.js';

/**
 * Word's projection. Every style states every property; `basedOn` is kept so the hierarchy shows
 * in Word's styles pane, but nothing is left for Word to inherit - Word's inheritance rules are
 * not ours (docs/design/themes.md). Read back rather than string-matched, because attribute order
 * is not what a reader of the file cares about and element order is.
 */
const xml = projectStylesXml(resolved());

/** The elements inside one style, in document order. */
function styleElements(id: string, from = xml): XmlElementEvent[] {
  const events = scanXml(from);
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

function attrs(id: string, name: string, from = xml): Readonly<Record<string, string>> | undefined {
  return styleElements(id, from).find((e) => e.name === name)?.attrs;
}

describe('projectStylesXml', () => {
  it('states spacing and line spacing in twentieths of a point, line spacing as a minimum (STY-050, STY-051)', () => {
    expect(attrs('heading-1', 'w:spacing')).toEqual({
      'w:before': '207',
      'w:after': '91',
      'w:line': '418',
      'w:lineRule': 'atLeast',
    });
  });

  it('states the run properties of a style explicitly, false included', () => {
    expect(attrs('heading-1', 'w:b')).toEqual({ 'w:val': '1' });
    expect(attrs('heading-1', 'w:i')).toEqual({ 'w:val': '0' });
    expect(attrs('heading-1', 'w:sz')).toEqual({ 'w:val': '32' });
    expect(attrs('heading-1', 'w:color')).toEqual({ 'w:val': '000000' });
    expect(attrs('heading-1', 'w:keepNext')).toEqual({});
  });

  it('keeps basedOn for the hierarchy but states what it inherits', () => {
    expect(attrs('heading-2', 'w:basedOn')).toEqual({ 'w:val': 'heading-1' });
    expect(attrs('heading-2', 'w:sz')).toEqual({ 'w:val': '26' });
    expect(attrs('heading-2', 'w:b')).toEqual({ 'w:val': '1' });
    expect(attrs('heading-2', 'w:spacing')).toMatchObject({ 'w:before': '149', 'w:line': '339' });
    expect(attrs('preformatted', 'w:rFonts')).toMatchObject({ 'w:ascii': 'Liberation Mono' });
  });

  it('writes paragraph and run properties in the order the schema requires', () => {
    const names = styleElements('heading-1').map((e) => e.name);
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
    const inputs = defaultInputs();
    inputs.theme.typefaces[0] = {
      ...inputs.theme.typefaces[0]!,
      family: 'Brand Serif',
      wordFamily: 'Liberation Serif',
      embedding: { pdf: true, word: false },
    };
    const withStandIn = projectStylesXml(resolved(inputs));
    expect(withStandIn).toContain('w:ascii="Liberation Serif"');
    expect(withStandIn).not.toContain('Brand Serif');
  });

  it('escapes a style name', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles[0] = {
      ...inputs.catalogues.paragraph.styles[0]!,
      name: 'Terms & conditions',
    };
    expect(projectStylesXml(resolved(inputs))).toContain('w:val="Terms &amp; conditions"');
  });

  it('writes a character style per mark under its catalogue name, stating only what it projects of the mark', () => {
    const names = styleElements('mark-strong').map((e) => e.name);
    expect(names).toContain('w:b');
    expect(names).not.toContain('w:i');
    expect(attrs('mark-strong', 'w:name')).toEqual({ 'w:val': 'Strong' });
    expect(attrs('mark-inlineCode', 'w:name')).toEqual({ 'w:val': 'Inline code' });
  });
});
