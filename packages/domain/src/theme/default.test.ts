import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME,
  DEFAULT_THEME_VERSION,
  DEFAULT_VALUE_FORMATS,
  FIFTH_DEFAULT_CATALOGUES,
  FIFTH_DEFAULT_CATALOGUES_BY_VERSION,
  FIFTH_DEFAULT_CATALOGUE_VERSIONS,
  FIFTH_DEFAULT_THEME,
  FIFTH_DEFAULT_THEME_VERSION,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_CATALOGUES_BY_VERSION,
  FIRST_DEFAULT_CATALOGUE_VERSIONS,
  FIRST_DEFAULT_THEME,
  FOURTH_DEFAULT_CATALOGUES,
  FOURTH_DEFAULT_CATALOGUES_BY_VERSION,
  FOURTH_DEFAULT_CATALOGUE_VERSIONS,
  FOURTH_DEFAULT_THEME,
  FOURTH_DEFAULT_THEME_VERSION,
  SECOND_DEFAULT_CATALOGUES,
  SECOND_DEFAULT_CATALOGUES_BY_VERSION,
  SECOND_DEFAULT_CATALOGUE_VERSIONS,
  SECOND_DEFAULT_THEME,
  SECOND_DEFAULT_THEME_VERSION,
  THIRD_DEFAULT_THEME,
  THIRD_DEFAULT_THEME_VERSION,
} from './default.js';
import { readTheme, type ResolvedTheme } from './read.js';
import { CATALOGUE_KINDS } from './schema.js';

/**
 * The product's default theme as data (themes 1, ruling R3). Its numbers are template 11's wherever
 * template 11 wrote one, so a publication set from it moves only by what the line rules change; the
 * values template 11 left to the engine are marked in `default.ts` and measured by the worker's test.
 */
const paragraph = (id: string) => {
  const style = DEFAULT_CATALOGUES.paragraph.styles.find((each) => each.id === id);
  expect(style, id).toBeDefined();
  return style!;
};

const face = (id: string) => {
  const found = DEFAULT_THEME.typefaces.find((each) => each.id === id);
  expect(found, id).toBeDefined();
  return found!;
};

