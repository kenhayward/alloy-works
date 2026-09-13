import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, contentDocumentSchema, parseContentDocument } from './document.js';

const paragraph = (id: string, value = 'A sentence.') => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

const doc = (content: unknown[]) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'A component',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

describe('the content document', () => {
  it('CNT-001 is a tree of typed block nodes, serialised as JSON', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).content[0]?.type).toBe('paragraph');
  });

  it('CNT-144 closes the root, so an unknown member is refused', () => {
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), owner: 'Grace' }),
    ).toThrow();
  });

  it('CNT-011 records the schema version the content was written against', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), schemaVersion: 99 }),
    ).toThrow();
  });

  it('CNT-142 carries the component title, and refuses an empty one', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).title).toBe('A component');
    expect(() => contentDocumentSchema.parse({ ...doc([paragraph('b1')]), title: '' })).toThrow();
  });

  it('CNT-140 requires a BCP 47 base language on the component', () => {
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), language: 'english' }),
    ).toThrow();
  });

  it('CNT-059 puts direction in the model rather than leaving it to styling', () => {
    expect(parseContentDocument({ ...doc([paragraph('b1')]), direction: 'rtl' }).direction).toBe(
      'rtl',
    );
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), direction: 'auto' }),
    ).toThrow();
  });

  it('CNT-124 requires at least one block', () => {
    expect(() => contentDocumentSchema.parse(doc([]))).toThrow();
  });

  it('CNT-002 requires an identifier on every block', () => {
    expect(() =>
      contentDocumentSchema.parse(doc([{ type: 'paragraph', style: 'body', content: [] }])),
    ).toThrow();
  });

  it('CNT-002 refuses two blocks sharing an identifier', () => {
    expect(() => parseContentDocument(doc([paragraph('b1'), paragraph('b1')]))).toThrow(/b1/);
  });

  it('CNT-023 refuses two adjacent empty paragraphs, and admits one', () => {
    const empty = { type: 'paragraph', id: 'b1', style: 'body', content: [] };
    expect(parseContentDocument(doc([empty])).content).toHaveLength(1);
    expect(() => parseContentDocument(doc([empty, { ...empty, id: 'b2' }]))).toThrow(/adjacent/);
  });

  it('CNT-117 supports three list kinds, and CNT-119 puts start and format on an ordered one', () => {
    const list = {
      type: 'list',
      id: 'b2',
      kind: 'ordered',
      start: 3,
      format: 'roman',
      items: [{ content: [paragraph('b3')] }],
    };
    expect(parseContentDocument(doc([list])).content[0]).toMatchObject({
      kind: 'ordered',
      format: 'roman',
    });
    expect(() => contentDocumentSchema.parse(doc([{ ...list, kind: 'checklist' }]))).toThrow();
  });

  it('CNT-118 nests a list to six levels in a mixture of kinds', () => {
    let items: unknown = [{ content: [paragraph('b-deep')] }];
    for (let level = 6; level >= 1; level -= 1) {
      items = [
        {
          content: [
            { type: 'list', id: `b-l${level}`, kind: level % 2 ? 'ordered' : 'unordered', items },
          ],
        },
      ];
    }
    expect(() =>
      parseContentDocument(doc([{ type: 'list', id: 'b-root', kind: 'unordered', items }])),
    ).not.toThrow();
  });

  it('CNT-016 and CNT-107 carry header rows, spans, a caption and key columns on a table', () => {
    const table = {
      type: 'table',
      id: 'b4',
      caption: 'Revenue',
      headerRows: 1,
      headerColumns: 1,
      keyColumns: [0],
      rows: [{ cells: [{ content: [paragraph('b5')], colspan: 2, rowspan: 1 }] }],
    };
    expect(parseContentDocument(doc([table])).content[0]).toMatchObject({ keyColumns: [0] });
  });

  it('CNT-017 and CNT-022 make a figure reference an asset and carry an alternative', () => {
    const figure = {
      type: 'figure',
      id: 'b6',
      asset: 'asset-1',
      imageStyle: 'column-width',
      caption: 'Figure',
      alternative: { kind: 'inherited' },
    };
    expect(parseContentDocument(doc([figure])).content[0]).toMatchObject({ asset: 'asset-1' });
    const { alternative: _dropped, ...withoutAlternative } = figure;
    expect(() => contentDocumentSchema.parse(doc([withoutAlternative]))).toThrow();
  });

  it('CNT-021 and CNT-047 make a block equation numbered or explicitly unnumbered', () => {
    const equation = { type: 'equation', id: 'b7', mathml: '<math/>', numbered: false };
    expect(parseContentDocument(doc([equation])).content[0]).toMatchObject({ numbered: false });
    const { numbered: _dropped, ...withoutNumbered } = equation;
    expect(() => contentDocumentSchema.parse(doc([withoutNumbered]))).toThrow();
  });

  it('CNT-018 preserves whitespace in a preformatted block', () => {
    const pre = { type: 'preformatted', id: 'b8', text: '  two spaces\n\ttab', language: 'sql' };
    expect(parseContentDocument(doc([pre])).content[0]).toMatchObject({
      text: '  two spaces\n\ttab',
    });
  });

  it('CNT-129 admits no table and no image inside a footnote', () => {
    const withTable = paragraph('b9');
    withTable.content = [
      {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [
          { type: 'table', id: 'b10', caption: 'x', headerRows: 0, headerColumns: 0, rows: [] },
        ],
      },
    ] as never;
    expect(() => parseContentDocument(doc([withTable]))).toThrow();
  });
});
