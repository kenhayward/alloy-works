import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE } from '../admission/mathml.js';

import { canonicalise } from './canonical.js';
import { CURRENT_SCHEMA_VERSION, contentDocumentSchema, parseContentDocument } from './document.js';
import { readContent } from './migrate.js';

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

  it('CNT-146 closes the root, so an unknown member is refused', () => {
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

  it('CNT-002 keeps a block identifier unique across the whole component, footnotes included', () => {
    const noted = (id: string, footnoteId: string, inner: string) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: [
        { type: 'text', value: 'Measured at noon.', marks: [] },
        {
          type: 'footnote',
          id: footnoteId,
          anchor: { kind: 'span' },
          content: [paragraph(inner, 'Local time.')],
        },
      ],
    });
    expect(() =>
      parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f2', 'fb2')])),
    ).not.toThrow();
    // A footnote's paragraph with a body paragraph's identifier - issue #122's own case.
    expect(() => parseContentDocument(doc([noted('b1', 'f1', 'b1')]))).toThrow(/b1/);
    // Two footnotes' paragraphs sharing one.
    expect(() =>
      parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f2', 'fb1')])),
    ).toThrow(/fb1/);
    // A footnote with a block's, which a reference to either would then name twice (STR-026).
    expect(() => parseContentDocument(doc([noted('b1', 'b2', 'fb1'), paragraph('b2')]))).toThrow(
      /b2/,
    );
    // Two footnotes sharing one.
    expect(() =>
      parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f1', 'fb2')])),
    ).toThrow(/f1/);
  });

  it('CNT-023 refuses two adjacent empty paragraphs, and admits one', () => {
    const empty = { type: 'paragraph', id: 'b1', style: 'body', content: [] };
    expect(parseContentDocument(doc([empty])).content).toHaveLength(1);
    expect(() => parseContentDocument(doc([empty, { ...empty, id: 'b2' }]))).toThrow(/adjacent/);
  });

  it('refuses two adjacent empty paragraphs in a footnote and in a table cell, as admission removes them', () => {
    const empty = (id: string) => ({ type: 'paragraph', id, style: 'body', content: [] });
    const noting = (content: unknown[]) => ({
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'Dose', marks: [] },
        { type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content },
      ],
    });
    const tabling = (content: unknown[]) => ({
      type: 'table',
      id: 't1',
      caption: 'Doses',
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content, colspan: 1, rowspan: 1 }] }],
    });
    // One empty paragraph is where a cursor stands, in either place; two are spacing.
    expect(() => parseContentDocument(doc([noting([empty('fb1')])]))).not.toThrow();
    expect(() => parseContentDocument(doc([tabling([empty('c1')])]))).not.toThrow();
    expect(() => parseContentDocument(doc([noting([empty('fb1'), empty('fb2')])]))).toThrow(
      /adjacent/,
    );
    expect(() => parseContentDocument(doc([tabling([empty('c1'), empty('c2')])]))).toThrow(
      /adjacent/,
    );
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
    const withoutAlternative = {
      type: 'figure',
      id: 'b6',
      asset: 'asset-1',
      imageStyle: 'column-width',
      caption: 'Figure',
    };
    const figure = { ...withoutAlternative, alternative: { kind: 'inherited' } };
    expect(parseContentDocument(doc([figure])).content[0]).toMatchObject({ asset: 'asset-1' });
    expect(() => contentDocumentSchema.parse(doc([withoutAlternative]))).toThrow();
  });

  // Not CNT-047, deliberately. Its second clause - that an unnumbered equation consumes no
  // number - belongs to STR, which owns the sequence, so content-model.md declines the claim.
  // Citing it here would compute Covered for a requirement no design answers in full.
  it('CNT-021 stores a block equation as numbered or explicitly unnumbered', () => {
    const withoutNumbered = {
      type: 'equation',
      id: 'b7',
      mathml: `<math xmlns="${MATHML_NAMESPACE}"/>`,
    };
    const equation = { ...withoutNumbered, numbered: false };
    expect(parseContentDocument(doc([equation])).content[0]).toMatchObject({ numbered: false });
    expect(() => contentDocumentSchema.parse(doc([withoutNumbered]))).toThrow();
  });

  it('CNT-018 preserves whitespace in a preformatted block', () => {
    const pre = { type: 'preformatted', id: 'b8', text: '  two spaces\n\ttab', language: 'sql' };
    expect(parseContentDocument(doc([pre])).content[0]).toMatchObject({
      text: '  two spaces\n\ttab',
    });
  });

  it('CNT-129 admits no table and no image inside a footnote, and nothing outside its closed list', () => {
    const noting = (content: unknown[]) => ({
      type: 'paragraph',
      id: 'b9',
      style: 'body',
      content: [{ type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content }],
    });
    const note = (inline: unknown) => ({
      type: 'paragraph',
      id: 'fb1',
      style: 'footnote',
      content: [{ type: 'text', value: 'See the appendix.', marks: [] }, inline],
    });
    const table = {
      type: 'table',
      id: 'b10',
      caption: 'x',
      headerRows: 0,
      headerColumns: 0,
      rows: [],
    };
    const image = {
      type: 'image',
      asset: 'asset-1',
      imageStyle: 'inline',
      alternative: { kind: 'decorative' },
    };
    const nested = {
      type: 'footnote',
      id: 'f2',
      anchor: { kind: 'span' },
      content: [paragraph('fb2')],
    };
    // A table in place of a paragraph; an image, and a footnote, inside a footnote's paragraph.
    expect(() => parseContentDocument(doc([noting([table])]))).toThrow();
    expect(() => parseContentDocument(doc([noting([note(image)])]))).toThrow(/may not: image/);
    expect(() => parseContentDocument(doc([noting([note(nested)])]))).toThrow(/may not: footnote/);
    // What the list does admit: a citation, an equation, a variable and a binding.
    for (const inline of [
      { type: 'citation', entry: 'bib-1' },
      { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
      { type: 'variable', name: 'productName' },
      { type: 'binding', query: 'query-1' },
    ]) {
      expect(() => parseContentDocument(doc([noting([note(inline)])]))).not.toThrow();
    }
  });
});

