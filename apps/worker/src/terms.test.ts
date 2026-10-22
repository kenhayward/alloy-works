import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  readTheme,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  type PublishingTerm,
} from '@alloy-works/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **Terms in the PDF** (the TM plan, TMb): template 24 sets each use's forms where `assemble` printed
 * them, a link to its glossary entry, and the glossary and the abbreviations after the last node.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const NODE = 'pump'.padEnd(26, 'a');
const RPM = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c21';
const TORQUE = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c22';
const term = (preferred: string, definition: string, abbreviation?: string): PublishingTerm => ({
  term: {
    schemaVersion: 1,
    base: 'en',
    labels: [
      {
        language: 'en',
        preferred,
        alternatives: [],
        ...(abbreviation === undefined ? {} : { abbreviation }),
      },
    ],
    definition: [{ language: 'en', text: definition }],
    broader: [],
    narrower: [],
    related: [],
  },
  deprecated: false,
});
const TERMS = new Map([
  [RPM, term('revolutions per minute', 'Turns of a shaft in one minute.', 'RPM')],
  [TORQUE, term('torque', 'A turning force.')],
]);
const text = (value: string) => ({ type: 'text', value, marks: [] });
const termed = (value: string, mark: string, of: string) => ({
  type: 'text',
  value,
  marks: [{ type: 'definedTerm', id: mark, term: of }],
});
const theme = (() => {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();

const compile = async () => {
  const made = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The pump report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: NODE,
          component: '00000000-0000-4000-8000-000000000001',
          mode: { kind: 'latest' },
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          children: [],
        },
      ],
    }),
    occurrences: new Map([
      [
        NODE,
        parseContentDocument({
          schemaVersion: 1,
          title: 'Pump',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                text('The shaft turns at 900 '),
                termed('speed', 'm1', RPM),
                text(' under '),
                termed('force', 'm2', TORQUE),
                text('.'),
              ],
            },
            {
              type: 'paragraph',
              id: 'p2',
              style: 'body',
              content: [text('Above 1200 '), termed('rpm', 'm3', RPM), text(' it stops.')],
            },
          ],
        }),
      ],
    ]),
    refused: [],
    layout: parseLayout({
      ...defaultLayout,
      matter: { ...defaultLayout.matter, cover: false, contents: null, lists: [] },
    }),
    theme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
    terms: { entries: new Map([[NODE, TERMS]]) },
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  const template = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;
  return readPdf(
    await typst.compile(template, JSON.stringify(made.document), new Date('2026-10-22T00:00:00Z')),
  );
};

describe('terms in the PDF (TMb)', () => {
  let read: ReadPdf;
  beforeAll(async () => {
    read = await compile();
  }, 120_000);

  it('LIB-016 sets the first use expanded and the next the abbreviation alone, read back from the PDF', () => {
    const tagged = read.taggedText.flat().join(' ');
    expect(tagged).toMatch(
      /The shaft turns at 900 ?revolutions per minute \(RPM\) ?under ?torque ?\./,
    );
    expect(tagged).toMatch(/Above 1200 ?RPM ?it stops\./);
  });

  it('PUB-039 sets the glossary and the abbreviations after the last node, each bookmarked, each a list', () => {
    const tagged = read.taggedText.flat().join(' ');
    expect(tagged).toMatch(
      /Glossary.*revolutions per minute ?Turns of a shaft in one minute\..*torque ?A turning force\..*Abbreviations.*RPM ?revolutions per minute/,
    );
    expect(read.bookmarks.map((each) => each.title)).toEqual(
      expect.arrayContaining(['Glossary', 'Abbreviations']),
    );
    expect(read.roles).toEqual(expect.arrayContaining(['L', 'LI', 'Link']));
  });

  it('links each use in running text to its glossary entry', () => {
    const words = read.items.find((item) => item.text.includes('The shaft turns'))!;
    const line = read.destinations[words.page - 1]!.filter(
      ({ rect: [, bottom, , top] }) => bottom <= words.y && words.y <= top,
    );
    expect(line).toHaveLength(2);
  });
});
