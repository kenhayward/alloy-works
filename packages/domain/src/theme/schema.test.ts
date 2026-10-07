import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOGUES,
  DEFAULT_THEME,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_THEME,
  FOURTH_DEFAULT_CATALOGUES,
} from './default.js';
import {
  CATALOGUE_KINDS,
  CATALOGUE_SCHEMA_VERSION,
  PLACES,
  ROLES,
  STYLED_MARKS,
  catalogueSchema,
  catalogueSchema1,
  VALUE_CATALOGUE_KIND,
  catalogueSchema2,
  themeSchema,
  valueFormatsSchema,
} from './schema.js';

/**
 * The two stored shapes, `catalogue/1` and `theme/1` (themes 1, ruling R1). Each is closed at its first
 * version, because a version row is insert-only: whatever this parse accepts, every later reader must go
 * on accepting. So anything outside the property set is refused at the door rather than stored and
 * ignored - a property a theme sets and no renderer honours is a style that silently does nothing.
 */
const clone = <T>(value: T): T => structuredClone(value);

const paragraph = () => clone(FIRST_DEFAULT_CATALOGUES.paragraph);

describe('catalogue/1, frozen as the rows written at it hold it', () => {
  it('has six kinds and no other, and holds each of the default catalogues', () => {
    expect([...CATALOGUE_KINDS]).toEqual([
      'paragraph',
      'character',
      'table',
      'image',
      'admonition',
      'citation',
    ]);
    for (const kind of CATALOGUE_KINDS) {
      expect(() => catalogueSchema1.parse(FIRST_DEFAULT_CATALOGUES[kind]), kind).not.toThrow();
    }
    expect(() => catalogueSchema1.parse({ ...paragraph(), kind: 'list' })).toThrow();
  });

  it("requires a paragraph catalogue's base to state every property, since every chain ends in it", () => {
    const catalogue = paragraph();
    const base: Record<string, unknown> = { ...catalogue.base };
    delete base['widowControl'];
    expect(() => catalogueSchema1.parse({ ...catalogue, base })).toThrow();
  });

  it('requires every style to have an identifier, a name and what it applies to', () => {
    for (const member of ['id', 'name', 'appliesTo']) {
      const catalogue = paragraph();
      const style: Record<string, unknown> = { ...catalogue.styles[0]! };
      delete style[member];
      expect(() => catalogueSchema1.parse({ ...catalogue, styles: [style] }), member).toThrow();
    }
    const catalogue = paragraph();
    const nowhere = { ...catalogue.styles[0]!, appliesTo: [] };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [nowhere] })).toThrow();
  });

  it('lets a paragraph style apply only to places and roles', () => {
    const catalogue = paragraph();
    const style = { ...catalogue.styles[0]!, appliesTo: ['sidebar'] };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [style] })).toThrow();
    const everywhere = { ...catalogue.styles[0]!, appliesTo: [...PLACES, ...ROLES] };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [everywhere] })).not.toThrow();
  });

  it('refuses a property the set does not have', () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const extra of ['letterSpacing', 'smallCaps']) {
      const widened = { ...style, properties: { ...style.properties, [extra]: 1 } };
      expect(() => catalogueSchema1.parse({ ...catalogue, styles: [widened] }), extra).toThrow();
    }
  });

  it('accepts colour only as lower-case six-digit hex, and a background as a colour or none', () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const colour of ['#FFFFFF', 'red', '#fff', 'rgb(0,0,0)']) {
      const coloured = { ...style, properties: { colour } };
      expect(() => catalogueSchema1.parse({ ...catalogue, styles: [coloured] }), colour).toThrow();
    }
    for (const background of ['none', '#f0f0f0']) {
      const filled = { ...style, properties: { background } };
      expect(() => catalogueSchema1.parse({ ...catalogue, styles: [filled] })).not.toThrow();
    }
  });

  it('refuses a style identifier that is not safe verbatim as a class, a key and a Word style id', () => {
    const catalogue = paragraph();
    const renamed = { ...catalogue.styles[0]!, id: 'Body Text' };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [renamed] })).toThrow();
  });

  it('refuses a length below zero or beyond what Word can hold, and a size of nothing', () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const properties of [{ spaceAfter: -1 }, { startIndent: 1585 }, { size: 0 }]) {
      const odd = { ...style, properties };
      expect(() => catalogueSchema1.parse({ ...catalogue, styles: [odd] })).toThrow();
    }
  });

  it('holds a size to 144pt and a line spacing to 288pt, so a line of type can stand on a page', () => {
    // The final review of themes 1, I1: Word's own maxima, 1638pt, let a theme set a word taller than
    // any page a layout declares, and the engine painted it off the page with nothing said.
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const properties of [{ size: 144.01 }, { lineSpacing: 288.01 }, { size: 1638 }]) {
      const odd = { ...style, properties };
      expect(
        () => catalogueSchema1.parse({ ...catalogue, styles: [odd] }),
        JSON.stringify(properties),
      ).toThrow();
    }
    const largest = { ...style, properties: { size: 144, lineSpacing: 288 } };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [largest] })).not.toThrow();
  });

  it("holds a padding only within an indent's bounds", () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const padding of [-1, 1585]) {
      const odd = { ...style, properties: { padding } };
      expect(
        () => catalogueSchema1.parse({ ...catalogue, styles: [odd] }),
        String(padding),
      ).toThrow();
    }
    const padded = { ...style, properties: { padding: 6, background: '#f0f0f0' } };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [padded] })).not.toThrow();
    const base: Record<string, unknown> = { ...catalogue.base };
    delete base['padding'];
    expect(() => catalogueSchema1.parse({ ...catalogue, base })).toThrow();
  });

  it("scales a mark's text only by a fraction from a half to twice the size it stands in", () => {
    const catalogue = clone(FIRST_DEFAULT_CATALOGUES.character);
    for (const scale of [0, 0.49, 2.01, -1]) {
      const odd = { ...catalogue.styles[0]!, properties: { scale } };
      expect(
        () => catalogueSchema1.parse({ ...catalogue, styles: [odd] }),
        String(scale),
      ).toThrow();
    }
    for (const scale of [0.5, 0.8, 2]) {
      const fine = { ...catalogue.styles[0]!, properties: { scale } };
      expect(
        () => catalogueSchema1.parse({ ...catalogue, styles: [fine] }),
        String(scale),
      ).not.toThrow();
    }
  });

  it('holds a character style of a mark a publication carries, stating only appearance', () => {
    const catalogue = clone(FIRST_DEFAULT_CATALOGUES.character);
    expect(catalogue.styles.map((style) => style.mark).sort()).toEqual([...STYLED_MARKS].sort());
    const unknown = { ...catalogue.styles[0]!, mark: 'comment' };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [unknown] })).toThrow();
    const sized = { ...catalogue.styles[0]!, properties: { size: 9 } };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [sized] })).toThrow();
  });

  it('holds table and image styles of an identifier, a name and what they apply to, and nothing else yet', () => {
    const table = clone(FIRST_DEFAULT_CATALOGUES.table);
    const bandedTable = { ...table.styles[0]!, properties: { banded: true } };
    expect(() => catalogueSchema1.parse({ ...table, styles: [bandedTable] })).toThrow();
    const figureTable = { ...table.styles[0]!, appliesTo: ['figure'] };
    expect(() => catalogueSchema1.parse({ ...table, styles: [figureTable] })).toThrow();
    const image = clone(FIRST_DEFAULT_CATALOGUES.image);
    const tableImage = { ...image.styles[0]!, appliesTo: ['table'] };
    expect(() => catalogueSchema1.parse({ ...image, styles: [tableImage] })).toThrow();
  });

  it('keeps admonition and citation catalogues empty until something can be styled by them', () => {
    const style = { id: 'note', name: 'Note', appliesTo: ['admonition'] };
    for (const kind of ['admonition', 'citation'] as const) {
      expect(() =>
        catalogueSchema1.parse({ ...FIRST_DEFAULT_CATALOGUES[kind], styles: [style] }),
      ).toThrow();
    }
  });

  it('refuses a string Postgres cannot store', () => {
    const catalogue = paragraph();
    const nul = { ...catalogue.styles[0]!, name: `Body${String.fromCharCode(0)}` };
    expect(() => catalogueSchema1.parse({ ...catalogue, styles: [nul] })).toThrow();
  });
});