describe('a cross-reference, where a component holds one', () => {
  const COMPONENT = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
  const reference = (id: string, target: unknown) => ({
    type: 'crossReference',
    id,
    target,
    display: 'number',
  });
  const citing = (id: string, inlines: unknown[]) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [{ type: 'text', value: 'See ', marks: [] }, ...inlines],
  });

  it('keeps its identifier unique in the component, beside every block and footnote', () => {
    const own = { kind: 'block', block: 'b2' };
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference('x1', own), reference('x2', own)]), paragraph('b2')]),
      ),
    ).not.toThrow();
    expect(() =>
      parseContentDocument(doc([citing('b1', [reference('x1', own), reference('x1', own)])])),
    ).toThrow(/x1/);
    expect(() =>
      parseContentDocument(doc([citing('b1', [reference('b2', own)]), paragraph('b2')])),
    ).toThrow(/b2/);
    // Inside a footnote, too: the walk that claims a footnote's paragraphs claims what they hold.
    const noted = citing('b1', [
      {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [{ ...citing('fb1', [reference('x1', own)]), style: 'footnote' }],
      },
      reference('x1', own),
    ]);
    expect(() => parseContentDocument(doc([noted, paragraph('b2')]))).toThrow(/x1/);
  });

  it('refuses an identifier or a target not already in NFC, which the digest would fold into another', () => {
    // One identifier, spelled composed and decomposed. The canonical form writes every string in NFC,
    // so both would be stored as one, while the parse compared them as two.
    const composed = 'café';
    const decomposed = 'café';
    const noted = (id: string) => ({
      type: 'footnote',
      id,
      anchor: { kind: 'span' },
      content: [paragraph('fb1')],
    });
    expect(() =>
      parseContentDocument(
        doc([citing(composed, [reference('x1', { kind: 'block', block: composed }), noted('f1')])]),
      ),
    ).not.toThrow();
    // A block's, a footnote's and a cross-reference's identifier.
    expect(() => parseContentDocument(doc([paragraph(decomposed)]))).toThrow(/NFC/);
    expect(() => parseContentDocument(doc([citing('b1', [noted(decomposed)])]))).toThrow(/NFC/);
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference(decomposed, { kind: 'block', block: 'b1' })])]),
      ),
    ).toThrow(/NFC/);
    // And the block a target names, of this component or of another.
    for (const target of [
      { kind: 'block', block: decomposed },
      { kind: 'component', component: COMPONENT, block: decomposed },
    ]) {
      expect(() => parseContentDocument(doc([citing('b1', [reference('x1', target)])]))).toThrow(
        /NFC/,
      );
    }
  });

  it('reaches a block of its own component or of another, and never an outline node', () => {
    for (const target of [
      { kind: 'block', block: 'b2' },
      { kind: 'component', component: COMPONENT, block: 'b2' },
    ]) {
      expect(() =>
        parseContentDocument(doc([citing('b1', [reference('x1', target)]), paragraph('b2')])),
      ).not.toThrow();
    }
    // A node belongs to one document's outline, and a component is used in many.
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference('x1', { kind: 'node', node: 'a'.repeat(26) })])]),
      ),
    ).toThrow(/outline node/);
  });
});