describe('the default theme', () => {
  it('names each of its six catalogues, and its value catalogue, by the version the store seeds', () => {
    for (const kind of [...CATALOGUE_KINDS, 'value'] as const) {
      expect(DEFAULT_THEME.catalogues[kind], kind).toBe(DEFAULT_CATALOGUE_VERSIONS[kind]);
      expect(DEFAULT_CATALOGUES[kind].kind).toBe(kind);
    }
    expect(new Set(Object.values(DEFAULT_CATALOGUE_VERSIONS)).size).toBe(7);
  });

  it("sets its text at template 11's sizes", () => {
    expect(DEFAULT_CATALOGUES.paragraph.base).toMatchObject({ size: 11, bold: false });
    expect(paragraph('heading-1').properties).toMatchObject({ size: 16, bold: true });
    // Bold from the first heading, which it is based on.
    expect(paragraph('heading-2')).toMatchObject({
      basedOn: 'heading-1',
      properties: { size: 13 },
    });
    expect(paragraph('preformatted').properties).toMatchObject({
      typeface: 'mono',
      size: 8.8,
      background: '#f0f0f0',
      // Template 11's panel, `inset: 6pt`.
      padding: 6,
    });
    expect(DEFAULT_CATALOGUES.paragraph.base).toMatchObject({ padding: 0 });
    // Template 11 set inline code in the body's text at 0.8em.
    expect(
      DEFAULT_CATALOGUES.character.styles.find((style) => style.mark === 'inlineCode')?.properties,
    ).toEqual({ typeface: 'mono', scale: 0.8 });
    expect(paragraph('preformatted-label').properties).toMatchObject({ size: 8 });
    expect(paragraph('table-note').properties).toMatchObject({ size: 10 });
    expect(paragraph('notice').properties).toMatchObject({ size: 9, alignment: 'end' });
    expect(paragraph('running').properties).toMatchObject({ size: 9 });
  });

  it('sets the body at every place but the footnote, the quotation and the table cell, which have their own', () => {
    expect(DEFAULT_THEME.places).toEqual({
      text: 'body',
      listItem: 'body',
      quotation: 'quotation',
      tableCell: 'table-cell',
      footnote: 'footnote',
    });
    // A cell's text centred, as template 11's were: a figure centred what it held, the table among it.
    expect(paragraph('table-cell')).toMatchObject({
      basedOn: 'body',
      appliesTo: ['tableCell'],
      properties: { alignment: 'centre' },
    });
    expect(paragraph('body').appliesTo).toEqual(['text', 'listItem']);
  });

  it('holds the three pinned families, each under the SIL Open Font Licence, the text faces embeddable in both outputs and the maths face in a PDF only, set in Cambria Math in Word', () => {
    expect(DEFAULT_THEME.typefaces.map((each) => each.family)).toEqual([
      'Liberation Serif',
      'Liberation Mono',
      'STIX Two Math',
    ]);
    for (const each of DEFAULT_THEME.typefaces) {
      expect(each.licence, each.id).toBe('OFL-1.1');
    }
    expect(face('serif').embedding).toEqual({ pdf: true, word: true });
    expect(face('mono').embedding).toEqual({ pdf: true, word: true });
    expect(face('serif').wordFamily).toBeUndefined();
    expect(face('mono').wordFamily).toBeUndefined();
    // Measured (M10): STIX Two Math's outlines are CFF, which Word does not embed - embedded, Word
    // sets its equations in Calibri - so a Word document sets them in Cambria Math, which Word and
    // Office carry.
    expect(face('maths').embedding).toEqual({ pdf: true, word: false });
    expect(face('maths').wordFamily).toBe('Cambria Math');
    expect(face('serif').files).toHaveLength(4);
    expect(face('mono').files).toHaveLength(4);
    expect(face('maths').files).toEqual([
      {
        sha256: '3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c',
        weight: 'regular',
        posture: 'normal',
      },
    ]);
    expect(DEFAULT_THEME.maths).toBe('maths');
  });

  it("records each face's metrics from its own tables, and the monospaced face's advance", () => {
    // hhea ascender and descender over unitsPerEm, read from the pinned files; the worker's test holds
    // these to the files.
    expect(face('serif')).toMatchObject({ ascent: 1825 / 2048, descent: 443 / 2048 });
    expect(face('mono')).toMatchObject({
      ascent: 1705 / 2048,
      descent: 615 / 2048,
      advance: 1229 / 2048,
    });
    expect(face('maths')).toMatchObject({ ascent: 0.762, descent: 0.238 });
    expect(face('serif').advance).toBeUndefined();
  });

  it("states template 12's look for its table style `table`: ruled 1pt black inside and out, padded 5pt, the header repeated and nothing else", () => {
    // Themes 2, ruling R3. No continuation label: measured in the design, one leaves an empty header
    // cell in the structure tree on a table's first page, which is a cost a theme should choose.
    expect(DEFAULT_CATALOGUES.table).toMatchObject({ schemaVersion: 3, kind: 'table' });
    expect(DEFAULT_CATALOGUES.table.styles.filter((each) => each.id === 'table')).toEqual([
      {
        id: 'table',
        name: 'Table',
        appliesTo: ['table'],
        headerRow: { fill: 'none', bold: false, rule: 'none' },
        headerColumn: { fill: 'none', bold: false, rule: 'none' },
        banding: { fill: 'none' },
        rules: {
          outer: { width: 1, colour: '#000000' },
          horizontal: { width: 1, colour: '#000000' },
          vertical: { width: 1, colour: '#000000' },
        },
        padding: 5,
        breaks: { repeatHeader: true, keepRowsWhole: false, continuationLabel: false },
        caption: 'above',
      },
    ]);
  });

  it("states today's image rules: a figure the measure wide at most 60 per cent of the text block high, centred; an inline image 1.2 ems high at most the measure wide", () => {
    expect(DEFAULT_CATALOGUES.image).toMatchObject({ schemaVersion: 3, kind: 'image' });
    expect(
      DEFAULT_CATALOGUES.image.styles.filter((each) => ['figure', 'inline'].includes(each.id)),
    ).toEqual([
      {
        id: 'figure',
        name: 'Figure',
        appliesTo: ['figure'],
        fixed: { dimension: 'width', value: 1, unit: 'measure' },
        maximum: { value: 0.6, unit: 'textHeight' },
        placement: 'block',
        alignment: 'centre',
        caption: 'below',
      },
      {
        id: 'inline',
        name: 'Inline image',
        appliesTo: ['inlineImage'],
        fixed: { dimension: 'height', value: 1.2, unit: 'em' },
        maximum: { value: 1, unit: 'measure' },
        placement: 'inline',
      },
    ]);
  });

  it('keeps its admonition and citation catalogues empty', () => {
    expect(DEFAULT_CATALOGUES.admonition.styles).toEqual([]);
    expect(DEFAULT_CATALOGUES.citation.styles).toEqual([]);
  });

  it("changes only the quotation's and its attribution's spacing at 0.2, and states contextual spacing, off, in the base", () => {
    const changed = new Set(['quotation', 'attribution']);
    expect(SECOND_DEFAULT_CATALOGUES.paragraph.base).toEqual({
      ...FIRST_DEFAULT_CATALOGUES.paragraph.base,
      contextualSpacing: false,
    });
    expect(
      SECOND_DEFAULT_CATALOGUES.paragraph.styles.filter((each) => !changed.has(each.id)),
    ).toEqual(FIRST_DEFAULT_CATALOGUES.paragraph.styles.filter((each) => !changed.has(each.id)));
    expect(paragraph('quotation').properties).toEqual({
      startIndent: 11,
      endIndent: 11,
      spaceBefore: 16.5,
      spaceAfter: 12.65,
      contextualSpacing: true,
    });
    expect(paragraph('attribution').properties).toEqual({
      alignment: 'end',
      spaceBefore: 6.6,
      spaceAfter: 12.65,
    });
  });

  /**
   * The distance from one paragraph's last baseline to the next's first, by template 12's rule
   * (ADR-0014, STY-050): the first's space after, the second's space before, and the second's line
   * spacing, a line being one em tall and the rest of its line spacing the gap above it. With contextual
   * spacing (themes 2, ruling R1), two paragraphs of one style that both ask for it add neither space.
   */
  const distance = (theme: ResolvedTheme, from: string, to: string): number => {
    const above = theme.paragraphStyles.get(from)!.properties;
    const below = theme.paragraphStyles.get(to)!.properties;
    const contextual = from === to && above.contextualSpacing && below.contextualSpacing;
    const spaces = contextual ? 0 : above.spaceAfter + below.spaceBefore;
    return Number((spaces + below.lineSpacing).toFixed(2));
  };

  it("gives a quotation back template 11's set-off, its own paragraphs a line apart", () => {
    // Template 11's distances, measured by themes 1 and again for a quotation with no attribution:
    // 33.6pt from text into a quotation and from a quotation into its attribution, 27.0pt from the
    // attribution, or from a quotation without one, into the text after it. Template 12 set every one
    // at 17.1pt.
    const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
    if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
    const theme = read.theme;
    expect(distance(theme, 'body', 'quotation')).toBe(33.6);
    expect(distance(theme, 'quotation', 'attribution')).toBe(33.6);
    expect(distance(theme, 'attribution', 'body')).toBe(27);
    expect(distance(theme, 'quotation', 'body')).toBe(27);
    // The one distance that moves (ruling R3): a quotation's own paragraphs stand a line apart, where
    // template 11 put them 17.1pt apart, 2.75pt further.
    expect(distance(theme, 'quotation', 'quotation')).toBe(14.35);
    // And two paragraphs of the body, which asks for none, stand as they did.
    expect(distance(theme, 'body', 'body')).toBe(17.1);
  });
});