/**
 * A table style at template 12's look, stated whole: the shape `catalogue/2` requires of every table
 * style, and a starting point a test changes one property of.
 */
const tableStyle = () => ({
  id: 'ruled',
  name: 'Ruled',
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
});

/** A figure's image style and an inline image's, at today's rules. */
const figureStyle = () => ({
  id: 'wide',
  name: 'Wide',
  appliesTo: ['figure'],
  fixed: { dimension: 'width', value: 1, unit: 'measure' },
  maximum: { value: 0.6, unit: 'textHeight' },
  placement: 'block',
  alignment: 'centre',
});

const inlineStyle = () => ({
  id: 'in-line',
  name: 'In line',
  appliesTo: ['inlineImage'],
  fixed: { dimension: 'height', value: 1.2, unit: 'em' },
  maximum: { value: 1, unit: 'measure' },
  placement: 'inline',
});

const tables = (...styles: unknown[]) => ({ schemaVersion: 2, kind: 'table', styles });
const images = (...styles: unknown[]) => ({ schemaVersion: 2, kind: 'image', styles });
/** Whether `catalogue/2`'s frozen parse accepts it: the rows 0025 and 0034 wrote are held to it. */
const accepts = (catalogue: unknown) => catalogueSchema2.safeParse(catalogue).success;