describe('an equation, stored only as the MathML reader writes it', () => {
  const kept = `<math xmlns="${MATHML_NAMESPACE}" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>`;

  /** One equation in each place one can stand: a block, inline, and inline inside a footnote. */
  const placed = (mathml: string) =>
    [
      ['as a block', doc([{ type: 'equation', id: 'b1', mathml, numbered: false }])],
      [
        'inline',
        doc([
          { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'equation', mathml }] },
        ]),
      ],
      [
        'inside a footnote',
        doc([
          {
            type: 'paragraph',
            id: 'b1',
            style: 'body',
            content: [
              {
                type: 'footnote',
                id: 'f1',
                anchor: { kind: 'span' },
                content: [
                  {
                    type: 'paragraph',
                    id: 'b2',
                    style: 'footnote',
                    content: [{ type: 'equation', mathml }],
                  },
                ],
              },
            ],
          },
        ]),
      ],
    ] as const;

  it('admits MathML the reader would keep exactly as it stands, wherever the equation stands', () => {
    for (const [where, document] of placed(kept)) {
      expect(() => parseContentDocument(document), where).not.toThrow();
    }
  });

  it.each([
    [
      'with no namespace declared',
      '<math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
    ],
    ['with whitespace between elements', kept.replace('<mfrac>', '\n  <mfrac>')],
    [
      'with its namespace declared again inside',
      kept.replace('<mfrac>', `<mfrac xmlns="${MATHML_NAMESPACE}">`),
    ],
    [
      'with attributes out of order',
      kept.replace('display="block"', 'display="block" alttext="a over b"'),
    ],
    ['with an empty element not self-closed', kept.replace('<mi>b</mi>', '<mi></mi>')],
    ['with text not in NFC', kept.replace('<mi>a</mi>', '<mi>e\u{301}</mi>')],
    ['with a combining mark written raw', kept.replace('<mi>a</mi>', '<mi>\u{338}</mi>')],
    ['with an event handler', kept.replace('<mi>a</mi>', '<mi onclick="alert(1)">a</mi>')],
    ['with a script', kept.replace('<mi>a</mi>', '<mi>a</mi><script>alert(1)</script>')],
    ['with a link', kept.replace('<mi>a</mi>', '<mi href="javascript:alert(1)">a</mi>')],
    ['with a colour', kept.replace('<mi>a</mi>', '<mi mathcolor="red">a</mi>')],
    ['that cannot be read', kept.replace('</mfrac>', '')],
  ])('refuses an equation %s, wherever it stands', (_, mathml) => {
    for (const [where, document] of placed(mathml)) {
      expect(() => parseContentDocument(document), where).toThrow(
        /not in the one form the MathML reader writes/,
      );
    }
  });

  it('quarantines stored content holding an equation the reader would not keep as it stands', () => {
    const outcome = readContent(
      doc([
        {
          type: 'equation',
          id: 'b1',
          mathml: kept.replace('<mi>a</mi>', '<mi onclick="alert(1)">a</mi>'),
          numbered: true,
        },
      ]),
      { artifact: 'component-10', version: '1.0' },
    );
    expect(outcome).toMatchObject({ ok: false, artifact: 'component-10', version: '1.0' });
    expect(outcome).not.toHaveProperty('document');
    expect(!outcome.ok && outcome.failure).toMatch(/not in the one form the MathML reader writes/);
  });
});