describe("the default theme's version 0.6", () => {
  it('binds the value catalogue at its 0.1 by a fixed identifier, beside the six 0.5 binds', () => {
    expect(DEFAULT_CATALOGUE_VERSIONS).toEqual({
      ...FIFTH_DEFAULT_CATALOGUE_VERSIONS,
      value: '949bad3b-b80b-428d-8746-e34045212429',
    });
    expect(Object.keys(FIFTH_DEFAULT_CATALOGUE_VERSIONS)).toEqual([...CATALOGUE_KINDS]);
    const earlier = [
      ...Object.values(FIRST_DEFAULT_CATALOGUE_VERSIONS),
      ...Object.values(SECOND_DEFAULT_CATALOGUE_VERSIONS),
      ...Object.values(FOURTH_DEFAULT_CATALOGUE_VERSIONS),
      ...Object.values(FIFTH_DEFAULT_CATALOGUE_VERSIONS),
      SECOND_DEFAULT_THEME_VERSION,
      THIRD_DEFAULT_THEME_VERSION,
      FOURTH_DEFAULT_THEME_VERSION,
      FIFTH_DEFAULT_THEME_VERSION,
    ];
    expect(earlier).not.toContain(DEFAULT_CATALOGUE_VERSIONS.value);
    for (const kind of CATALOGUE_KINDS) {
      expect(DEFAULT_CATALOGUES[kind], kind).toBe(FIFTH_DEFAULT_CATALOGUES[kind]);
    }
    expect([...DEFAULT_CATALOGUES_BY_VERSION.keys()].sort()).toEqual(
      Object.values(DEFAULT_CATALOGUE_VERSIONS).sort(),
    );
  });

  it('is its 0.5 naming the value catalogue too, with nothing else changed, under a fixed identifier of its own', () => {
    expect(DEFAULT_THEME).toEqual({
      ...FIFTH_DEFAULT_THEME,
      catalogues: DEFAULT_CATALOGUE_VERSIONS,
    });
    expect(DEFAULT_THEME_VERSION).toBe('a4d8f4c0-0b17-46d4-9fd5-84bb784eb163');
    expect([
      SECOND_DEFAULT_THEME_VERSION,
      THIRD_DEFAULT_THEME_VERSION,
      FOURTH_DEFAULT_THEME_VERSION,
      FIFTH_DEFAULT_THEME_VERSION,
      ...Object.values(DEFAULT_CATALOGUE_VERSIONS),
    ]).not.toContain(DEFAULT_THEME_VERSION);
  });

  it("states bindings.md's default formats: a full stop and commas from four digits, the hyphen-minus, ISO 8601's dates, a colon, and Yes and No", () => {
    expect(DEFAULT_VALUE_FORMATS).toEqual({
      number: { decimal: '.', group: ',', groupFrom: 4, minus: 'U+002D' },
      date: { order: 'ymd', separator: '-', pad: true },
      time: { separator: ':' },
      boolean: { true: 'Yes', false: 'No' },
    });
    expect(DEFAULT_CATALOGUES.value).toEqual({
      schemaVersion: 3,
      kind: 'value',
      formats: DEFAULT_VALUE_FORMATS,
      byLanguage: [],
    });
  });

  it('reads as its 0.5 does, style for style, with its value catalogue beside', () => {
    const now = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
    const before = readTheme(FIFTH_DEFAULT_THEME, FIFTH_DEFAULT_CATALOGUES_BY_VERSION);
    if (!now.ok || !before.ok) throw new Error('The default theme does not read');
    expect({ ...now.theme, valueCatalogue: null }).toEqual(before.theme);
    expect(now.theme.valueCatalogue).toEqual(DEFAULT_CATALOGUES.value);
  });
});