describe('catalogue/2, frozen as the rows written at it hold it', () => {
  it("holds the default theme's 0.4 paragraph, table and image catalogues, which 0034 wrote at it", () => {
    for (const kind of ['paragraph', 'table', 'image'] as const) {
      expect(FOURTH_DEFAULT_CATALOGUES[kind].schemaVersion, kind).toBe(2);
      expect(() => catalogueSchema2.parse(FOURTH_DEFAULT_CATALOGUES[kind]), kind).not.toThrow();
    }
    // The other three are the rows 0.1 wrote, at version 1: nothing in them changed.
    for (const kind of ['character', 'admonition', 'citation'] as const) {
      expect(FOURTH_DEFAULT_CATALOGUES[kind], kind).toBe(FIRST_DEFAULT_CATALOGUES[kind]);
    }
  });

  it('reads no catalogue/1 as it stands: the reader upgrades one first', () => {
    for (const kind of CATALOGUE_KINDS) {
      expect(accepts(FIRST_DEFAULT_CATALOGUES[kind]), kind).toBe(false);
    }
  });

  it('adds contextual spacing to the paragraph properties, stated by the base and by any style', () => {
    const catalogue = clone(FOURTH_DEFAULT_CATALOGUES.paragraph);
    expect(catalogue.base.contextualSpacing).toBe(false);
    const base: Record<string, unknown> = { ...catalogue.base };
    delete base['contextualSpacing'];
    expect(accepts({ ...catalogue, base })).toBe(false);
    const style = { ...catalogue.styles[0]!, properties: { contextualSpacing: true } };
    expect(accepts({ ...catalogue, styles: [style] })).toBe(true);
    const odd = { ...catalogue.styles[0]!, properties: { contextualSpacing: 'yes' } };
    expect(accepts({ ...catalogue, styles: [odd] })).toBe(false);
  });

  it('keeps the rest of the paragraph and character properties as version 1 had them', () => {
    const catalogue = clone(FOURTH_DEFAULT_CATALOGUES.paragraph);
    for (const extra of ['letterSpacing', 'smallCaps']) {
      const widened = { ...catalogue.styles[0]!, properties: { [extra]: 1 } };
      expect(accepts({ ...catalogue, styles: [widened] }), extra).toBe(false);
    }
    const character = { ...clone(FOURTH_DEFAULT_CATALOGUES.character), schemaVersion: 2 };
    expect(accepts(character)).toBe(true);
    const sized = { ...character.styles[0]!, properties: { size: 9 } };
    expect(accepts({ ...character, styles: [sized] })).toBe(false);
  });

  it('requires a table style to state every property: its header row and column, banding, rules, padding and breaks', () => {
    expect(accepts(tables(tableStyle()))).toBe(true);
    for (const member of [
      'headerRow',
      'headerColumn',
      'banding',
      'rules',
      'padding',
      'breaks',
    ] as const) {
      const style: Record<string, unknown> = tableStyle();
      delete style[member];
      expect(accepts(tables(style)), member).toBe(false);
    }
    for (const member of ['fill', 'bold', 'rule'] as const) {
      const style = tableStyle();
      const headerRow: Record<string, unknown> = { ...style.headerRow };
      delete headerRow[member];
      expect(accepts(tables({ ...style, headerRow })), member).toBe(false);
    }
    for (const member of ['repeatHeader', 'keepRowsWhole', 'continuationLabel'] as const) {
      const style = tableStyle();
      const breaks: Record<string, unknown> = { ...style.breaks };
      delete breaks[member];
      expect(accepts(tables({ ...style, breaks })), member).toBe(false);
    }
    const extra = { ...tableStyle(), alignment: 'start' };
    expect(accepts(tables(extra))).toBe(false);
    const figure = { ...tableStyle(), appliesTo: ['figure'] };
    expect(accepts(tables(figure))).toBe(false);
  });

  it('fills a header or a band with a colour or none, and bolds a header or not', () => {
    const filled = {
      ...tableStyle(),
      headerRow: { fill: '#dbe4f0', bold: true, rule: { width: 1.5, colour: '#1f3a5f' } },
      headerColumn: { fill: '#eeeeee', bold: true, rule: 'none' },
      banding: { fill: '#f5f5f5' },
    };
    expect(accepts(tables(filled))).toBe(true);
    for (const fill of ['#FFFFFF', 'white', 'transparent']) {
      expect(accepts(tables({ ...tableStyle(), banding: { fill } })), fill).toBe(false);
    }
  });

  it('draws a rule of 0.25 to 12 points in a colour, or none', () => {
    const ruled = (outer: unknown) =>
      tables({ ...tableStyle(), rules: { ...tableStyle().rules, outer } });
    for (const width of [0.25, 12]) {
      expect(accepts(ruled({ width, colour: '#000000' })), String(width)).toBe(true);
    }
    for (const width of [0, 0.24, 12.01, -1]) {
      expect(accepts(ruled({ width, colour: '#000000' })), String(width)).toBe(false);
    }
    expect(accepts(ruled('none'))).toBe(true);
    expect(accepts(ruled({ width: 1 }))).toBe(false);
    expect(accepts(ruled({ width: 1, colour: '#000000', style: 'dashed' }))).toBe(false);
  });

  it("pads a table's cells from 0 to 36 points", () => {
    for (const padding of [0, 36]) {
      expect(accepts(tables({ ...tableStyle(), padding })), String(padding)).toBe(true);
    }
    for (const padding of [-0.01, 36.01]) {
      expect(accepts(tables({ ...tableStyle(), padding })), String(padding)).toBe(false);
    }
  });

  it('requires an image style to state what it fixes, the most the other dimension may be, and its placement', () => {
    expect(accepts(images(figureStyle(), inlineStyle()))).toBe(true);
    for (const member of ['fixed', 'maximum', 'placement'] as const) {
      const style: Record<string, unknown> = figureStyle();
      delete style[member];
      expect(accepts(images(style)), member).toBe(false);
    }
    const fixed = { ...figureStyle(), fixed: { value: 1, unit: 'measure' } };
    expect(accepts(images(fixed))).toBe(false);
    const depth = { ...figureStyle(), fixed: { dimension: 'depth', value: 1, unit: 'measure' } };
    expect(accepts(images(depth))).toBe(false);
    const extra = { ...figureStyle(), wrap: 'around' };
    expect(accepts(images(extra))).toBe(false);
  });

  it('measures an image in points, as a fraction of the measure or of the text block, or in ems', () => {
    const fixing = (value: number, unit: string) =>
      images({ ...figureStyle(), fixed: { dimension: 'width', value, unit } });
    for (const [value, unit] of [
      [144, 'pt'],
      [1584, 'pt'],
      [0.5, 'measure'],
      [1, 'measure'],
      [1, 'textHeight'],
      [1.2, 'em'],
      [4, 'em'],
    ] as const) {
      expect(accepts(fixing(value, unit)), `${value} ${unit}`).toBe(true);
    }
    // Nothing, less, a fraction beyond the whole, and a size no page can hold - past four ems for an
    // image in a line (the final whole-branch review of themes 2, I2).
    for (const [value, unit] of [
      [0, 'pt'],
      [1585, 'pt'],
      [0, 'measure'],
      [1.01, 'measure'],
      [1.01, 'textHeight'],
      [-1, 'em'],
      [4.01, 'em'],
      [1, 'px'],
      [1, 'percent'],
    ] as const) {
      expect(accepts(fixing(value, unit)), `${value} ${unit}`).toBe(false);
    }
    const maximum = { ...figureStyle(), maximum: { value: 0.6, unit: 'textHeight', extra: 1 } };
    expect(accepts(images(maximum))).toBe(false);
  });

  it('aligns a block or a floated image start, centre or end, and an image in its line not at all', () => {
    for (const placement of ['block', 'float']) {
      for (const alignment of ['start', 'centre', 'end']) {
        const style = { ...figureStyle(), placement, alignment };
        expect(accepts(images(style)), `${placement} ${alignment}`).toBe(true);
      }
      const unaligned: Record<string, unknown> = { ...figureStyle(), placement };
      delete unaligned['alignment'];
      expect(accepts(images(unaligned)), placement).toBe(false);
      expect(accepts(images({ ...figureStyle(), placement, alignment: 'left' }))).toBe(false);
    }
    // An image in a line of text stands where its text puts it: an alignment would do nothing.
    expect(accepts(images({ ...inlineStyle(), alignment: 'centre' }))).toBe(false);
    expect(accepts(images({ ...figureStyle(), placement: 'wrapped' }))).toBe(false);
  });

  it("says nothing of where a caption sits: that is catalogue/3's, and a row at 2 stating it is refused", () => {
    expect(accepts(tables({ ...tableStyle(), caption: 'above' }))).toBe(false);
    expect(accepts(images({ ...figureStyle(), caption: 'below' }))).toBe(false);
  });
});

