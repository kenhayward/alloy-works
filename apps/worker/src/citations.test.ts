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
  type CslItem,
} from '@alloy-works/domain';
import { renderCitations, SEEDED_STYLE_FILES } from '@alloy-works/domain/citations';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **Citations in the PDF** (the CI plan, CIc): template 23 sets each in-text form where `assemble`
 * placed it, a link to its entry, and the bibliography after the last node.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const NODE = 'sources'.padEnd(26, 'a');
const MARLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c21';
const RECORDS = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c22';
const ENTRIES = new Map<string, CslItem>([
  [
    MARLOW,
    {
      type: 'book',
      title: 'Sediment and its movement',
      author: [{ family: 'Marlow', given: 'Ada' }],
      issued: { 'date-parts': [[2020]] },
      publisher: 'Harbour Press',
    },
  ],
  [
    RECORDS,
    {
      type: 'report',
      title: 'Annual flood bulletin',
      author: [{ literal: 'Coastal Records Office' }],
      issued: { 'date-parts': [[2023]] },
    },
  ],
]);
const text = (value: string) => ({ type: 'text', value, marks: [] });
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
      title: 'The estuary report',
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
          title: 'Sources',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                text('Sediment moves '),
                { type: 'citation', entry: MARLOW },
                text(' and floods recur '),
                { type: 'citation', entry: RECORDS },
                text('.'),
              ],
            },
          ],
        }),
      ],
    ]),
    refused: [],
    layout: parseLayout({
      ...defaultLayout,
      translations: undefined,
      matter: {
        ...defaultLayout.matter,
        cover: false,
        contents: null,
        lists: [],
        bibliography: { title: 'References' },
      },
    }),
    theme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
    citations: {
      style: { csl: SEEDED_STYLE_FILES['nlm-citation-sequence'], requires: {} },
      entries: new Map([[NODE, ENTRIES]]),
      render: renderCitations,
    },
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  const template = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;
  return readPdf(
    await typst.compile(template, JSON.stringify(made.document), new Date('2026-10-22T00:00:00Z')),
  );
};

describe('citations in the PDF (CIc)', () => {
  let read: ReadPdf;
  beforeAll(async () => {
    read = await compile();
  }, 120_000);

  it('CNT-053 PUB-040 sets each in-text form where it stands, and the bibliography of the entries cited after the last node', () => {
    const tagged = read.taggedText.flat().join(' ');
    // The extraction parts each run with a space.
    expect(tagged).toMatch(/Sediment moves \(1\) and floods recur \(2\) ?\./);
    expect(tagged).toMatch(
      /References.*1\. Marlow A\. Sediment and its movement.*2\. Coastal Records Office\. Annual flood bulletin/,
    );
    // Its title is bookmarked, a list a screen reader is told is one.
    expect(read.bookmarks.map((each) => each.title)).toContain('References');
    expect(read.roles).toEqual(expect.arrayContaining(['L', 'LI']));
  });

  it('PUB-112 links each citation to its entry in the bibliography', () => {
    const words = read.items.find((item) => item.text.includes('Sediment moves'))!;
    const line = read.destinations[words.page - 1]!.filter(
      ({ rect: [, bottom, , top] }) => bottom <= words.y && words.y <= top,
    );
    const entries = read.items.filter((item) => /^\d\. /.test(item.text.trim()));
    expect(line).toHaveLength(2);
    // Each link lands on the page its entry is set on, and is tagged as a link.
    expect(line.map((each) => each.to)).toEqual(entries.map((each) => each.page - 1));
    expect(read.roles).toContain('Link');
  });
});
