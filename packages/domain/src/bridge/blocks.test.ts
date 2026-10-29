import type {
  Block,
  Cell,
  DecomposedImage,
  Equation,
  Inline,
  Note,
  Table,
} from '@kenhayward/bridge-contract';
import { describe, expect, it } from 'vitest';

import { parseContentDocument, type BlockNode } from '../content/model/index.js';

import { mapBlocks, mapTitle, type BlockContext, type CrossTarget } from './blocks.js';
import { componentIdFor, elementIdFor } from './ids.js';

const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>';
const ASSET = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
const owner = componentIdFor('persist-1', 's1');

type Mark = Extract<Inline, { kind: 'text' }>['marks'][number];

const text = (value: string, ...marks: Mark[]): Inline => ({ kind: 'text', text: value, marks });
const para = (id: string, ...inlines: Inline[]): Block => ({ kind: 'paragraph', id, inlines });
const cell = (blocks: Block[], over: Partial<Cell> = {}): Cell => ({
  rowSpan: 1,
  colSpan: 1,
  hAlign: 'left',
  vAlign: 'top',
  header: false,
  blocks,
  ...over,
});
const table = (over: Partial<Table> & Pick<Table, 'rows'>): Block => ({
  kind: 'table',
  id: 't1',
  numbered: true,
  caption: [],
  captionPosition: 'above',
  columnWidths: [],
  headerRows: 0,
  notes: [],
  wide: false,
  key: null,
  ...over,
});
const image = (id: string, over: Partial<DecomposedImage> = {}): DecomposedImage => ({
  id,
  contentType: 'image/png',
  widthMm: 10,
  heightMm: 10,
  align: 'left',
  alt: 'A chart',
  origin: 'embedded',
  originalContentType: null,
  ...over,
});

function context(over: Partial<BlockContext> = {}): BlockContext {
  return {
    owner,
    assets: new Map([['img1', ASSET]]),
    targets: new Map(),
    notes: new Map(),
    images: new Map([['img1', image('img1')]]),
    equations: new Map(),
    ...over,
  };
}

const wrap = (blocks: BlockNode[]) =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'T',
    language: 'en-GB',
    direction: 'ltr',
    content:
      blocks.length > 0 ? blocks : [{ type: 'paragraph', id: 'x', style: 'body', content: [] }],
  });

/** Maps, then holds the result to the model, as every delivery is. */
function map(blocks: Block[], over: Partial<BlockContext> = {}) {
  const mapped = mapBlocks(blocks, context(over));
  wrap(mapped.blocks);
  return mapped;
}

const idOf = (id: string) => elementIdFor(owner, id);
const run = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });

type Table_ = Extract<BlockNode, { type: 'table' }>;
type List_ = Extract<BlockNode, { type: 'list' }>;
const contentOf = (block: BlockNode | undefined) =>
  (block as { content: Record<string, unknown>[] }).content;

