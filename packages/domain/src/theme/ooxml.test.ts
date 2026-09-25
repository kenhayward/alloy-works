import { describe, expect, it } from 'vitest';

import { scanXml, type XmlElementEvent } from '../content/ooxml/xml.js';
import { projectStylesXml } from './ooxml.js';
import { PLACES, ROLES, STYLED_MARKS } from './schema.js';
import { defaultInputs, resolved } from './theme.fixture.js';

/**
 * Word's projection. Every style states every property; `basedOn` is kept so the hierarchy shows
 * in Word's styles pane, but nothing is left for Word to inherit - Word's inheritance rules are
 * not ours (docs/design/themes.md). Read back rather than string-matched, because attribute order
 * is not what a reader of the file cares about and element order is.
 */
const BRITISH = { language: { lang: 'en', region: 'GB' }, direction: 'ltr' } as const;
const xml = projectStylesXml(resolved(), BRITISH);

/** The elements between an element's start and its end, in document order. */
function inside(
  from: string,
  match: (event: XmlElementEvent) => boolean,
  what: string,
): XmlElementEvent[] {
  const events = scanXml(from);
  const start = events.findIndex((e) => e.kind !== 'text' && e.kind !== 'close' && match(e));
  expect(start, what).toBeGreaterThanOrEqual(0);
  const name = (events[start] as XmlElementEvent).name;
  const out: XmlElementEvent[] = [];
  for (const event of events.slice(start + 1)) {
    if (event.kind === 'close' && event.name === name) break;
    if (event.kind === 'open' || event.kind === 'self') out.push(event);
  }
  return out;
}

/** The elements inside one style, in document order. */
function styleElements(id: string, from = xml): XmlElementEvent[] {
  return inside(from, (e) => e.name === 'w:style' && e.attrs['w:styleId'] === id, `style ${id}`);
}

function attrs(id: string, name: string, from = xml): Readonly<Record<string, string>> | undefined {
  return styleElements(id, from).find((e) => e.name === name)?.attrs;
}

/** The names of the elements in a style's `w:pPr` or `w:rPr`, in order. */
function properties(id: string, group: 'w:pPr' | 'w:rPr', from = xml): string[] {
  const names = styleElements(id, from).map((e) => e.name);
  const start = names.indexOf(group);
  if (start < 0) return [];
  const end = group === 'w:pPr' ? names.indexOf('w:rPr') : names.length;
  return names.slice(start + 1, end < 0 ? names.length : end);
}

function defaults(from = xml): XmlElementEvent[] {
  return inside(from, (e) => e.name === 'w:docDefaults', 'the document defaults');
}

/** The paragraph properties Word reads, each one a theme property states (themes.md, "Word"). */
const PARAGRAPH_ELEMENTS = [
  'w:keepNext',
  'w:keepLines',
  'w:widowControl',
  'w:pBdr',
  'w:top',
  'w:left',
  'w:bottom',
  'w:right',
  'w:shd',
  'w:suppressAutoHyphens',
  'w:spacing',
  'w:ind',
  'w:contextualSpacing',
  'w:jc',
  'w:outlineLvl',
];

const RUN_ELEMENTS = ['w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:color', 'w:sz', 'w:szCs'];