const tables3 = (...styles: unknown[]) => ({ schemaVersion: 3, kind: 'table', styles });
const images3 = (...styles: unknown[]) => ({ schemaVersion: 3, kind: 'image', styles });
const accepts3 = (catalogue: unknown) => catalogueSchema.safeParse(catalogue).success;

describe('catalogue/3', () => {
  it("is the current version, and holds the default theme's table and image catalogues at it", () => {
    expect(CATALOGUE_SCHEMA_VERSION).toBe(3);
    for (const kind of ['table', 'image'] as const) {
      expect(DEFAULT_CATALOGUES[kind].schemaVersion, kind).toBe(3);
      expect(() => catalogueSchema.parse(DEFAULT_CATALOGUES[kind]), kind).not.toThrow();
    }
    // The paragraph catalogue is 0.4's row, at version 2, and the other three 0.1's, at version 1.
    expect(DEFAULT_CATALOGUES.paragraph).toBe(FOURTH_DEFAULT_CATALOGUES.paragraph);
    for (const kind of ['character', 'admonition', 'citation'] as const) {
      expect(DEFAULT_CATALOGUES[kind], kind).toBe(FIRST_DEFAULT_CATALOGUES[kind]);
    }
  });

  it('reads no catalogue/1 or catalogue/2 as it stands: the reader upgrades one first', () => {
    for (const kind of CATALOGUE_KINDS) {
      expect(accepts3(FIRST_DEFAULT_CATALOGUES[kind]), kind).toBe(false);
      expect(accepts3(FOURTH_DEFAULT_CATALOGUES[kind]), kind).toBe(false);
    }
  });

  it('keeps every other property catalogue/2 had, for every kind', () => {
    const paragraph = { ...clone(FOURTH_DEFAULT_CATALOGUES.paragraph), schemaVersion: 3 };
    expect(accepts3(paragraph)).toBe(true);
    expect(accepts3({ ...clone(FIRST_DEFAULT_CATALOGUES.character), schemaVersion: 3 })).toBe(true);
    expect(accepts3(tables3({ ...tableStyle(), caption: 'above' }))).toBe(true);
    expect(accepts3(tables3({ ...tableStyle(), caption: 'above', padding: 37 }))).toBe(false);
    expect(accepts3(images3({ ...figureStyle(), caption: 'below' }, inlineStyle()))).toBe(true);
    expect(accepts3(images3({ ...figureStyle(), caption: 'below', wrap: 'around' }))).toBe(false);
  });

  it('STY-079 requires a table style to declare whether its caption sits above or below the table', () => {
    for (const caption of ['above', 'below']) {
      expect(accepts3(tables3({ ...tableStyle(), caption })), caption).toBe(true);
    }
    expect(accepts3(tables3(tableStyle()))).toBe(false);
    for (const caption of ['top', 'bottom', 'beside', 'none', true]) {
      expect(accepts3(tables3({ ...tableStyle(), caption })), String(caption)).toBe(false);
    }
  });

  it("lets a table style say how a table too wide for its measure is set, optionally, so every stored style reads as it did (TB3-G)", () => {
    for (const wide of ['scale', 'rotate']) {
      expect(accepts3(tables3({ ...tableStyle(), caption: 'above', wide })), wide).toBe(true);
    }
    expect(accepts3(tables3({ ...tableStyle(), caption: 'above' }))).toBe(true);
    for (const wide of ['split', 'none', '', null]) {
      expect(accepts3(tables3({ ...tableStyle(), caption: 'above', wide })), String(wide)).toBe(false);
    }
  });

  it('STY-079 requires an image style placing a figure to declare whether its caption sits above or below it, and one in a line of text, which has no caption, to declare nothing', () => {
    for (const placement of ['block', 'float']) {
      for (const caption of ['above', 'below']) {
        const style = { ...figureStyle(), placement, caption };
        expect(accepts3(images3(style)), `${placement} ${caption}`).toBe(true);
      }
      expect(accepts3(images3({ ...figureStyle(), placement })), placement).toBe(false);
      expect(accepts3(images3({ ...figureStyle(), placement, caption: 'left' }))).toBe(false);
    }
    expect(accepts3(images3(inlineStyle()))).toBe(true);
    expect(accepts3(images3({ ...inlineStyle(), caption: 'below' }))).toBe(false);
  });
});