describe('mapping decomposed blocks to the content model', () => {
  it('a paragraph is a body paragraph with its text, in NFC with controls removed', () => {
    const { blocks, carried } = map([para('p1', text('Café \u0007ok\ttab'))]);
    expect(blocks).toEqual([
      { type: 'paragraph', id: idOf('p1'), style: 'body', content: [run('Café ok\ttab')] },
    ]);
    expect(carried).toEqual([]);
  });

  it('API-070 the same element gives the same identifier every time', () => {
    const first = mapBlocks([para('p1', text('a'))], context()).blocks[0]!;
    const second = mapBlocks([para('p1', text('b'))], context()).blocks[0]!;
    expect(second.id).toBe(first.id);
    expect(first.id).toBe(idOf('p1'));
    const other = mapBlocks([para('p1', text('a'))], context({ owner: componentIdFor('p', 's2') }));
    expect(other.blocks[0]!.id).not.toBe(first.id);
  });

  it('maps bold to strong, italic to emphasis, and keeps underline, superscript and subscript', () => {
    const { blocks } = map([
      para(
        'p1',
        text('a', 'bold'),
        text('b', 'italic'),
        text('c', 'underline'),
        text('d', 'superscript'),
        text('e', 'subscript'),
        text('f', 'bold', 'italic'),
      ),
    ]);
    const types = (contentOf(blocks[0]) as { marks: { type: string }[] }[]).map((each) =>
      each.marks.map((mark) => mark.type),
    );
    expect(types).toEqual([
      ['strong'],
      ['emphasis'],
      ['underline'],
      ['superscript'],
      ['subscript'],
      ['strong', 'emphasis'],
    ]);
  });

  it('runs that carry the same marks are one run', () => {
    const { blocks } = map([para('p1', text('ab', 'bold'), text('cd', 'bold'), text('ef'))]);
    expect(contentOf(blocks[0])).toHaveLength(2);
  });

  it('a break splits the paragraph in two', () => {
    const { blocks } = map([para('p1', text('one'), { kind: 'break' }, text('two'))]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => contentOf(block))).toEqual([[run('one')], [run('two')]]);
    expect(blocks[0]!.id).toBe(idOf('p1'));
    expect(blocks[1]!.id).not.toBe(blocks[0]!.id);
  });

  it('a break splits a paragraph in a list item and in a cell too', () => {
    const split = [para('p1', text('one'), { kind: 'break' }, text('two'))];
    const { blocks } = map([
      { kind: 'list', id: 'l1', ordered: false, items: [{ blocks: split }] },
      table({ rows: [{ cells: [cell([para('c1', text('a'), { kind: 'break' }, text('b'))])] }] }),
    ]);
    expect((blocks[0] as List_).items[0]!.content).toHaveLength(2);
    expect((blocks[1] as Table_).rows[0]!.cells[0]!.content).toHaveLength(2);
  });

  it('a break in a caption is a space, and leading and trailing breaks leave no empty paragraph', () => {
    const { blocks } = map([
      table({
        caption: [text('Left'), { kind: 'break' }, text('right')],
        rows: [{ cells: [cell([para('c1', text('a'))])] }],
      }),
      para('p2', { kind: 'break' }, text('x'), { kind: 'break' }),
    ]);
    expect((blocks[0] as Table_).caption).toEqual([run('Left right')]);
    expect(blocks).toHaveLength(2);
  });

  it('a paragraph with nothing in it stays one empty paragraph, and two together are one', () => {
    const { blocks } = map([para('p1'), para('p2'), para('p3', text('x'))]);
    expect(blocks).toHaveLength(2);
    expect(contentOf(blocks[0])).toEqual([]);
  });

  it('a list keeps its items blocks and the ordered flag alone', () => {
    const { blocks } = map([
      {
        kind: 'list',
        id: 'l1',
        ordered: true,
        items: [
          { blocks: [para('a', text('one'))] },
          { blocks: [] },
          {
            blocks: [
              para('b', text('two')),
              {
                kind: 'list',
                id: 'l2',
                ordered: false,
                items: [{ blocks: [para('c', text('in'))] }],
              },
            ],
          },
        ],
      },
    ]);
    const list = blocks[0] as List_;
    expect(list.kind).toBe('ordered');
    expect(list).not.toHaveProperty('start');
    expect(list).not.toHaveProperty('format');
    expect(list.items).toHaveLength(3);
    expect(list.items[1]!.content).toHaveLength(1);
    expect((list.items[2]!.content[1] as List_).kind).toBe('unordered');
  });

  it('a table keeps its caption, header rows, spans, numbering and wide as rotate', () => {
    const { blocks, carried } = map([
      table({
        caption: [text('Results')],
        headerRows: 1,
        wide: true,
        numbered: false,
        rows: [
          { cells: [cell([para('h1', text('A'))], { header: true, colSpan: 2 })] },
          { cells: [cell([para('c1', text('1'))]), cell([para('c2', text('2'))])] },
        ],
      }),
      table({ id: 't2', rows: [{ cells: [cell([para('d1', text('x'))])] }] }),
    ]);
    const first = blocks[0] as Table_;
    expect(first).toMatchObject({
      type: 'table',
      id: idOf('t1'),
      style: 'table',
      caption: [run('Results')],
      headerRows: 1,
      headerColumns: 0,
      wide: 'rotate',
      numbered: false,
    });
    expect(first.rows[0]!.cells[0]).toMatchObject({ colspan: 2, rowspan: 1 });
    const second = blocks[1] as Table_;
    expect(second).not.toHaveProperty('numbered');
    expect(second).not.toHaveProperty('wide');
    expect(carried).toEqual([]);
  });

  it('API-073 a cell marked header outside the header rows becomes headerColumns when it leads', () => {
    const { blocks, carried } = map([
      table({
        headerRows: 1,
        rows: [
          {
            cells: [
              cell([para('h1', text('Name'))], { header: true }),
              cell([para('h2', text('V'))], { header: true }),
            ],
          },
          {
            cells: [cell([para('a1', text('a'))], { header: true }), cell([para('a2', text('1'))])],
          },
          {
            cells: [cell([para('b1', text('b'))], { header: true }), cell([para('b2', text('2'))])],
          },
        ],
      }),
    ]);
    expect((blocks[0] as Table_).headerColumns).toBe(1);
    expect(carried).toEqual([]);
  });

  it('API-073 a header cell that does not lead stays an ordinary cell and is reported', () => {
    const { blocks, carried } = map([
      table({
        headerRows: 1,
        rows: [
          {
            cells: [
              cell([para('h1', text('Name'))], { header: true }),
              cell([para('h2', text('V'))], { header: true }),
            ],
          },
          {
            cells: [cell([para('a1', text('a'))]), cell([para('a2', text('1'))], { header: true })],
          },
        ],
      }),
    ]);
    expect((blocks[0] as Table_).headerColumns).toBe(0);
    expect(carried).toEqual([
      expect.objectContaining({ code: 'cell_header_dropped', element: 't1' }),
    ]);
  });

  it('API-073 column widths, alignment and caption position are not carried and are reported', () => {
    const { carried } = map([
      table({
        columnWidths: [10, 20],
        captionPosition: 'below',
        rows: [{ cells: [cell([para('c1', text('a'))], { hAlign: 'right', vAlign: 'middle' })] }],
      }),
    ]);
    expect(carried).toEqual([
      {
        code: 'presentation_dropped',
        element: 't1',
        detail: 'columnWidths hAlign vAlign captionPosition',
      },
    ]);
  });

  it('API-073 a note whose marker is in one cell is a footnote anchored to that cell, the marker removed', () => {
    const { blocks, carried } = map([
      table({
        notes: [{ marker: '1)', inlines: [text('Measured dry.')] }],
        rows: [
          {
            cells: [
              cell([para('c1', text('A'))]),
              cell([para('c2', text('B'), text('1)', 'superscript'))]),
            ],
          },
        ],
      }),
    ]);
    const grid = blocks[0] as Table_;
    const content = contentOf(grid.rows[0]!.cells[1]!.content[0]);
    expect(content[0]).toEqual(run('B'));
    expect(content[1]).toMatchObject({
      type: 'footnote',
      anchor: { kind: 'cellPosition', row: 0, column: 1 },
    });
    expect(JSON.stringify(content)).not.toContain('1)');
    expect(grid).not.toHaveProperty('note');
    expect(carried).toEqual([]);
  });

  it('API-073 a note whose marker is in no cell is anchored to the table and reported', () => {
    const { blocks, carried } = map([
      table({
        notes: [{ marker: 'a', inlines: [text('Loose note.')] }],
        rows: [{ cells: [cell([para('c1', text('A'))])] }],
      }),
    ]);
    const grid = blocks[0] as Table_;
    expect(grid.note).toHaveLength(1);
    expect(grid.note![0]).toMatchObject({ type: 'footnote', anchor: { kind: 'table' } });
    expect(carried).toEqual([{ code: 'note_anchored_table', element: 't1', detail: 'a' }]);
  });

  it('API-073 a note whose marker is in more than one cell is anchored to the table, the markers removed', () => {
    const { blocks, carried } = map([
      table({
        notes: [{ marker: '1', inlines: [text('Twice.')] }],
        rows: [
          {
            cells: [
              cell([para('c1', text('A'), text('1', 'superscript'))]),
              cell([para('c2', text('B'), text('1', 'superscript'))]),
            ],
          },
        ],
      }),
    ]);
    const grid = blocks[0] as Table_;
    expect(grid.note![0]).toMatchObject({ anchor: { kind: 'table' } });
    expect(JSON.stringify(grid.rows)).not.toContain('footnote');
    expect(JSON.stringify(grid.rows)).not.toContain('superscript');
    expect(carried).toEqual([expect.objectContaining({ code: 'note_anchored_table' })]);
  });

  it('a run naming several notes puts a footnote for each, and a run with another part stays text', () => {
    const { blocks } = map([
      table({
        notes: [
          { marker: '1', inlines: [text('One.')] },
          { marker: '2', inlines: [text('Two.')] },
        ],
        rows: [
          {
            cells: [
              cell([para('c1', text('A'), text('1,2', 'superscript'))]),
              cell([para('c2', text('B'), text('2,x', 'superscript'))]),
            ],
          },
        ],
      }),
    ]);
    const grid = blocks[0] as Table_;
    const first = contentOf(grid.rows[0]!.cells[0]!.content[0]);
    expect(first.map((each) => each.type)).toEqual(['text', 'footnote', 'footnote']);
    const second = contentOf(grid.rows[0]!.cells[1]!.content[0]);
    expect(second.map((each) => each.type)).toEqual(['text', 'text']);
  });

  it('IMP-N03 two notes with one marker are refused, naming the table', () => {
    expect(() =>
      mapBlocks(
        [
          table({
            notes: [
              { marker: '1', inlines: [text('One.')] },
              { marker: '1', inlines: [text('Again.')] },
            ],
            rows: [{ cells: [cell([para('c1', text('A'))])] }],
          }),
        ],
        context(),
      ),
    ).toThrow(/t1.*marker/);
  });

  it('IMP-N03 a cell the model cannot hold is refused by the model', () => {
    const mapped = mapBlocks(
      [
        table({
          rows: [
            {
              cells: [
                cell([
                  {
                    kind: 'figure',
                    id: 'f',
                    imageId: 'img1',
                    numbered: true,
                    caption: [],
                    captionPosition: 'below',
                  },
                ]),
              ],
            },
          ],
        }),
      ],
      context(),
    );
    expect(() => wrap(mapped.blocks)).toThrow(/figure in a cell/);
  });

  it('a figure pins the asset version with its caption and its alternative', () => {
    const { blocks, carried } = map([
      {
        kind: 'figure',
        id: 'f1',
        imageId: 'img1',
        numbered: true,
        caption: [text('Fig')],
        captionPosition: 'below',
      },
    ]);
    expect(blocks[0]).toEqual({
      type: 'figure',
      id: idOf('f1'),
      asset: ASSET,
      imageStyle: 'figure',
      caption: [run('Fig')],
      alternative: { kind: 'own', text: 'A chart' },
    });
    expect(carried).toEqual([]);
  });

  it('API-073 an image with no alternative is inherited and reported', () => {
    const { blocks, carried } = map([{ kind: 'image', id: 'i1', imageId: 'img1' }], {
      images: new Map([['img1', image('img1', { alt: null })]]),
    });
    expect(blocks[0]).toMatchObject({
      type: 'figure',
      caption: [],
      numbered: false,
      alternative: { kind: 'inherited' },
    });
    expect(carried).toEqual([{ code: 'alt_missing', element: 'i1' }]);
  });

  it('IMP-N03 an image no asset was made for is refused, naming it', () => {
    expect(() => mapBlocks([{ kind: 'image', id: 'i1', imageId: 'nope' }], context())).toThrow(
      /nope/,
    );
  });

  it('an equation with MathML is an equation block with the LaTeX kept when sent', () => {
    const equations = new Map<string, Equation>([
      ['e1', { id: 'e1', mathml: MATHML, latex: 'x', imageId: 'img1' }],
      ['e2', { id: 'e2', mathml: MATHML, latex: null, imageId: 'img1' }],
    ]);
    const { blocks } = map(
      [
        { kind: 'equation', id: 'q1', equationId: 'e1' },
        { kind: 'equation', id: 'q2', equationId: 'e2' },
      ],
      { equations },
    );
    expect(blocks[0]).toEqual({
      type: 'equation',
      id: idOf('q1'),
      mathml: MATHML,
      latex: 'x',
      numbered: false,
    });
    expect(blocks[1]).not.toHaveProperty('latex');
  });

  it('IMP-N03 MathML the strict reader refuses is refused, naming the equation', () => {
    const equations = new Map<string, Equation>([
      ['e1', { id: 'e1', mathml: '<math><mi>x</mi>', latex: null, imageId: 'img1' }],
    ]);
    expect(() =>
      mapBlocks([{ kind: 'equation', id: 'q1', equationId: 'e1' }], context({ equations })),
    ).toThrow(/e1/);
  });

  it('API-073 an equation that is an image only becomes a figure of that image and is reported', () => {
    const equations = new Map<string, Equation>([
      ['e1', { id: 'e1', mathml: null, latex: 'E=mc^2', imageId: 'img1' }],
      ['e2', { id: 'e2', mathml: null, latex: null, imageId: 'img1' }],
    ]);
    const { blocks, carried } = map(
      [
        { kind: 'equation', id: 'q1', equationId: 'e1' },
        { kind: 'equation', id: 'q2', equationId: 'e2' },
      ],
      { equations },
    );
    expect(blocks[0]).toMatchObject({
      type: 'figure',
      asset: ASSET,
      alternative: { kind: 'own', text: 'E=mc^2' },
    });
    expect(blocks[1]).toMatchObject({
      type: 'figure',
      alternative: { kind: 'own', text: 'A chart' },
    });
    expect(carried.map((each) => each.code)).toEqual([
      'equation_image_only',
      'equation_image_only',
    ]);
  });

  it('an inline equation is an inline equation, and an image-only one an inline image', () => {
    const equations = new Map<string, Equation>([
      ['e1', { id: 'e1', mathml: MATHML, latex: null, imageId: 'img1' }],
      ['e2', { id: 'e2', mathml: null, latex: null, imageId: 'img1' }],
    ]);
    const { blocks, carried } = map(
      [
        para(
          'p1',
          { kind: 'inline_equation', equationId: 'e1' },
          { kind: 'inline_equation', equationId: 'e2' },
        ),
      ],
      { equations },
    );
    expect(contentOf(blocks[0])).toEqual([
      { type: 'equation', mathml: MATHML },
      {
        type: 'image',
        asset: ASSET,
        imageStyle: 'inline',
        alternative: { kind: 'own', text: 'A chart' },
      },
    ]);
    expect(carried).toEqual([{ code: 'equation_image_only', element: 'p1', detail: 'e2' }]);
  });

  it('an inline image is an inline image', () => {
    const { blocks } = map([para('p1', { kind: 'inline_image', imageId: 'img1' })]);
    expect(contentOf(blocks[0])).toEqual([
      {
        type: 'image',
        asset: ASSET,
        imageStyle: 'inline',
        alternative: { kind: 'own', text: 'A chart' },
      },
    ]);
  });

  it('a note reference is a footnote holding the note as paragraphs', () => {
    const notes = new Map<string, Note>([
      ['n1', { id: 'n1', blocks: [para('np1', text('First.')), para('np2', text('Second.'))] }],
    ]);
    const { blocks, carried } = map([para('p1', text('See'), { kind: 'note_ref', noteId: 'n1' })], {
      notes,
    });
    const note = contentOf(blocks[0])[1]!;
    expect(note).toMatchObject({ type: 'footnote', anchor: { kind: 'span' } });
    expect(note.content).toHaveLength(2);
    expect(carried).toEqual([]);
  });

  it('API-073 a note holding more than paragraphs is flattened to its text and reported', () => {
    const notes = new Map<string, Note>([
      [
        'n1',
        {
          id: 'n1',
          blocks: [
            para('np1', text('Lead '), { kind: 'inline_image', imageId: 'img1' }),
            {
              kind: 'list',
              id: 'nl',
              ordered: false,
              items: [
                { blocks: [para('a', text('alpha'))] },
                { blocks: [para('b', text('beta'))] },
              ],
            },
          ],
        },
      ],
    ]);
    const { blocks, carried } = map([para('p1', { kind: 'note_ref', noteId: 'n1' })], { notes });
    const note = contentOf(blocks[0])[0] as unknown as { content: { content: unknown[] }[] };
    expect(note.content.map((each) => each.content)).toEqual([
      [run('Lead A chart')],
      [run('alpha beta')],
    ]);
    expect(carried.map((each) => each.code)).toEqual(['note_flattened', 'note_flattened']);
    expect(carried.every((each) => each.element === 'n1')).toBe(true);
  });

  it('a note referenced twice is two footnotes with their own identifiers', () => {
    const notes = new Map<string, Note>([
      ['n1', { id: 'n1', blocks: [para('np1', text('Once.'))] }],
    ]);
    const { blocks } = map(
      [
        para('p1', { kind: 'note_ref', noteId: 'n1' }),
        para('p2', { kind: 'note_ref', noteId: 'n1' }),
      ],
      { notes },
    );
    const ids = blocks.map((block) => contentOf(block)[0]!.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('IMP-N03 a reference to a note that is not there is refused, naming it', () => {
    expect(() => mapBlocks([para('p1', { kind: 'note_ref', noteId: 'gone' })], context())).toThrow(
      /gone/,
    );
  });

  it('an xref is a cross-reference to the target it names, displayed as a number', () => {
    const target: CrossTarget = { kind: 'block', block: idOf('p9') };
    const { blocks, carried } = map(
      [para('p1', text('see '), { kind: 'xref', targetId: 'p9', text: 'Table 2' })],
      { targets: new Map([['p9', target]]) },
    );
    expect(contentOf(blocks[0])[1]).toEqual({
      type: 'crossReference',
      id: expect.stringMatching(/^[a-z2-7]{26}$/),
      target,
      display: 'number',
    });
    expect(carried).toEqual([]);
  });

  it('API-073 an xref to an element outside the document becomes its text and is reported', () => {
    const { blocks, carried } = map([
      para('p1', { kind: 'xref', targetId: 'far', text: 'Table 9' }),
    ]);
    expect(contentOf(blocks[0])).toEqual([run('Table 9')]);
    expect(carried).toEqual([{ code: 'xref_outside', element: 'p1', detail: 'far' }]);
  });

  it('a link with http, https or mailto is a hyperlink mark on its text', () => {
    const { blocks, carried } = map([
      para(
        'p1',
        { kind: 'link', href: 'https://example.com/a', inlines: [text('site', 'bold')] },
        { kind: 'link', href: 'mailto:a@example.com', inlines: [text('mail')] },
      ),
    ]);
    const content = contentOf(blocks[0]) as { marks: { type: string; href?: string }[] }[];
    expect(content[0]!.marks.map((mark) => mark.type)).toEqual(['strong', 'hyperlink']);
    expect(content[0]!.marks[1]!.href).toBe('https://example.com/a');
    expect(content[1]!.marks[0]).toMatchObject({ type: 'hyperlink', href: 'mailto:a@example.com' });
    expect(carried).toEqual([]);
  });

  it('API-073 a link with a ftp scheme is kept as text and reported', () => {
    const { blocks, carried } = map([
      para('p1', { kind: 'link', href: 'ftp://example.com/f', inlines: [text('files')] }),
    ]);
    expect(contentOf(blocks[0])).toEqual([run('files')]);
    expect(carried).toEqual([{ code: 'link_scheme', element: 'p1', detail: 'ftp:' }]);
  });

  it('a javascript link and a link that is no URL are kept as text and reported', () => {
    const { carried } = map([
      para(
        'p1',
        { kind: 'link', href: 'javascript:alert(1)', inlines: [text('x')] },
        { kind: 'link', href: '/relative', inlines: [text('y')] },
      ),
    ]);
    expect(carried.map((each) => each.code)).toEqual(['link_scheme', 'link_scheme']);
  });

  it('IMP-N03 a block type the design does not list is refused, naming it', () => {
    expect(() => mapBlocks([{ kind: 'sidebar', id: 'z' } as unknown as Block], context())).toThrow(
      /sidebar/,
    );
  });

  it('a title is inline content with a break as a space', () => {
    const { inlines, carried } = mapTitle(
      [text('Scope'), { kind: 'break' }, text('and aims')],
      context(),
      'sec1',
    );
    expect(inlines).toEqual([run('Scope and aims')]);
    expect(carried).toEqual([]);
  });
});