describe('adjacent runs, which the canonical form merges (issue #154)', () => {
  const runs = (content: unknown[]) =>
    doc([{ type: 'paragraph', id: 'b1', style: 'body', content }]);
  const contentOf = (document: unknown) => {
    const block = parseContentDocument(document).content[0];
    return block?.type === 'paragraph' ? block.content : [];
  };
  const link = (id: string) => ({ type: 'hyperlink', id, href: 'https://example.test/setup' });
  const emphasised = (value: string, id = 'm1') => ({
    type: 'text',
    value,
    marks: [{ type: 'emphasis', id }],
  });

  it('merges two adjacent runs carrying the same marks into one', () => {
    expect(contentOf(runs([emphasised('Install '), emphasised('the printer.')]))).toEqual([
      { type: 'text', value: 'Install the printer.', marks: [{ type: 'emphasis', id: 'm1' }] },
    ]);
  });

  it('gives the merged and the split spelling of one text one digest', () => {
    const split = canonicalise(
      parseContentDocument(runs([emphasised('Install '), emphasised('the printer.')])),
    );
    const whole = canonicalise(parseContentDocument(runs([emphasised('Install the printer.')])));
    expect(split).toBe(whole);
  });

  it('merges two runs holding one set of marks written in two orders', () => {
    const marks = [
      { type: 'emphasis', id: 'm1' },
      { type: 'language', id: 'm2', tag: 'fr-FR' },
    ];
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks },
          { type: 'text', value: 'the printer.', marks: [...marks].reverse() },
        ]),
      ),
    ).toEqual([{ type: 'text', value: 'Install the printer.', marks }]);
  });

  it('leaves two runs whose marks differ alone', () => {
    expect(
      contentOf(
        runs([
          emphasised('Install '),
          { type: 'text', value: 'the printer.', marks: [{ type: 'strong', id: 'm2' }] },
        ]),
      ),
    ).toHaveLength(2);
  });

  it('leaves two annotations of one type beside each other alone', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks: [link('m1')] },
          { type: 'text', value: 'the printer.', marks: [link('m2')] },
        ]),
      ),
    ).toEqual([
      { type: 'text', value: 'Install ', marks: [link('m1')] },
      { type: 'text', value: 'the printer.', marks: [link('m2')] },
    ]);
  });

  it('leaves two runs apart when one mark of the set differs in an attribute', () => {
    expect(
      contentOf(
        runs([
          {
            type: 'text',
            value: 'Install ',
            marks: [{ type: 'language', id: 'm1', tag: 'fr-FR' }],
          },
          {
            type: 'text',
            value: 'the printer.',
            marks: [{ type: 'language', id: 'm1', tag: 'fr-CA' }],
          },
        ]),
      ),
    ).toHaveLength(2);
  });

  it('does not merge a run with the node beside it that is not a run', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks: [] },
          { type: 'variable', name: 'productName' },
          { type: 'text', value: ' first.', marks: [] },
        ]),
      ),
    ).toHaveLength(3);
  });

  it('drops a run whose value is empty, which is a second spelling of one text', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: '', marks: [] },
          { type: 'text', value: 'Install the printer.', marks: [] },
        ]),
      ),
    ).toEqual([{ type: 'text', value: 'Install the printer.', marks: [] }]);
  });

  it('gives a document with an empty run the digest of the same document without it', () => {
    const withEmpty = canonicalise(
      parseContentDocument(
        runs([
          { type: 'text', value: 'Install the printer.', marks: [] },
          { type: 'text', value: '', marks: [{ type: 'strong', id: 'm1' }] },
        ]),
      ),
    );
    const without = canonicalise(
      parseContentDocument(runs([{ type: 'text', value: 'Install the printer.', marks: [] }])),
    );
    expect(withEmpty).toBe(without);
  });

  it('leaves a paragraph of nothing but empty runs with no content at all', () => {
    expect(contentOf(runs([{ type: 'text', value: '', marks: [] }]))).toEqual([]);
  });

  it('joins runs an empty run stood between', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks: [] },
          { type: 'text', value: '', marks: [{ type: 'strong', id: 'm1' }] },
          { type: 'text', value: 'the printer.', marks: [] },
        ]),
      ),
    ).toEqual([{ type: 'text', value: 'Install the printer.', marks: [] }]);
  });

  it('merges in every inline home the walk reaches, not only a paragraph', () => {
    const parsed = parseContentDocument(
      doc([
        {
          type: 'blockquote',
          id: 'b1',
          content: [paragraph('b2')],
          attribution: [emphasised('Ada '), emphasised('Lovelace')],
        },
        {
          type: 'table',
          id: 'b3',
          caption: 'A table',
          headerRows: 0,
          headerColumns: 0,
          rows: [],
          note: [emphasised('Measured ', 'm2'), emphasised('at sea level.', 'm2')],
        },
        {
          type: 'paragraph',
          id: 'b4',
          style: 'body',
          content: [
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [
                {
                  type: 'paragraph',
                  id: 'b5',
                  style: 'footnote',
                  content: [emphasised('See ', 'm3'), emphasised('the appendix.', 'm3')],
                },
              ],
            },
          ],
        },
      ]),
    );
    const [quote, table, anchor] = parsed.content;
    expect(quote?.type === 'blockquote' && quote.attribution).toHaveLength(1);
    expect(table?.type === 'table' && table.note).toHaveLength(1);
    const footnote = anchor?.type === 'paragraph' ? anchor.content[0] : undefined;
    const inner =
      footnote?.type === 'footnote' ? (footnote.content as { content: unknown[] }[])[0] : undefined;
    expect(inner?.content).toHaveLength(1);
  });
});