describe('projectStylesXml', () => {
  it('states spacing and line spacing in twentieths of a point, line spacing as a minimum (STY-050, STY-051)', () => {
    expect(attrs('heading-1', 'w:spacing')).toEqual({
      'w:before': '207',
      'w:after': '91',
      'w:line': '418',
      'w:lineRule': 'atLeast',
    });
  });

  it('states the run properties of a style explicitly, false included, and every size again for complex scripts', () => {
    expect(attrs('heading-1', 'w:b')).toEqual({ 'w:val': '1' });
    expect(attrs('heading-1', 'w:bCs')).toEqual({ 'w:val': '1' });
    expect(attrs('heading-1', 'w:i')).toEqual({ 'w:val': '0' });
    expect(attrs('heading-1', 'w:iCs')).toEqual({ 'w:val': '0' });
    expect(attrs('heading-1', 'w:sz')).toEqual({ 'w:val': '32' });
    expect(attrs('heading-1', 'w:szCs')).toEqual({ 'w:val': '32' });
    expect(attrs('heading-1', 'w:color')).toEqual({ 'w:val': '000000' });
    expect(attrs('footnote', 'w:sz')).toEqual({ 'w:val': '19' });
    expect(attrs('footnote', 'w:szCs')).toEqual({ 'w:val': '19' });
  });

  it('keeps basedOn for the hierarchy but states what it inherits', () => {
    expect(attrs('heading-2', 'w:basedOn')).toEqual({ 'w:val': 'heading-1' });
    expect(attrs('heading-2', 'w:sz')).toEqual({ 'w:val': '26' });
    expect(attrs('heading-2', 'w:b')).toEqual({ 'w:val': '1' });
    expect(attrs('heading-2', 'w:spacing')).toMatchObject({ 'w:before': '149', 'w:line': '339' });
    expect(attrs('preformatted', 'w:rFonts')).toMatchObject({ 'w:ascii': 'Liberation Mono' });
  });

  it('writes paragraph and run properties in the order the schema requires', () => {
    for (const id of ['body', 'heading-1', 'preformatted', 'quotation']) {
      expect(properties(id, 'w:pPr'), id).toEqual(PARAGRAPH_ELEMENTS);
      expect(properties(id, 'w:rPr'), id).toEqual(RUN_ELEMENTS);
    }
  });

  it('PUB-027 makes every paragraph and character style a Word style under its catalogue identifier, every paragraph property stated', () => {
    const theme = resolved();
    const events = scanXml(xml);
    const styles = events.filter(
      (e): e is XmlElementEvent => e.kind !== 'text' && e.kind !== 'close' && e.name === 'w:style',
    );
    expect(styles.map((e) => [e.attrs['w:type'], e.attrs['w:styleId']])).toEqual([
      ...[...theme.paragraphStyles.keys()].map((id) => ['paragraph', id]),
      ...STYLED_MARKS.map((mark) => ['character', `mark-${mark}`]),
      // And each table style after them (Word 2), below.
      ...[...theme.tableStyles.keys()].map((id) => ['table', `Table-${id}`]),
    ]);
    for (const style of theme.paragraphStyles.values()) {
      expect(attrs(style.id, 'w:name'), style.id).toBeDefined();
      expect(properties(style.id, 'w:pPr'), style.id).toEqual(PARAGRAPH_ELEMENTS);
      expect(properties(style.id, 'w:rPr'), style.id).toEqual(RUN_ELEMENTS);
    }
    // Every place and role reaches a style that is there.
    const ids = new Set(styles.map((e) => e.attrs['w:styleId']));
    for (const target of [
      ...PLACES.map((p) => theme.places[p]),
      ...ROLES.map((r) => theme.roles[r]),
    ]) {
      expect(ids.has(target), target).toBe(true);
    }
  });

  it("uses a typeface's declared Word face where it has one (STY-052)", () => {
    const inputs = defaultInputs();
    inputs.theme.typefaces[0] = {
      ...inputs.theme.typefaces[0]!,
      family: 'Brand Serif',
      wordFamily: 'Liberation Serif',
      embedding: { pdf: true, word: false },
    };
    const withStandIn = projectStylesXml(resolved(inputs), BRITISH);
    expect(withStandIn).toContain('w:ascii="Liberation Serif"');
    expect(withStandIn).not.toContain('Brand Serif');
  });

  it('escapes a style name', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles[0] = {
      ...inputs.catalogues.paragraph.styles[0]!,
      name: 'Terms & conditions',
    };
    expect(projectStylesXml(resolved(inputs), BRITISH)).toContain('w:val="Terms &amp; conditions"');
  });
});

