import { describe, expect, it } from 'vitest';

import { DEFAULT_CATALOGUES, DEFAULT_THEME } from './default.js';
import {
  CATALOGUE_KINDS,
  PLACES,
  ROLES,
  STYLED_MARKS,
  catalogueSchema,
  themeSchema,
} from './schema.js';

/**
 * The two stored shapes, `catalogue/1` and `theme/1` (themes 1, ruling R1). Each is closed at its first
 * version, because a version row is insert-only: whatever this parse accepts, every later reader must go
 * on accepting. So anything outside the property set is refused at the door rather than stored and
 * ignored - a property a theme sets and no renderer honours is a style that silently does nothing.
 */
const clone = <T>(value: T): T => structuredClone(value);

const paragraph = () => clone(DEFAULT_CATALOGUES.paragraph);

describe('catalogue/1', () => {
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
      expect(() => catalogueSchema.parse(DEFAULT_CATALOGUES[kind]), kind).not.toThrow();
    }
    expect(() => catalogueSchema.parse({ ...paragraph(), kind: 'list' })).toThrow();
  });

  it("requires a paragraph catalogue's base to state every property, since every chain ends in it", () => {
    const catalogue = paragraph();
    const base: Record<string, unknown> = { ...catalogue.base };
    delete base['widowControl'];
    expect(() => catalogueSchema.parse({ ...catalogue, base })).toThrow();
  });

  it('requires every style to have an identifier, a name and what it applies to', () => {
    for (const member of ['id', 'name', 'appliesTo']) {
      const catalogue = paragraph();
      const style: Record<string, unknown> = { ...catalogue.styles[0]! };
      delete style[member];
      expect(() => catalogueSchema.parse({ ...catalogue, styles: [style] }), member).toThrow();
    }
    const catalogue = paragraph();
    const nowhere = { ...catalogue.styles[0]!, appliesTo: [] };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [nowhere] })).toThrow();
  });

  it('lets a paragraph style apply only to places and roles', () => {
    const catalogue = paragraph();
    const style = { ...catalogue.styles[0]!, appliesTo: ['sidebar'] };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [style] })).toThrow();
    const everywhere = { ...catalogue.styles[0]!, appliesTo: [...PLACES, ...ROLES] };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [everywhere] })).not.toThrow();
  });

  it('refuses a property the set does not have', () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const extra of ['letterSpacing', 'smallCaps']) {
      const widened = { ...style, properties: { ...style.properties, [extra]: 1 } };
      expect(() => catalogueSchema.parse({ ...catalogue, styles: [widened] }), extra).toThrow();
    }
  });

  it('accepts colour only as lower-case six-digit hex, and a background as a colour or none', () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const colour of ['#FFFFFF', 'red', '#fff', 'rgb(0,0,0)']) {
      const coloured = { ...style, properties: { colour } };
      expect(() => catalogueSchema.parse({ ...catalogue, styles: [coloured] }), colour).toThrow();
    }
    for (const background of ['none', '#f0f0f0']) {
      const filled = { ...style, properties: { background } };
      expect(() => catalogueSchema.parse({ ...catalogue, styles: [filled] })).not.toThrow();
    }
  });

  it('refuses a style identifier that is not safe verbatim as a class, a key and a Word style id', () => {
    const catalogue = paragraph();
    const renamed = { ...catalogue.styles[0]!, id: 'Body Text' };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [renamed] })).toThrow();
  });

  it('refuses a length below zero or beyond what Word can hold, and a size of nothing', () => {
    const catalogue = paragraph();
    const style = catalogue.styles[0]!;
    for (const properties of [{ spaceAfter: -1 }, { startIndent: 1585 }, { size: 0 }]) {
      const odd = { ...style, properties };
      expect(() => catalogueSchema.parse({ ...catalogue, styles: [odd] })).toThrow();
    }
  });

  it('holds a character style of a mark a publication carries, stating only appearance', () => {
    const catalogue = clone(DEFAULT_CATALOGUES.character);
    expect(catalogue.styles.map((style) => style.mark).sort()).toEqual([...STYLED_MARKS].sort());
    const unknown = { ...catalogue.styles[0]!, mark: 'comment' };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [unknown] })).toThrow();
    const sized = { ...catalogue.styles[0]!, properties: { size: 9 } };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [sized] })).toThrow();
  });

  it('holds table and image styles of an identifier, a name and what they apply to, and nothing else yet', () => {
    const table = clone(DEFAULT_CATALOGUES.table);
    const bandedTable = { ...table.styles[0]!, properties: { banded: true } };
    expect(() => catalogueSchema.parse({ ...table, styles: [bandedTable] })).toThrow();
    const figureTable = { ...table.styles[0]!, appliesTo: ['figure'] };
    expect(() => catalogueSchema.parse({ ...table, styles: [figureTable] })).toThrow();
    const image = clone(DEFAULT_CATALOGUES.image);
    const tableImage = { ...image.styles[0]!, appliesTo: ['table'] };
    expect(() => catalogueSchema.parse({ ...image, styles: [tableImage] })).toThrow();
  });

  it('keeps admonition and citation catalogues empty until something can be styled by them', () => {
    const style = { id: 'note', name: 'Note', appliesTo: ['admonition'] };
    for (const kind of ['admonition', 'citation'] as const) {
      expect(() =>
        catalogueSchema.parse({ ...DEFAULT_CATALOGUES[kind], styles: [style] }),
      ).toThrow();
    }
  });

  it('refuses a string Postgres cannot store', () => {
    const catalogue = paragraph();
    const nul = { ...catalogue.styles[0]!, name: `Body${String.fromCharCode(0)}` };
    expect(() => catalogueSchema.parse({ ...catalogue, styles: [nul] })).toThrow();
  });
});

describe('theme/1', () => {
  it('holds the default theme', () => {
    expect(() => themeSchema.parse(DEFAULT_THEME)).not.toThrow();
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