describe('the parse of what the parse returned, which must be what it returned', () => {
  const emptyRun = (id: string) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [{ type: 'text', value: '', marks: [] }],
  });

  it('refuses two paragraphs left empty by their runs, as it refuses two written empty', () => {
    // CNT-023 is judged on the canonical form, not on what arrived: two paragraphs holding one
    // empty run each are two empty paragraphs once the walk has dropped the runs, so they are
    // refused at the door rather than stored and refused on read-back.
    expect(() => parseContentDocument(doc([emptyRun('b1'), emptyRun('b2')]))).toThrow(/adjacent/);
  });

  it('refuses the same pair inside a footnote and inside a table cell', () => {
    const noting = (content: unknown[]) => ({
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'Dose', marks: [] },
        { type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content },
      ],
    });
    const tabling = (content: unknown[]) => ({
      type: 'table',
      id: 't1',
      caption: 'Doses',
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content, colspan: 1, rowspan: 1 }] }],
    });
    expect(() => parseContentDocument(doc([noting([emptyRun('fb1'), emptyRun('fb2')])]))).toThrow(
      /adjacent/,
    );
    expect(() => parseContentDocument(doc([tabling([emptyRun('c1'), emptyRun('c2')])]))).toThrow(
      /adjacent/,
    );
  });

  it('accepts what it returned, unchanged, for every document it accepts at all', () => {
    // The invariant the walk owes every caller, now that what it returns is not what it was given:
    // a document it accepts parses again to itself. A document it refuses is refused at the door,
    // which is the other half of the same promise - never accepted once and refused on read-back.
    const attempt = (value: unknown) => {
      try {
        return { ok: true as const, document: parseContentDocument(value) };
      } catch {
        return { ok: false as const };
      }
    };
    const stored = (name: string) =>
      JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'v1', name), 'utf8'));
    const emphasis = [{ type: 'emphasis', id: 'm1' }];
    const documents: unknown[] = [
      stored('minimal.json'),
      stored('every-node.json'),
      doc([paragraph('b1')]),
      doc([emptyRun('b1')]),
      doc([emptyRun('b1'), emptyRun('b2')]),
      doc([emptyRun('b1'), paragraph('b2')]),
      doc([
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Install ', marks: emphasis },
            { type: 'text', value: '', marks: [] },
            { type: 'text', value: 'the printer.', marks: emphasis },
            { type: 'text', value: 'Cafe', marks: [] },
            { type: 'text', value: '\u{301} au lait', marks: [] },
          ],
        },
      ]),
      doc([
        {
          type: 'blockquote',
          id: 'b1',
          content: [emptyRun('b2')],
          attribution: [
            { type: 'text', value: 'Ada ', marks: emphasis },
            { type: 'text', value: 'Lovelace', marks: emphasis },
          ],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [
                {
                  type: 'paragraph',
                  id: 'b2',
                  style: 'footnote',
                  content: [
                    { type: 'text', value: 'See ', marks: emphasis },
                    { type: 'text', value: 'the appendix.', marks: emphasis },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ];
    for (const document of documents) {
      const where = JSON.stringify(document).slice(0, 90);
      const first = attempt(document);
      if (!first.ok) continue;
      expect(attempt(first.document), where).toEqual({ ok: true, document: first.document });
      expect(canonicalise(parseContentDocument(first.document)), where).toBe(
        canonicalise(first.document),
      );
    }
  });

  it('stores a run in NFC, so no join can make a spelling the digest does not cover', () => {
    // Written as code points: an editor normalises what it saves, so two literals typed as "cafe
    // with an acute" are one string in the file and the test asserts nothing.
    const composed = 'Caf\u{E9} au lait';
    const decomposed = 'Cafe\u{301} au lait';
    expect(composed).not.toBe(decomposed);
    const runs = (content: unknown[]) =>
      doc([{ type: 'paragraph', id: 'b1', style: 'body', content }]);
    const contentOf = (document: unknown) => {
      const block = parseContentDocument(document).content[0];
      return block?.type === 'paragraph' ? block.content : [];
    };
    const one = { type: 'text', value: composed, marks: [] };
    // Two NFC runs whose join is not NFC, one decomposed run, and the composed run itself.
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Cafe', marks: [] },
          { type: 'text', value: '\u{301} au lait', marks: [] },
        ]),
      ),
    ).toEqual([one]);
    expect(contentOf(runs([{ type: 'text', value: decomposed, marks: [] }]))).toEqual([one]);
    expect(contentOf(runs([one]))).toEqual([one]);
  });
});