describe("the default theme's version 0.5, as migration 0043 stored it", () => {
  it('binds new versions of its table and image catalogues, each by a fixed identifier, and the other four as 0.4 did', () => {
    expect(FIFTH_DEFAULT_CATALOGUE_VERSIONS).toEqual({
      ...FOURTH_DEFAULT_CATALOGUE_VERSIONS,
      table: 'b5fd3598-cc54-4c58-a546-8b33d795aa15',
      image: 'fda41d97-12ba-4581-b066-060d060c86a0',
    });
    const earlier = [
      ...Object.values(FIRST_DEFAULT_CATALOGUE_VERSIONS),
      ...Object.values(SECOND_DEFAULT_CATALOGUE_VERSIONS),
      ...Object.values(FOURTH_DEFAULT_CATALOGUE_VERSIONS),
      SECOND_DEFAULT_THEME_VERSION,
      THIRD_DEFAULT_THEME_VERSION,
      FOURTH_DEFAULT_THEME_VERSION,
    ];
    for (const kind of ['table', 'image'] as const) {
      expect(earlier, kind).not.toContain(FIFTH_DEFAULT_CATALOGUE_VERSIONS[kind]);
      expect(FIFTH_DEFAULT_CATALOGUES[kind].schemaVersion, kind).toBe(3);
    }
    for (const kind of ['paragraph', 'character', 'admonition', 'citation'] as const) {
      expect(FIFTH_DEFAULT_CATALOGUES[kind], kind).toBe(FOURTH_DEFAULT_CATALOGUES[kind]);
    }
    expect([...FIFTH_DEFAULT_CATALOGUES_BY_VERSION.keys()].sort()).toEqual(
      Object.values(FIFTH_DEFAULT_CATALOGUE_VERSIONS).sort(),
    );
  });

  it('is its 0.4 naming those catalogue versions, with nothing else changed, under a fixed identifier of its own', () => {
    expect(FIFTH_DEFAULT_THEME).toEqual({
      ...FOURTH_DEFAULT_THEME,
      catalogues: FIFTH_DEFAULT_CATALOGUE_VERSIONS,
    });
    expect(FIFTH_DEFAULT_THEME_VERSION).toBe('072142c4-8d63-42d6-815a-a447abd0a647');
    expect([
      SECOND_DEFAULT_THEME_VERSION,
      THIRD_DEFAULT_THEME_VERSION,
      FOURTH_DEFAULT_THEME_VERSION,
      ...Object.values(FIFTH_DEFAULT_CATALOGUE_VERSIONS),
    ]).not.toContain(FIFTH_DEFAULT_THEME_VERSION);
  });

  it("keeps every style 0.4's table and image catalogues held, each saying where its caption sits where 0.4 set it: a table's above it, a figure's below it", () => {
    expect(FIFTH_DEFAULT_CATALOGUES.table).toEqual({
      ...FOURTH_DEFAULT_CATALOGUES.table,
      schemaVersion: 3,
      styles: FOURTH_DEFAULT_CATALOGUES.table.styles.map((style) => ({
        ...style,
        caption: 'above',
      })),
    });
    expect(FIFTH_DEFAULT_CATALOGUES.image).toEqual({
      ...FOURTH_DEFAULT_CATALOGUES.image,
      schemaVersion: 3,
      styles: FOURTH_DEFAULT_CATALOGUES.image.styles.map((style) =>
        style.placement === 'inline' ? style : { ...style, caption: 'below' },
      ),
    });
  });

  it('reads as its 0.4 does, style for style, so a publication made under either is set alike', () => {
    const now = readTheme(FIFTH_DEFAULT_THEME, FIFTH_DEFAULT_CATALOGUES_BY_VERSION);
    const before = readTheme(FOURTH_DEFAULT_THEME, FOURTH_DEFAULT_CATALOGUES_BY_VERSION);
    if (!now.ok || !before.ok) throw new Error('The default theme does not read');
    expect({ ...now.theme, catalogues: null }).toEqual({ ...before.theme, catalogues: null });
    expect(now.theme.catalogues).toEqual(FIFTH_DEFAULT_CATALOGUE_VERSIONS);
  });
});

