import { describe, expect, it } from 'vitest';

import { DEFAULT_CATALOGUES, DEFAULT_CATALOGUE_VERSIONS, DEFAULT_THEME } from './default.js';
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
  it('names each of its six catalogues by the version the store seeds', () => {
    for (const kind of CATALOGUE_KINDS) {
      expect(DEFAULT_THEME.catalogues[kind], kind).toBe(DEFAULT_CATALOGUE_VERSIONS[kind]);
      expect(DEFAULT_CATALOGUES[kind].kind).toBe(kind);
    }
    expect(new Set(Object.values(DEFAULT_CATALOGUE_VERSIONS)).size).toBe(6);
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
    });
    expect(paragraph('preformatted-label').properties).toMatchObject({ size: 8 });
    expect(paragraph('table-note').properties).toMatchObject({ size: 10 });
    expect(paragraph('notice').properties).toMatchObject({ size: 9, alignment: 'end' });
    expect(paragraph('running').properties).toMatchObject({ size: 9 });
  });

  it('sets the body at every place but the footnote and the quotation, which have their own', () => {
    expect(DEFAULT_THEME.places).toEqual({
      text: 'body',
      listItem: 'body',
      quotation: 'quotation',
      tableCell: 'body',
      footnote: 'footnote',
    });
  });

  it('holds the three pinned families, each under the SIL Open Font Licence and embeddable in both outputs', () => {
    expect(DEFAULT_THEME.typefaces.map((each) => each.family)).toEqual([
      'Liberation Serif',
      'Liberation Mono',
      'STIX Two Math',
    ]);
    for (const each of DEFAULT_THEME.typefaces) {
      expect(each.licence, each.id).toBe('OFL-1.1');
      expect(each.embedding, each.id).toEqual({ pdf: true, word: true });
    }
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

  it("holds today's table and image identifiers, and empty admonition and citation catalogues", () => {
    expect(DEFAULT_CATALOGUES.table.styles).toEqual([
      { id: 'table', name: 'Table', appliesTo: ['table'] },
    ]);
    expect(DEFAULT_CATALOGUES.image.styles).toEqual([
      { id: 'figure', name: 'Figure', appliesTo: ['figure'] },
      { id: 'inline', name: 'Inline image', appliesTo: ['inlineImage'] },
    ]);
    expect(DEFAULT_CATALOGUES.admonition.styles).toEqual([]);
    expect(DEFAULT_CATALOGUES.citation.styles).toEqual([]);
  });
});