describe('projectStylesXml, the document defaults', () => {
  it("carries the document's language and the text's face and size, the size again for complex scripts", () => {
    const names = defaults().map((e) => e.name);
    expect(names).toEqual(['w:rPrDefault', 'w:rPr', 'w:rFonts', 'w:sz', 'w:szCs', 'w:lang']);
    const found = (name: string) => defaults().find((e) => e.name === name)?.attrs;
    expect(found('w:rFonts')).toEqual({
      'w:ascii': 'Liberation Serif',
      'w:hAnsi': 'Liberation Serif',
      'w:cs': 'Liberation Serif',
      'w:eastAsia': 'Liberation Serif',
    });
    expect(found('w:sz')).toEqual({ 'w:val': '22' });
    expect(found('w:szCs')).toEqual({ 'w:val': '22' });
    expect(found('w:lang')).toEqual({ 'w:val': 'en-GB' });
  });

  it('writes a language without a region as the language alone, and a right-to-left document as the language of its complex script too', () => {
    const lang = (from: string) => defaults(from).find((e) => e.name === 'w:lang')?.attrs;
    const bare = projectStylesXml(resolved(), {
      language: { lang: 'de', region: null },
      direction: 'ltr',
    });
    expect(lang(bare)).toEqual({ 'w:val': 'de' });
    const hebrew = projectStylesXml(resolved(), {
      language: { lang: 'he', region: 'IL' },
      direction: 'rtl',
    });
    expect(lang(hebrew)).toEqual({ 'w:val': 'he-IL', 'w:bidi': 'he-IL' });
  });

  it("names the text's Word face where its typeface declares one", () => {
    const inputs = defaultInputs();
    inputs.theme.typefaces[0] = {
      ...inputs.theme.typefaces[0]!,
      family: 'Brand Serif',
      wordFamily: 'Liberation Serif',
      embedding: { pdf: true, word: false },
    };
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(defaults(from).find((e) => e.name === 'w:rFonts')?.attrs['w:ascii']).toBe(
      'Liberation Serif',
    );
  });
});

describe('projectStylesXml, paragraph properties', () => {
  it('states keep-with-next, keep-together and widow control on and off, never leaving one to a parent', () => {
    expect(attrs('heading-1', 'w:keepNext')).toEqual({});
    expect(attrs('body', 'w:keepNext')).toEqual({ 'w:val': '0' });
    expect(attrs('body', 'w:keepLines')).toEqual({ 'w:val': '0' });
    expect(attrs('body', 'w:widowControl')).toEqual({});

    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'body'
        ? { ...style, properties: { keepTogether: true, widowControl: false } }
        : style,
    );
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('body', 'w:keepLines', from)).toEqual({});
    expect(attrs('body', 'w:widowControl', from)).toEqual({ 'w:val': '0' });
  });

  it('suppresses hyphenation where a style does not hyphenate, and says so where it does', () => {
    expect(attrs('body', 'w:suppressAutoHyphens')).toEqual({});
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.base.hyphenate = true;
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('body', 'w:suppressAutoHyphens', from)).toEqual({ 'w:val': '0' });
  });

  it('states contextual spacing on and off', () => {
    expect(attrs('quotation', 'w:contextualSpacing')).toEqual({});
    expect(attrs('body', 'w:contextualSpacing')).toEqual({ 'w:val': '0' });
  });

  it("aligns start and end to Word's left and right, which Word reads as the leading and trailing edge of a right-to-left paragraph", () => {
    expect(attrs('body', 'w:jc')).toEqual({ 'w:val': 'left' });
    expect(attrs('notice', 'w:jc')).toEqual({ 'w:val': 'right' });
    expect(attrs('caption', 'w:jc')).toEqual({ 'w:val': 'center' });
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.base.alignment = 'justify';
    expect(attrs('body', 'w:jc', projectStylesXml(resolved(inputs), BRITISH))).toEqual({
      'w:val': 'both',
    });
  });

  it('states every indent: the start and end as left and right, which Word also reads by direction, and the first line', () => {
    expect(attrs('body', 'w:ind')).toEqual({ 'w:left': '0', 'w:right': '0', 'w:firstLine': '0' });
    expect(attrs('quotation', 'w:ind')).toEqual({
      'w:left': '220',
      'w:right': '220',
      'w:firstLine': '0',
    });
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.base.firstLineIndent = 14;
    expect(attrs('body', 'w:ind', projectStylesXml(resolved(inputs), BRITISH))).toMatchObject({
      'w:firstLine': '280',
    });
  });

  it('draws a background as a fill padded by borders in its own colour, pulled back into the column by its indents', () => {
    // The default preformatted panel: #f0f0f0, padded 6pt.
    const side = { 'w:val': 'single', 'w:sz': '4', 'w:space': '6', 'w:color': 'F0F0F0' };
    const panel = styleElements('preformatted');
    const bdr = panel.findIndex((e) => e.name === 'w:pBdr');
    expect(panel.slice(bdr + 1, bdr + 5)).toEqual(
      ['w:top', 'w:left', 'w:bottom', 'w:right'].map((name) => ({
        kind: 'self',
        name,
        attrs: side,
      })),
    );
    expect(attrs('preformatted', 'w:shd')).toEqual({
      'w:val': 'clear',
      'w:color': 'auto',
      'w:fill': 'F0F0F0',
    });
    // Measured: Word's fill reaches 2pt past the border's spacing, so the indents are the padding
    // and 2pt more, and the fill stands at the column's edges.
    expect(attrs('preformatted', 'w:ind')).toEqual({
      'w:left': '160',
      'w:right': '160',
      'w:firstLine': '0',
    });

    // Beside an indent of its own, the panel stands at the indent.
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'preformatted'
        ? { ...style, properties: { ...style.properties, startIndent: 10, endIndent: 4 } }
        : style,
    );
    expect(
      attrs('preformatted', 'w:ind', projectStylesXml(resolved(inputs), BRITISH)),
    ).toMatchObject({ 'w:left': '360', 'w:right': '240' });
  });

  it('states no fill and no border where a style has no background, so none is inherited, and pads nothing', () => {
    const body = styleElements('body');
    const bdr = body.findIndex((e) => e.name === 'w:pBdr');
    expect(body.slice(bdr + 1, bdr + 5)).toEqual(
      ['w:top', 'w:left', 'w:bottom', 'w:right'].map((name) => ({
        kind: 'self',
        name,
        attrs: { 'w:val': 'nil' },
      })),
    );
    expect(attrs('body', 'w:shd')).toEqual({ 'w:val': 'nil' });

    // Padding without a fill draws nothing, as in every other output.
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.base.padding = 9;
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('body', 'w:ind', from)).toMatchObject({ 'w:left': '0', 'w:right': '0' });
    expect(attrs('body', 'w:shd', from)).toEqual({ 'w:val': 'nil' });
  });

  it("spaces a padded border by Word's whole points, at most 31", () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'preformatted'
        ? { ...style, properties: { ...style.properties, padding: 40 } }
        : style,
    );
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('preformatted', 'w:top', from)).toMatchObject({ 'w:space': '31' });
  });
});