describe("the default theme's version 0.4, as migration 0034 stored it", () => {
  const style = <T extends { id: string }>(styles: readonly T[], id: string) => {
    const found = styles.find((each) => each.id === id);
    expect(found, id).toBeDefined();
    return found!;
  };

  it('binds new versions of its paragraph, table and image catalogues, each by a fixed identifier, and the other three as 0.1 did', () => {
    expect(FOURTH_DEFAULT_CATALOGUE_VERSIONS).toEqual({
      paragraph: 'd056b809-2dfa-4283-b99c-6fbc37cc7c84',
      character: FIRST_DEFAULT_CATALOGUE_VERSIONS.character,
      table: 'd1d81250-e486-4e06-b7e5-ebb68fe97e97',
      image: '4d03fc94-ecd8-44c5-ba24-740ca7d79f59',
      admonition: FIRST_DEFAULT_CATALOGUE_VERSIONS.admonition,
      citation: FIRST_DEFAULT_CATALOGUE_VERSIONS.citation,
    });
    const earlier = [
      ...Object.values(FIRST_DEFAULT_CATALOGUE_VERSIONS),
      ...Object.values(SECOND_DEFAULT_CATALOGUE_VERSIONS),
      SECOND_DEFAULT_THEME_VERSION,
      THIRD_DEFAULT_THEME_VERSION,
    ];
    for (const kind of ['paragraph', 'table', 'image'] as const) {
      expect(earlier, kind).not.toContain(FOURTH_DEFAULT_CATALOGUE_VERSIONS[kind]);
      expect(FOURTH_DEFAULT_CATALOGUES[kind].schemaVersion, kind).toBe(2);
    }
    for (const kind of ['character', 'admonition', 'citation'] as const) {
      expect(FOURTH_DEFAULT_CATALOGUES[kind], kind).toBe(FIRST_DEFAULT_CATALOGUES[kind]);
    }
    expect([...FOURTH_DEFAULT_CATALOGUES_BY_VERSION.keys()].sort()).toEqual(
      Object.values(FOURTH_DEFAULT_CATALOGUE_VERSIONS).sort(),
    );
  });

  it('is its 0.3 naming those catalogue versions, with nothing else changed, under a fixed identifier of its own', () => {
    expect(FOURTH_DEFAULT_THEME).toEqual({
      ...THIRD_DEFAULT_THEME,
      catalogues: FOURTH_DEFAULT_CATALOGUE_VERSIONS,
    });
    expect(FOURTH_DEFAULT_THEME_VERSION).toBe('80a7869a-6ceb-43b2-b748-81e3e4fee2dd');
    expect([
      SECOND_DEFAULT_THEME_VERSION,
      THIRD_DEFAULT_THEME_VERSION,
      ...Object.values(FOURTH_DEFAULT_CATALOGUE_VERSIONS),
    ]).not.toContain(FOURTH_DEFAULT_THEME_VERSION);
  });

  it("keeps every style 0.3's catalogues held, and adds Lead, Centred and Small print for running text, Banded for a table and Half width for a figure", () => {
    expect(FOURTH_DEFAULT_CATALOGUES.paragraph).toEqual({
      ...SECOND_DEFAULT_CATALOGUES.paragraph,
      styles: [
        ...SECOND_DEFAULT_CATALOGUES.paragraph.styles,
        {
          id: 'lead',
          name: 'Lead',
          basedOn: 'body',
          appliesTo: ['text'],
          properties: { size: 13, spaceAfter: 6, lineSpacing: 16.96 },
        },
        {
          id: 'centred',
          name: 'Centred',
          basedOn: 'body',
          appliesTo: ['text', 'listItem'],
          properties: { alignment: 'centre' },
        },
        {
          id: 'small-print',
          name: 'Small print',
          basedOn: 'body',
          appliesTo: ['text', 'listItem'],
          properties: { size: 9, spaceAfter: 2.25, lineSpacing: 11.74 },
        },
      ],
    });
    expect(FOURTH_DEFAULT_CATALOGUES.table).toEqual({
      ...SECOND_DEFAULT_CATALOGUES.table,
      styles: [
        ...SECOND_DEFAULT_CATALOGUES.table.styles,
        {
          id: 'banded',
          name: 'Banded',
          appliesTo: ['table'],
          headerRow: { fill: '#d9d9d9', bold: true, rule: { width: 1, colour: '#000000' } },
          headerColumn: { fill: 'none', bold: false, rule: 'none' },
          banding: { fill: '#f2f2f2' },
          rules: {
            outer: { width: 1, colour: '#000000' },
            horizontal: { width: 0.5, colour: '#808080' },
            vertical: 'none',
          },
          padding: 5,
          breaks: { repeatHeader: true, keepRowsWhole: false, continuationLabel: false },
        },
      ],
    });
    expect(FOURTH_DEFAULT_CATALOGUES.image).toEqual({
      ...SECOND_DEFAULT_CATALOGUES.image,
      styles: [
        ...SECOND_DEFAULT_CATALOGUES.image.styles,
        {
          id: 'half-width',
          name: 'Half width',
          appliesTo: ['figure'],
          fixed: { dimension: 'width', value: 0.5, unit: 'measure' },
          maximum: { value: 0.6, unit: 'textHeight' },
          placement: 'block',
          alignment: 'centre',
        },
      ],
    });
  });

  it('reads, each new paragraph style resolved over the body it is based on, and none set at a place or a role', () => {
    const read = readTheme(FOURTH_DEFAULT_THEME, FOURTH_DEFAULT_CATALOGUES_BY_VERSION);
    if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('; '));
    const resolved = (id: string) => read.theme.paragraphStyles.get(id)!.properties;
    expect(resolved('lead')).toEqual({
      ...resolved('body'),
      size: 13,
      lineSpacing: 16.96,
      spaceAfter: 6,
    });
    expect(resolved('centred')).toEqual({ ...resolved('body'), alignment: 'centre' });
    expect(resolved('small-print')).toEqual({
      ...resolved('body'),
      size: 9,
      lineSpacing: 11.74,
      spaceAfter: 2.25,
    });
    expect(style(FOURTH_DEFAULT_CATALOGUES.table.styles, 'banded').name).toBe('Banded');
    expect(style(FOURTH_DEFAULT_CATALOGUES.image.styles, 'half-width').name).toBe('Half width');
    // No place and no role is set in any of them: they are there to be chosen.
    const bound = [
      ...Object.values(FOURTH_DEFAULT_THEME.places),
      ...Object.values(FOURTH_DEFAULT_THEME.roles),
    ];
    for (const id of ['lead', 'centred', 'small-print']) expect(bound, id).not.toContain(id);
  });
});

