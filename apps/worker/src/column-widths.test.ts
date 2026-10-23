import {
  assemble,
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  readTheme,
  type ContentDocument,
  type TableCatalogue,
  type TableStyle,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf } from './testing/pdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **A table's columns as wide as what they hold** (the TG plan, TG3, task 5): `assemble` measures each
 * column by the pinned faces' advances, and template 21 sets the widths it gave.
 */

const fonts = await loadPinnedFonts();
const faces = await pinnedFacesByHash(fonts.directory);
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const at = new Date('2026-10-11T00:00:00Z');
const NODE = 'widths'.padEnd(26, 'a');
const TEMPLATE = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;
const layout = parseLayout({
  ...defaultLayout,
  translations: undefined,
  matter: { ...defaultLayout.matter, cover: false, contents: null, lists: [] },
});
const MARGINS = layout.formats.pdf.margins;
const MEASURE = layout.formats.pdf.page.width - MARGINS.inside - MARGINS.outside;

const themed = (widths: 'equal' | 'content') => {
  const table = '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c03';
  const tables: TableCatalogue = {
    ...DEFAULT_CATALOGUES.table,
    styles: DEFAULT_CATALOGUES.table.styles.map((each) => ({ ...(each as TableStyle), widths })),
  };
  const read = readTheme(
    { ...DEFAULT_THEME, catalogues: { ...DEFAULT_THEME.catalogues, table } },
    new Map([...DEFAULT_CATALOGUES_BY_VERSION, [table, tables]]),
  );
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
};
const text = (value: string) => ({ type: 'text', value, marks: [] });
const cell = (name: string, value: string) => ({
  content: [{ type: 'paragraph', id: name, style: 'body', content: [text(value)] }],
});
const published = async (widths: 'equal' | 'content') => {
  const made = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Widths',
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
          title: 'Readings',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'table',
              id: 't1',
              style: 'table',
              caption: [text('Readings')],
              headerRows: 0,
              headerColumns: 0,
              rows: [
                { cells: [cell('a1', 'N1'), cell('b1', 'Second')] },
                {
                  cells: [
                    cell('a2', 'S2'),
                    cell('b2', 'Taken at the south gauge each morning at dawn'),
                  ],
                },
              ],
            },
          ],
        }) as ContentDocument,
      ],
    ]),
    refused: [],
    layout,
    theme: themed(widths),
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
    faces,
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  return readPdf(await typst.compile(TEMPLATE, JSON.stringify(made.document), at));
};
const startOf = (read: Awaited<ReturnType<typeof readPdf>>, value: string) =>
  read.items.find((item) => item.text.trim() === value)!.x;

describe("a table's columns as wide as what they hold (TG3)", () => {
  it('TAB-053 sets a column of short codes narrower than one of sentences in the PDF, where equal widths split the measure in two', async () => {
    const equal = await published('equal');
    const content = await published('content');
    // The default style centres a cell's text, so a code stands mid-column: equal, a quarter of the
    // measure along; by content, its column as narrow as its codes and its padding, a twentieth.
    expect(startOf(equal, 'N1') - MARGINS.inside).toBeGreaterThan(MEASURE / 5);
    expect(startOf(content, 'N1') - MARGINS.inside).toBeLessThan(MEASURE / 20);
  });
});