describe('theme/1', () => {
  it('holds the default theme, and its first version', () => {
    expect(() => themeSchema.parse(DEFAULT_THEME)).not.toThrow();
    expect(() => themeSchema.parse(FIRST_DEFAULT_THEME)).not.toThrow();
  });

  it('names one catalogue of each kind by artifact version, and no other', () => {
    const theme = clone(DEFAULT_THEME);
    const catalogues: Record<string, unknown> = { ...theme.catalogues };
    delete catalogues['citation'];
    expect(() => themeSchema.parse({ ...theme, catalogues })).toThrow();
    const notAVersion = { ...theme.catalogues, table: 'table' };
    expect(() => themeSchema.parse({ ...theme, catalogues: notAVersion })).toThrow();
    const extra = { ...theme.catalogues, footnote: theme.catalogues.paragraph };
    expect(() => themeSchema.parse({ ...theme, catalogues: extra })).toThrow();
  });

  it('names a paragraph style for every place and every role', () => {
    expect(Object.keys(DEFAULT_THEME.places).sort()).toEqual([...PLACES].sort());
    expect(Object.keys(DEFAULT_THEME.roles).sort()).toEqual([...ROLES].sort());
    const theme = clone(DEFAULT_THEME);
    const roles: Record<string, unknown> = { ...theme.roles };
    delete roles['running'];
    expect(() => themeSchema.parse({ ...theme, roles })).toThrow();
  });

  it('refuses a family name that could escape the syntax it is written into', () => {
    const theme = clone(DEFAULT_THEME);
    const evil = { ...theme.typefaces[0]!, family: 'Evil"; } body { color: red' };
    expect(() => themeSchema.parse({ ...theme, typefaces: [evil] })).toThrow();
  });

  it('requires a typeface to carry its vertical metrics, which place its baseline', () => {
    for (const member of ['ascent', 'descent']) {
      const theme = clone(DEFAULT_THEME);
      const face: Record<string, unknown> = { ...theme.typefaces[0]! };
      delete face[member];
      expect(() => themeSchema.parse({ ...theme, typefaces: [face] }), member).toThrow();
    }
  });

  it('requires each file of a typeface to be named by its hash, once for each weight and posture', () => {
    const theme = clone(DEFAULT_THEME);
    const face = theme.typefaces[0]!;
    const shortHash = { ...face, files: [{ ...face.files[0]!, sha256: 'abc' }] };
    expect(() => themeSchema.parse({ ...theme, typefaces: [shortHash] })).toThrow();
    const twice = { ...face, files: [face.files[0]!, { ...face.files[0]! }] };
    expect(() => themeSchema.parse({ ...theme, typefaces: [twice] })).toThrow();
    const none = { ...face, files: [] };
    expect(() => themeSchema.parse({ ...theme, typefaces: [none] })).toThrow();
  });

  it('refuses a licence that is not an SPDX identifier', () => {
    const theme = clone(DEFAULT_THEME);
    const odd = { ...theme.typefaces[0]!, licence: 'free for all <b>' };
    expect(() => themeSchema.parse({ ...theme, typefaces: [odd] })).toThrow();
  });
});