describe('projectStylesXml, heading names', () => {
  it("names the style each heading role takes Word's own Heading 1 to Heading 6, whatever the catalogue calls it", () => {
    for (let depth = 1; depth <= 6; depth += 1) {
      expect(attrs(`heading-${depth}`, 'w:name'), `heading-${depth}`).toEqual({
        'w:val': `Heading ${depth}`,
      });
    }
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'heading-1' ? { ...style, name: 'Chapter' } : style,
    );
    expect(attrs('heading-1', 'w:name', projectStylesXml(resolved(inputs), BRITISH))).toEqual({
      'w:val': 'Heading 1',
    });
  });

  it("keeps any other style from reading as one of Word's headings, which Word takes by name alone", () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'caption' ? { ...style, name: 'heading 2' } : style,
    );
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('caption', 'w:name', from)).toEqual({ 'w:val': 'heading 2 (caption)' });
    expect(attrs('heading-2', 'w:name', from)).toEqual({ 'w:val': 'Heading 2' });
  });

  it("states every style's outline level: a heading role's its depth, and every other none, since Word hands a heading's down to a style based on it", () => {
    // Measured for the Word slice: without it, Title and Contents heading, based on Heading 1, read
    // as level 1 headings, and a contents field would list them.
    for (let depth = 1; depth <= 6; depth += 1) {
      expect(attrs(`heading-${depth}`, 'w:outlineLvl'), `heading-${depth}`).toEqual({
        'w:val': String(depth - 1),
      });
    }
    for (const id of ['title', 'contents-heading', 'body', 'caption']) {
      expect(attrs(id, 'w:outlineLvl'), id).toEqual({ 'w:val': '9' });
    }
  });

  it('names a style two heading roles share by the shallower', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'heading-5' ? { ...style, appliesTo: ['heading5', 'heading6'] } : style,
    );
    inputs.theme.roles.heading6 = 'heading-5';
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('heading-5', 'w:name', from)).toEqual({ 'w:val': 'Heading 5' });
    // The catalogue's own Heading 6, which no heading role takes now, is kept from reading as one.
    expect(attrs('heading-6', 'w:name', from)).toEqual({ 'w:val': 'Heading 6 (heading-6)' });
  });
});