describe("the default theme's version 0.3, as migration 0026 stored it", () => {
  it("is its 0.2 with the maths face's Word face declared, nothing else changed, under a fixed identifier of its own", () => {
    const [serif, mono, maths] = SECOND_DEFAULT_THEME.typefaces;
    expect(THIRD_DEFAULT_THEME).toEqual({
      ...SECOND_DEFAULT_THEME,
      typefaces: [
        serif,
        mono,
        { ...maths, embedding: { pdf: true, word: false }, wordFamily: 'Cambria Math' },
      ],
    });
    expect(THIRD_DEFAULT_THEME.catalogues).toEqual(SECOND_DEFAULT_CATALOGUE_VERSIONS);
    expect(THIRD_DEFAULT_THEME_VERSION).toBe('3c00d89a-547f-468e-94a3-8a4b82ab05d3');
    expect([
      SECOND_DEFAULT_THEME_VERSION,
      ...Object.values(SECOND_DEFAULT_CATALOGUE_VERSIONS),
    ]).not.toContain(THIRD_DEFAULT_THEME_VERSION);
  });

  it('still reads, as the theme a publication made under it was set from', () => {
    expect(readTheme(THIRD_DEFAULT_THEME, SECOND_DEFAULT_CATALOGUES_BY_VERSION).ok).toBe(true);
  });
});