/** A value catalogue's formats, as the default theme's 0.6 states them, built here so a test owns it. */
const formats = () => ({
  number: { decimal: '.', group: ',', groupFrom: 4, minus: 'U+002D' },
  date: { order: 'ymd', separator: '-', pad: true },
  time: { separator: ':' },
  boolean: { true: 'Yes', false: 'No' },
});

const values = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  kind: VALUE_CATALOGUE_KIND,
  formats: formats(),
  byLanguage: [],
  ...over,
});

const acceptsValues = (catalogue: unknown) => catalogueSchema.safeParse(catalogue).success;

/** The formats with one member of one part replaced. */
const formatsWith = (part: string, member: string, value: unknown) => {
  const changed: Record<string, Record<string, unknown>> = formats();
  changed[part] = { ...changed[part], [member]: value };
  return changed;
};

describe('the value catalogue, at catalogue/3 beside the six kinds', () => {
  it('stands beside the six kinds, not as a seventh', () => {
    expect(VALUE_CATALOGUE_KIND).toBe('value');
    expect(CATALOGUE_KINDS).not.toContain(VALUE_CATALOGUE_KIND);
    expect(CATALOGUE_KINDS).toHaveLength(6);
    expect(acceptsValues(values())).toBe(true);
    expect(valueFormatsSchema.safeParse(formats()).success).toBe(true);
  });

  it('is refused at catalogue/1 and catalogue/2, which it never existed at', () => {
    for (const schemaVersion of [1, 2]) {
      const stored = values({ schemaVersion });
      expect(acceptsValues(stored), String(schemaVersion)).toBe(false);
      expect(catalogueSchema1.safeParse(stored).success).toBe(false);
      expect(catalogueSchema2.safeParse(stored).success).toBe(false);
    }
  });

  it('holds each format to its closed set, strict at every level', () => {
    const allowed: Record<string, Record<string, readonly unknown[]>> = {
      number: {
        decimal: ['.', ','],
        group: ['none', ',', '.', "'", 'U+00A0', 'U+202F'],
        groupFrom: [4, 5],
        minus: ['U+002D', 'U+2212'],
      },
      date: { order: ['ymd', 'dmy', 'mdy'], separator: ['-', '/', '.'], pad: [true, false] },
      time: { separator: [':', '.'] },
    };
    for (const [part, members] of Object.entries(allowed)) {
      for (const [member, each] of Object.entries(members)) {
        for (const value of each) {
          // A group that is the decimal is refused below; set the decimal apart from it here.
          const changed = formatsWith(part, member, value);
          if (part === 'number' && member === 'group' && value === '.') {
            changed.number!.decimal = ',';
          }
          if (part === 'number' && member === 'decimal' && value === ',') {
            changed.number!.group = '.';
          }
          // A time separated by the decimal is refused below; set the decimal apart from it here.
          if (part === 'time' && value === '.') {
            changed.number!.decimal = ',';
            changed.number!.group = '.';
          }
          const label = `${part}.${member} ${String(value)}`;
          expect(acceptsValues(values({ formats: changed })), label).toBe(true);
        }
      }
    }
    for (const [part, member, value] of [
      ['number', 'decimal', ' '],
      ['number', 'group', ' '],
      ['number', 'group', String.fromCodePoint(0xa0)],
      ['number', 'groupFrom', 3],
      ['number', 'minus', '-'],
      ['number', 'minus', String.fromCodePoint(0x2212)],
      ['date', 'order', 'ydm'],
      ['date', 'separator', ' '],
      ['date', 'pad', 'yes'],
      ['time', 'separator', 'h'],
      ['number', 'exponent', 'e'],
      ['boolean', 'maybe', 'Perhaps'],
    ] as const) {
      const changed = formatsWith(part, member, value);
      expect(acceptsValues(values({ formats: changed })), `${part}.${member}`).toBe(false);
    }
    expect(acceptsValues(values({ formats: { ...formats(), currency: {} } }))).toBe(false);
    expect(acceptsValues(values({ styles: [] }))).toBe(false);
    const missing: Record<string, unknown> = formats();
    delete missing.time;
    expect(acceptsValues(values({ formats: missing }))).toBe(false);
  });

  it('never groups by the decimal separator', () => {
    for (const mark of ['.', ',']) {
      const changed = formatsWith('number', 'group', mark);
      changed.number!.decimal = mark;
      expect(acceptsValues(values({ formats: changed })), mark).toBe(false);
    }
  });

  it("never separates a time's parts by the decimal separator, which its fraction follows", () => {
    const ambiguous = formatsWith('time', 'separator', '.');
    expect(ambiguous.number!.decimal).toBe('.');
    expect(acceptsValues(values({ formats: ambiguous })), 'formats').toBe(false);
    expect(
      acceptsValues(values({ byLanguage: [{ language: 'de', formats: ambiguous }] })),
      'byLanguage',
    ).toBe(false);
    const commaDecimal = formatsWith('time', 'separator', '.');
    commaDecimal.number = { ...commaDecimal.number, decimal: ',', group: '.' };
    expect(acceptsValues(values({ formats: commaDecimal }))).toBe(true);
    const colonComma = formatsWith('number', 'decimal', ',');
    colonComma.number!.group = '.';
    expect(acceptsValues(values({ formats: colonComma }))).toBe(true);
  });

  it("refuses a boolean's word that cannot be seen, or that looks like the other", () => {
    const words = (yes: string, no: string) =>
      acceptsValues(values({ formats: { ...formats(), boolean: { true: yes, false: no } } }));
    const ZWSP = String.fromCodePoint(0x200b);
    const RLO = String.fromCodePoint(0x202e);
    const SHY = String.fromCodePoint(0xad);
    const HANGUL_FILLER = String.fromCodePoint(0x3164);
    const VS16 = String.fromCodePoint(0xfe0f);
    const CGJ = String.fromCodePoint(0x34f);
    const CHECK = String.fromCodePoint(0x2714);
    // A format character anywhere: invisible, or reordering what follows it.
    expect(words(ZWSP, 'No')).toBe(false);
    expect(words(`Yes${ZWSP}`, 'Yes')).toBe(false);
    expect(words(`${RLO}Yes`, 'No')).toBe(false);
    expect(words(`Ye${SHY}s`, 'No')).toBe(false);
    // No visible character at all.
    expect(words(HANGUL_FILLER, 'No')).toBe(false);
    expect(words(VS16, 'No')).toBe(false);
    // Two words alike once what is never drawn is taken out.
    expect(words(`Yes${VS16}`, 'Yes')).toBe(false);
    expect(words(`Y${CGJ}es`, 'Yes')).toBe(false);
    // A visible character with its presentation selector is a word of its own.
    expect(words(`${CHECK}${VS16}`, 'No')).toBe(true);
  });

  it("holds a boolean's words to 1 to 40 code points, in NFC, with no control, trimmed and different", () => {
    const words = (yes: string, no: string) =>
      acceptsValues(values({ formats: { ...formats(), boolean: { true: yes, false: no } } }));
    const ACUTE = String.fromCodePoint(0x301);
    const SMILE = String.fromCodePoint(0x1f600);
    expect(words('Oui', 'Non')).toBe(true);
    expect(words(SMILE.repeat(40), 'No')).toBe(true);
    expect(words('a'.repeat(41), 'No')).toBe(false);
    expect(words(SMILE.repeat(41), 'No')).toBe(false);
    expect(words('', 'No')).toBe(false);
    expect(words(`Ye${ACUTE}s`, 'No')).toBe(false);
    expect(words(`Yes${String.fromCodePoint(0x7)}`, 'No')).toBe(false);
    expect(words(' Yes', 'No')).toBe(false);
    expect(words('Yes', 'No ')).toBe(false);
    expect(words('Same', 'Same')).toBe(false);
  });

  it('gives formats for at most 32 languages, each a primary subtag once', () => {
    const language = (tag: string) => ({ language: tag, formats: formats() });
    expect(acceptsValues(values({ byLanguage: [language('de'), language('fil')] }))).toBe(true);
    for (const tag of ['DE', 'de-CH', 'd', 'deut', 'd1', '']) {
      expect(acceptsValues(values({ byLanguage: [language(tag)] })), tag).toBe(false);
    }
    expect(acceptsValues(values({ byLanguage: [language('de'), language('de')] }))).toBe(false);
    const many = Array.from({ length: 33 }, (_, at) =>
      language(String.fromCharCode(97 + Math.floor(at / 26), 97 + (at % 26))),
    );
    expect(acceptsValues(values({ byLanguage: many.slice(0, 32) }))).toBe(true);
    expect(acceptsValues(values({ byLanguage: many }))).toBe(false);
    expect(acceptsValues(values({ byLanguage: [{ ...language('de'), note: 'x' }] }))).toBe(false);
    const wrong = { language: 'de', formats: formatsWith('date', 'order', 'x') };
    expect(acceptsValues(values({ byLanguage: [wrong] }))).toBe(false);
  });
});

describe('theme/1 naming a value catalogue', () => {
  it('names one optionally, by artifact version, so a theme before 0.6 still reads', () => {
    const theme = clone(DEFAULT_THEME);
    const six: Record<string, unknown> = { ...theme.catalogues };
    delete six.value;
    expect(themeSchema.safeParse({ ...theme, catalogues: six }).success).toBe(true);
    const named = { ...six, value: '00000000-0000-4000-8000-0000000000aa' };
    expect(themeSchema.safeParse({ ...theme, catalogues: named }).success).toBe(true);
    const notAVersion = { ...six, value: 'value' };
    expect(themeSchema.safeParse({ ...theme, catalogues: notAVersion }).success).toBe(false);
  });
});