describe('projectStylesXml, heading numbers (Word 1, ruling R7)', () => {
  const numbered = projectStylesXml(resolved(), BRITISH, { headingList: 1 });
  const numPr = (id: string, from = numbered) => {
    const elements = styleElements(id, from);
    const at = elements.findIndex((each) => each.name === 'w:numPr');
    return at < 0
      ? undefined
      : { ilvl: elements[at + 1]?.attrs['w:val'], numId: elements[at + 2]?.attrs['w:val'] };
  };

  it("links each heading role's style to the list Word numbers headings by, at its depth", () => {
    for (let depth = 1; depth <= 6; depth += 1) {
      expect(numPr(`heading-${depth}`), `heading-${depth}`).toEqual({
        ilvl: String(depth - 1),
        numId: '1',
      });
    }
  });

  it("takes every other style off any list, since Word hands a heading style's number down to a style based on it", () => {
    for (const id of ['title', 'contents-heading', 'body', 'caption']) {
      expect(numPr(id), id).toEqual({ ilvl: '0', numId: '0' });
    }
  });

  it('states the number where the schema puts it, after widow control and before the borders', () => {
    const names = properties('heading-2', 'w:pPr', numbered);
    expect(names.slice(names.indexOf('w:widowControl'), names.indexOf('w:pBdr') + 1)).toEqual([
      'w:widowControl',
      'w:numPr',
      'w:ilvl',
      'w:numId',
      'w:pBdr',
    ]);
  });

  it('links a style two heading roles share at the shallower depth', () => {
    const inputs = defaultInputs();
    inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((style) =>
      style.id === 'heading-5' ? { ...style, appliesTo: ['heading5', 'heading6'] } : style,
    );
    inputs.theme.roles.heading6 = 'heading-5';
    const from = projectStylesXml(resolved(inputs), BRITISH, { headingList: 1 });
    expect(numPr('heading-5', from)).toEqual({ ilvl: '4', numId: '1' });
    expect(numPr('heading-6', from)).toEqual({ ilvl: '0', numId: '0' });
  });

  it("links nothing where it is not asked to, and adds the writer's own styles after the theme's", () => {
    expect(numPr('heading-1', xml)).toBeUndefined();
    const more = '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>';
    const from = projectStylesXml(resolved(), BRITISH, { extraStyles: [more] });
    expect(from).toContain(`${more}</w:styles>`);
  });
});

describe('projectStylesXml, character styles', () => {
  it('writes a character style per mark under its catalogue name, stating only what the mark states', () => {
    expect(properties('mark-strong', 'w:rPr')).toEqual(['w:b', 'w:bCs']);
    expect(attrs('mark-strong', 'w:b')).toEqual({ 'w:val': '1' });
    expect(properties('mark-emphasis', 'w:rPr')).toEqual(['w:i', 'w:iCs']);
    expect(attrs('mark-strong', 'w:name')).toEqual({ 'w:val': 'Strong' });
    expect(attrs('mark-inlineCode', 'w:name')).toEqual({ 'w:val': 'Inline code' });
    for (const mark of ['language', 'hyperlink', 'quotedPhrase']) {
      expect(properties(`mark-${mark}`, 'w:rPr'), mark).toEqual([]);
    }
  });

  it("writes a mark's underline, position and face, the face as Word's where the typeface declares one", () => {
    expect(attrs('mark-underline', 'w:u')).toEqual({ 'w:val': 'single' });
    expect(attrs('mark-subscript', 'w:vertAlign')).toEqual({ 'w:val': 'subscript' });
    expect(attrs('mark-superscript', 'w:vertAlign')).toEqual({ 'w:val': 'superscript' });
    expect(attrs('mark-inlineCode', 'w:rFonts')).toEqual({
      'w:ascii': 'Liberation Mono',
      'w:hAnsi': 'Liberation Mono',
      'w:cs': 'Liberation Mono',
      'w:eastAsia': 'Liberation Mono',
    });
    // A scale is of the text a mark stands in, which a character style cannot know: the run
    // carries it (`wordRun`), and the style states no size.
    expect(properties('mark-inlineCode', 'w:rPr')).toEqual(['w:rFonts']);

    const inputs = defaultInputs();
    inputs.theme.typefaces[1] = {
      ...inputs.theme.typefaces[1]!,
      wordFamily: 'Courier New',
      embedding: { pdf: true, word: false },
    };
    expect(
      attrs('mark-inlineCode', 'w:rFonts', projectStylesXml(resolved(inputs), BRITISH)),
    ).toMatchObject({ 'w:ascii': 'Courier New' });
  });

  it("writes a mark's colour and a stated false, in the order the schema requires", () => {
    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'hyperlink'
        ? {
            ...style,
            properties: {
              typeface: 'mono',
              bold: false,
              italic: true,
              colour: '#1f4e79',
              underline: false,
              position: 'superscript' as const,
            },
          }
        : style,
    );
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(properties('mark-hyperlink', 'w:rPr', from)).toEqual([
      'w:rFonts',
      'w:b',
      'w:bCs',
      'w:i',
      'w:iCs',
      'w:color',
      'w:u',
      'w:vertAlign',
    ]);
    expect(attrs('mark-hyperlink', 'w:b', from)).toEqual({ 'w:val': '0' });
    expect(attrs('mark-hyperlink', 'w:color', from)).toEqual({ 'w:val': '1F4E79' });
    expect(attrs('mark-hyperlink', 'w:u', from)).toEqual({ 'w:val': 'none' });
  });
});