describe("the default theme's version 0.2, as migration 0025 stored it", () => {
  it('binds new versions of its paragraph, table and image catalogues, each by a fixed identifier, and the other three as 0.1 did', () => {
    for (const kind of ['paragraph', 'table', 'image'] as const) {
      expect(SECOND_DEFAULT_CATALOGUE_VERSIONS[kind], kind).not.toBe(
        FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
      );
    }
    for (const kind of ['character', 'admonition', 'citation'] as const) {
      expect(SECOND_DEFAULT_CATALOGUE_VERSIONS[kind], kind).toBe(
        FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
      );
    }
    expect(SECOND_DEFAULT_CATALOGUE_VERSIONS).toEqual({
      paragraph: '16b4cdba-64f4-48f4-b1cf-20c9983118aa',
      character: FIRST_DEFAULT_CATALOGUE_VERSIONS.character,
      table: 'ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc',
      image: 'f6a95219-0c03-4cc5-a6c1-db552f45a550',
      admonition: FIRST_DEFAULT_CATALOGUE_VERSIONS.admonition,
      citation: FIRST_DEFAULT_CATALOGUE_VERSIONS.citation,
    });
    expect([...SECOND_DEFAULT_CATALOGUES_BY_VERSION.keys()].sort()).toEqual(
      Object.values(SECOND_DEFAULT_CATALOGUE_VERSIONS).sort(),
    );
  });

  it('is its 0.1 naming those catalogue versions, with nothing else changed, under a fixed identifier of its own', () => {
    expect(SECOND_DEFAULT_THEME).toEqual({
      ...FIRST_DEFAULT_THEME,
      catalogues: SECOND_DEFAULT_CATALOGUE_VERSIONS,
    });
    expect(SECOND_DEFAULT_THEME_VERSION).toBe('29c4ade2-741b-48fa-bc45-94c06257bd75');
    expect([...Object.values(SECOND_DEFAULT_CATALOGUE_VERSIONS)]).not.toContain(
      SECOND_DEFAULT_THEME_VERSION,
    );
    // Its maths face as 0025 stored it: embeddable in Word, with no Word face.
    expect(SECOND_DEFAULT_THEME.typefaces.map((each) => each.embedding)).toEqual([
      { pdf: true, word: true },
      { pdf: true, word: true },
      { pdf: true, word: true },
    ]);
  });

  it('still reads, as the theme a publication made under it was set from', () => {
    expect(readTheme(SECOND_DEFAULT_THEME, SECOND_DEFAULT_CATALOGUES_BY_VERSION).ok).toBe(true);
  });
});