describe('projectStylesXml, table styles (Word 2, ruling R7)', () => {
  /** The elements inside one of a table style's conditions, in document order, or none. */
  const condition = (id: string, type: string, from = xml): XmlElementEvent[] | undefined => {
    const events = scanXml(from);
    const style = events.findIndex(
      (e) =>
        e.kind !== 'text' &&
        e.kind !== 'close' &&
        e.name === 'w:style' &&
        e.attrs['w:styleId'] === id,
    );
    const found: XmlElementEvent[] = [];
    let open = false;
    for (const event of events.slice(style + 1)) {
      if (event.kind === 'close' && event.name === 'w:style') break;
      if (event.kind === 'open' && event.name === 'w:tblStylePr') {
        open = event.attrs['w:type'] === type;
      } else if (event.kind === 'close' && event.name === 'w:tblStylePr') {
        if (open) return found;
      } else if (open && (event.kind === 'open' || event.kind === 'self')) {
        found.push(event);
      }
    }
    return undefined;
  };
  const names = (events: readonly XmlElementEvent[] | undefined) => events?.map((e) => e.name);
  /** A table style's cells' padding, each side's element and its attributes. */
  const padding = (id: string, from = xml) =>
    inside(
      from.slice(from.indexOf(`w:styleId="${id}"`)),
      (e) => e.name === 'w:tblCellMar',
      'the padding',
    ).map((e): [string, Readonly<Record<string, string>>] => [e.name, e.attrs]);
  const rule = (width: number, colour: string) => ({
    'w:val': 'single',
    'w:sz': String(width),
    'w:space': '0',
    'w:color': colour,
  });

  it("writes each table style of the theme as a Word table style under an identifier of the writer's own, named as the catalogue names it", () => {
    const style = scanXml(xml).find(
      (e) => e.kind !== 'text' && e.kind !== 'close' && e.attrs['w:styleId'] === 'Table-table',
    ) as XmlElementEvent;
    expect(style.attrs['w:type']).toBe('table');
    expect(attrs('Table-table', 'w:name')).toEqual({ 'w:val': 'Table' });
    // After the paragraph and character styles, and before the writer's own.
    expect(xml.indexOf('w:styleId="Table-table"')).toBeGreaterThan(xml.indexOf('mark-'));
  });

  it("states the default's rules, padding and banding - every rule 1pt black, cells padded 5pt, bands of one row - and a header neither filled nor bold as not bold, and nothing more", () => {
    expect(names(styleElements('Table-table'))!.slice(0, 11)).toEqual([
      'w:name',
      'w:tblPr',
      'w:tblStyleRowBandSize',
      'w:tblBorders',
      'w:top',
      'w:left',
      'w:bottom',
      'w:right',
      'w:insideH',
      'w:insideV',
      'w:tblCellMar',
    ]);
    expect(attrs('Table-table', 'w:tblStyleRowBandSize')).toEqual({ 'w:val': '1' });
    for (const side of ['w:top', 'w:left', 'w:bottom', 'w:right', 'w:insideH', 'w:insideV']) {
      expect(attrs('Table-table', side), side).toEqual(rule(8, '000000'));
    }
    expect(padding('Table-table')).toEqual(
      ['w:top', 'w:left', 'w:bottom', 'w:right'].map((side) => [
        side,
        { 'w:w': '100', 'w:type': 'dxa' },
      ]),
    );
    // Not bold, stated: measured, a bold cell style's text stays bold under it and a regular one
    // regular. No fill and no rule of its own, and no band.
    for (const type of ['firstRow', 'firstCol']) {
      expect(names(condition('Table-table', type)), type).toEqual(['w:rPr', 'w:b', 'w:bCs']);
      expect(condition('Table-table', type)![1]!.attrs, type).toEqual({ 'w:val': '0' });
    }
    expect(condition('Table-table', 'band1Horz')).toBeUndefined();
  });

  it("states a header row's and a header column's fill, weight and rule, and the band behind every other body row from the first, which Word's band1Horz counts after the header rows (measured)", () => {
    const inputs = defaultInputs();
    inputs.catalogues.table.styles.push({
      id: 'ruled',
      name: 'Ruled',
      appliesTo: ['table'],
      headerRow: { fill: '#d9e2f3', bold: true, rule: { width: 2, colour: '#c00000' } },
      headerColumn: { fill: '#e2efd9', bold: true, rule: { width: 1.5, colour: '#00aa00' } },
      banding: { fill: '#fff2cc' },
      rules: {
        outer: { width: 0.5, colour: '#1f4e79' },
        horizontal: { width: 0.3, colour: '#808080' },
        vertical: 'none',
      },
      padding: 6.2,
      breaks: { repeatHeader: false, keepRowsWhole: true, continuationLabel: false },
    });
    const from = projectStylesXml(resolved(inputs), BRITISH);
    for (const side of ['w:top', 'w:left', 'w:bottom', 'w:right']) {
      expect(attrs('Table-ruled', side, from), side).toEqual(rule(4, '1F4E79'));
    }
    // In eighths of a point, and none where there is none.
    expect(attrs('Table-ruled', 'w:insideH', from)).toEqual(rule(2, '808080'));
    expect(attrs('Table-ruled', 'w:insideV', from)).toEqual({ 'w:val': 'nil' });
    expect(padding('Table-ruled', from).every(([, each]) => each['w:w'] === '124')).toBe(true);

    const firstRow = condition('Table-ruled', 'firstRow', from)!;
    expect(names(firstRow)).toEqual([
      'w:rPr',
      'w:b',
      'w:bCs',
      'w:tcPr',
      'w:tcBorders',
      'w:bottom',
      'w:shd',
    ]);
    expect(firstRow[1]!.attrs).toEqual({ 'w:val': '1' });
    expect(firstRow[5]!.attrs).toEqual(rule(16, 'C00000'));
    expect(firstRow[6]!.attrs).toEqual({ 'w:val': 'clear', 'w:color': 'auto', 'w:fill': 'D9E2F3' });
    const firstCol = condition('Table-ruled', 'firstCol', from)!;
    expect(names(firstCol)).toEqual([
      'w:rPr',
      'w:b',
      'w:bCs',
      'w:tcPr',
      'w:tcBorders',
      'w:right',
      'w:shd',
    ]);
    expect(firstCol[5]!.attrs).toEqual(rule(12, '00AA00'));
    expect(firstCol[6]!.attrs).toMatchObject({ 'w:fill': 'E2EFD9' });
    expect(names(condition('Table-ruled', 'band1Horz', from))).toEqual(['w:tcPr', 'w:shd']);
    expect(condition('Table-ruled', 'band1Horz', from)![1]!.attrs).toMatchObject({
      'w:fill': 'FFF2CC',
    });
    expect(condition('Table-ruled', 'band2Horz', from)).toBeUndefined();
  });

  it('names a table style apart from a paragraph style of the same name, which Word would take for one style', () => {
    const inputs = defaultInputs();
    inputs.catalogues.table.styles[0] = { ...inputs.catalogues.table.styles[0]!, name: 'Caption' };
    const from = projectStylesXml(resolved(inputs), BRITISH);
    expect(attrs('Table-table', 'w:name', from)).toEqual({ 'w:val': 'Caption (table)' });
  });
});