describe("the default theme's version 0.1, as migration 0024 stored it", () => {
  it('names its six catalogues by the versions 0024 seeded, each at catalogue/1', () => {
    expect(FIRST_DEFAULT_CATALOGUE_VERSIONS).toEqual({
      paragraph: 'ea96cd55-858a-4041-b5f7-9a91b8e6b9b5',
      character: '04b5f4de-0264-49b4-9d64-f64af70b0cfe',
      table: '29dc6b2e-b37a-47a7-9416-7d02feca8922',
      image: 'e92731c6-c7da-440d-8106-355f66a8a837',
      admonition: '9d239242-93b6-4e7f-b5e2-7a030a159d65',
      citation: '4fa1d4bb-f13a-4be0-ab88-50bcafd9e754',
    });
    expect(FIRST_DEFAULT_THEME.catalogues).toEqual(FIRST_DEFAULT_CATALOGUE_VERSIONS);
    for (const kind of CATALOGUE_KINDS) {
      expect(FIRST_DEFAULT_CATALOGUES[kind].schemaVersion, kind).toBe(1);
      expect(FIRST_DEFAULT_CATALOGUES_BY_VERSION.get(FIRST_DEFAULT_CATALOGUE_VERSIONS[kind])).toBe(
        FIRST_DEFAULT_CATALOGUES[kind],
      );
    }
  });

  it('holds the table and image identifiers content carries, with no properties, and the quotation with no set-off', () => {
    expect(FIRST_DEFAULT_CATALOGUES.table.styles).toEqual([
      { id: 'table', name: 'Table', appliesTo: ['table'] },
    ]);
    expect(FIRST_DEFAULT_CATALOGUES.image.styles).toEqual([
      { id: 'figure', name: 'Figure', appliesTo: ['figure'] },
      { id: 'inline', name: 'Inline image', appliesTo: ['inlineImage'] },
    ]);
    expect(
      FIRST_DEFAULT_CATALOGUES.paragraph.styles.find((each) => each.id === 'quotation')!.properties,
    ).toEqual({ startIndent: 11, endIndent: 11 });
    expect(FIRST_DEFAULT_CATALOGUES.paragraph.base).not.toHaveProperty('contextualSpacing');
  });

  it('still reads, upgraded, as the theme a publication made under it was set from', () => {
    const read = readTheme(FIRST_DEFAULT_THEME, FIRST_DEFAULT_CATALOGUES_BY_VERSION);
    expect(read.ok).toBe(true);
  });
});
