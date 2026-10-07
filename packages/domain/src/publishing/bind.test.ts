import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import type { CanonicalResult, CanonicalValue } from '../data/canonical.js';
import type { ValueType } from '../data/columns.js';
import type { Column } from '../data/definition.js';
import { formatValue } from '../data/format.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';
import { TABLE_ROWS_MAX } from '../data/table.js';
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { ValueFormats } from '../theme/schema.js';
import { resolved } from '../theme/theme.fixture.js';

import { assemble } from './assemble.js';
import { bind, type Held } from './bind.js';
import { defaultLayout } from './layout.js';
import type { PublishedBlock, PublishedDocument, PublishedNode } from './published.js';

/**
 * The publish's binding stage (the B3 plan, B3-D): each binding taken from the result the request
 * recorded for it, formatted, and set in the content as text, or failed by name.
 */

const id = (name: string) => name.padEnd(26, 'a');
const NODE = id('calib');
const QUERY = '00000000-0000-4000-8000-0000000000aa';
const text = (value: string) => ({ type: 'text', value, marks: [] });
const binding = (name: string, take: unknown = { column: 'reading' }) => ({
  type: 'binding',
  id: name,
  query: QUERY,
  parameters: {},
  mode: 'checked',
  take,
});
const paragraph = (name: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content,
});
const component = (...content: unknown[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Calibration',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

const COLUMNS: Column[] = [
  { name: 'site', from: { column: 'site_code' }, type: { base: 'text' } },
  {
    name: 'reading',
    from: { column: 'reading_kpa' },
    type: { base: 'decimal', precision: 10, scale: 2 },
  },
];
const result = (...rows: CanonicalValue[][]): CanonicalResult => ({
  columns: [
    ['site', 'text'],
    ['reading', 'decimal'],
  ],
  rows,
});
const held = (r: CanonicalResult, key: readonly string[] = ['site']): Held => ({
  result: r,
  columns: COLUMNS,
  datasetVersion: '00000000-0000-4000-8000-0000000000d1',
  images: {},
  key,
});

const outline: OutlineDocument = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
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
});

const assembled = (content: ContentDocument, bindings?: ReadonlyMap<string, Held>) =>
  assemble({
    formats: ['pdf', 'docx'],
    outline,
    occurrences: new Map([[NODE, content]]),
    ...(bindings === undefined ? {} : { bindings: new Map([[NODE, bindings]]) }),
    refused: [],
    layout: defaultLayout,
    theme: resolved(),
    revision: '0.1',
    covers: () => true,
    assets: new Map(),
  });

const blocksOf = (nodes: readonly PublishedNode[]): PublishedBlock[] =>
  nodes.flatMap((node) => [...node.blocks, ...blocksOf(node.children)]);

describe('bind', () => {
  it('sets a value as text where its binding stood, formatted by the formats it is given', () => {
    const content = component(paragraph('p1', text('The reading is '), binding('b1'), text('.')));
    const { bound, values, failures } = bind(
      NODE,
      content,
      new Map([['b1', held(result(['north', '4200.5']))]]),
      DEFAULT_VALUE_FORMATS,
    );
    expect(failures).toEqual([]);
    const printed = formatValue('4200.5', COLUMNS[1]!.type as ValueType, DEFAULT_VALUE_FORMATS);
    expect(printed).toBe('4,200.50');
    expect(bound.content[0]).toEqual(
      paragraph('p1', text('The reading is '), text(printed), text('.')),
    );
    expect(values).toEqual([
      {
        node: NODE,
        block: 'p1',
        binding: 'b1',
        take: { column: 'reading' },
        printed,
        value: '4200.5',
        column: { name: 'reading', type: COLUMNS[1]!.type },
        datasetVersion: '00000000-0000-4000-8000-0000000000d1',
      },
    ]);
    // And a publish prints it: the paragraph's text holds the value as the page shows it.
    const made = assembled(content, new Map([['b1', held(result(['north', '4200.5']))]]));
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const runs = blocksOf(made.document.nodes).flatMap((block) =>
      block.type === 'paragraph' ? block.runs : [],
    );
    expect(runs.map((run) => ('text' in run ? run.text : '')).join('')).toBe(
      'The reading is 4,200.50.',
    );
  });

  it('DAT-087 fails a binding the request recorded no result for, naming it, its block and its node, and publishes nothing', () => {
    const content = component(
      paragraph('p1', text('The reading is '), binding('b1')),
      paragraph('p2', binding('b2')),
    );
    const { failures } = bind(
      NODE,
      content,
      new Map([['b2', held(result(['north', '1']))]]),
      DEFAULT_VALUE_FORMATS,
    );
    expect(failures).toEqual([
      { stage: 'bind', code: 'binding_unresolved', node: NODE, block: 'p1', detail: 'b1' },
    ]);
    // Through `assemble`, a request that recorded nothing for the document fails every binding.
    const made = assembled(content);
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures.filter((each) => each.code === 'binding_unresolved')).toEqual([
      { stage: 'bind', code: 'binding_unresolved', node: NODE, block: 'p1', detail: 'b1' },
      { stage: 'bind', code: 'binding_unresolved', node: NODE, block: 'p2', detail: 'b2' },
    ]);
    expect('document' in made).toBe(false);
  });

  it('DAT-046 fails each value it cannot take by name, every one gathered, and never prints a blank, a zero, a placeholder or a description in its place', () => {
    const content = component(
      paragraph('p1', text('None '), binding('none')),
      paragraph('p2', text('Many '), binding('many')),
      paragraph(
        'p3',
        text('Missing '),
        binding('missing', { key: { site: 'east' }, column: 'reading' }),
      ),
      paragraph('p4', text('Null '), binding('null')),
      paragraph('p5', text('Empty '), binding('empty', { column: 'site' })),
      paragraph('p6', text('Invalid '), binding('invalid', { column: 'depth' })),
      paragraph('p7', text('Unreadable '), binding('unreadable')),
      paragraph('p8', text('Taken '), binding('taken')),
    );
    const results = new Map<string, Held>([
      ['none', held(result())],
      ['many', held(result(['north', '1'], ['south', '2']))],
      ['missing', held(result(['north', '1']))],
      ['null', held(result(['north', null]))],
      ['empty', held(result([' ', '1']))],
      ['invalid', held(result(['north', '1']))],
      ['unreadable', 'unreadable'],
      ['taken', held(result(['north', '0']))],
    ]);
    const { bound, failures, values } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    const expected = [
      ['p1', 'value_none', 'none'],
      ['p2', 'value_many', 'many'],
      ['p3', 'row_missing', 'missing'],
      ['p4', 'value_null', 'null'],
      ['p5', 'value_empty', 'empty'],
      ['p6', 'take_invalid', 'invalid'],
      ['p7', 'result_unreadable', 'unreadable'],
    ].map(([block, code, detail]) => ({ stage: 'bind', code, node: NODE, block, detail }));
    expect(failures).toEqual(expected);
    // Only the value taken is set; each failed binding is left a binding, never a text in its place.
    expect(values.map((each) => each.binding)).toEqual(['taken']);
    for (const [at, block] of bound.content.entries()) {
      const inlines = block.type === 'paragraph' ? block.content : [];
      expect(inlines.length, block.id).toBe(2);
      expect(inlines[1]!.type, block.id).toBe(at === 7 ? 'text' : 'binding');
    }
    // And `assemble` gathers every one beside the document's other failures, and projects nothing.
    const made = assembled(content, results);
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures.filter((each) => each.stage === 'bind')).toEqual(expected);
    expect('document' in made).toBe(false);
  });
});

describe('bind, a bound image (the B6 plan, B6-D and B6-E)', () => {
  const NORTH = 'a1'.repeat(32);
  const SOUTH = 'b2'.repeat(32);
  const NORTH_ASSET = '00000000-0000-4000-8000-00000000a501';
  const SOUTH_ASSET = '00000000-0000-4000-8000-00000000a502';
  const DESCRIBED = { base: 'image', encoding: 'binary', description: { column: 'caption' } };
  const PHOTOS: Column[] = [
    { name: 'site', from: { column: 'site' }, type: { base: 'text' } },
    { name: 'photo', from: { column: 'photo' }, type: DESCRIBED as Column['type'] },
    { name: 'caption', from: { column: 'caption' }, type: { base: 'text' } },
  ];
  const photos = (...rows: CanonicalValue[][]): Held => ({
    result: {
      columns: [
        ['site', 'text'],
        ['photo', 'image'],
        ['caption', 'text'],
      ],
      rows,
    },
    columns: PHOTOS,
    datasetVersion: '00000000-0000-4000-8000-0000000000d2',
    images: { [NORTH]: NORTH_ASSET, [SOUTH]: SOUTH_ASSET },
    key: [],
  });
  const ROWS: CanonicalValue[][] = [
    ['north', NORTH, 'The north gate'],
    ['south', SOUTH, '  '],
  ];
  const at = (site: string, column = 'photo') => ({ key: { site }, column });
  const figure = (name: string, bound: unknown, alternative = { kind: 'inherited' }) => ({
    type: 'figure',
    id: name,
    binding: bound,
    imageStyle: 'figure',
    caption: [text('The site')],
    alternative,
  });
  const cell = (...content: unknown[]) => ({ content, colspan: 1, rowspan: 1 });
  const asset = (alternative: { text: string; language: string } | null = null) => ({
    object: `t_acme/sha256/${'c'.repeat(64)}`,
    format: 'png' as const,
    width: 80,
    height: 60,
    alternative,
  });

  it('sets an inline binding taking an image as an inline image, and a figure as one with an asset, each described by the description taken', () => {
    const content = component(
      paragraph('p1', text('The gate '), binding('i1', at('north'))),
      {
        type: 'table',
        id: 't1',
        caption: [text('Gates')],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [cell(paragraph('c1', binding('i2', at('north'))))] }],
      },
      figure('f1', binding('i3', at('north'))),
      figure('f2', binding('i4', at('north')), { kind: 'decorative' }),
    );
    const results = new Map(['i1', 'i2', 'i3', 'i4'].map((each) => [each, photos(...ROWS)]));
    const { bound, failures, values } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    expect(failures).toEqual([]);
    const image = {
      type: 'image',
      asset: NORTH_ASSET,
      imageStyle: 'inline',
      alternative: { kind: 'own', text: 'The north gate' },
    };
    expect(bound.content[0]).toEqual(paragraph('p1', text('The gate '), image));
    expect(bound.content[1]).toMatchObject({
      rows: [{ cells: [{ content: [paragraph('c1', image)] }] }],
    });
    expect(bound.content[2]).toEqual({
      ...figure('f1', undefined, { kind: 'own', text: 'The north gate' } as never),
      binding: undefined,
      asset: NORTH_ASSET,
    });
    expect(bound.content[2]).not.toHaveProperty('binding');
    // The author's decorative stands over the definition's description.
    expect(bound.content[3]).toMatchObject({
      asset: NORTH_ASSET,
      alternative: { kind: 'decorative' },
    });
    expect(values.map((each) => ('image' in each ? [each.binding, each.image] : []))).toEqual(
      ['i1', 'i2', 'i3', 'i4'].map((each) => [each, { hash: NORTH, assetVersion: NORTH_ASSET }]),
    );
    // And `assemble` publishes each: two images in their lines and two figures, described as taken.
    const made = assemble({
      formats: ['pdf', 'docx'],
      outline,
      occurrences: new Map([[NODE, content]]),
      bindings: new Map([[NODE, results]]),
      refused: [],
      layout: defaultLayout,
      theme: resolved(),
      revision: '0.1',
      covers: () => true,
      assets: new Map([[NORTH_ASSET, asset()]]),
    });
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const blocks = blocksOf(made.document.nodes);
    const figures = blocks.filter((each) => each.type === 'figure');
    expect(figures.map((each) => each.alternative?.text ?? null)).toEqual(['The north gate', null]);
  });

  it('DAT-097 fails every bound image whose description is missing by name, naming its binding, its block and the column, and places none', () => {
    const content = component(
      paragraph('p1', binding('i1', at('south'))),
      // Nothing marks this figure decorative, so the row's description is required.
      figure('f1', binding('i2', at('south'))),
    );
    const results = new Map(['i1', 'i2'].map((each) => [each, photos(...ROWS)]));
    const expected = [
      ['p1', 'i1'],
      ['f1', 'i2'],
    ].map(([block, binding]) => ({
      stage: 'bind',
      code: 'image_description_missing',
      node: NODE,
      block,
      detail: `${binding}: caption`,
    }));
    const { bound, failures, values } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    expect(failures).toEqual(expected);
    expect(values).toEqual([]);
    expect(bound.content.map((each) => ('asset' in each ? each.asset : undefined))).toEqual([
      undefined,
      undefined,
    ]);
    const made = assembled(content, results);
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures.filter((each) => each.stage === 'bind')).toEqual(expected);
  });

  it("DAT-097 publishes a bound figure its author marked decorative as decorative, whatever its row's description holds (Ken, 2026-10-06)", () => {
    const rows: CanonicalValue[][] = [
      ['west', NORTH, null],
      ['south', SOUTH, '  '],
    ];
    const content = component(
      figure('f1', binding('i1', at('west')), { kind: 'decorative' }),
      figure('f2', binding('i2', at('south')), { kind: 'decorative' }),
    );
    const results = new Map(['i1', 'i2'].map((each) => [each, photos(...rows)]));
    const { bound, failures, values } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    expect(failures).toEqual([]);
    expect(bound.content).toMatchObject([
      { asset: NORTH_ASSET, alternative: { kind: 'decorative' } },
      { asset: SOUTH_ASSET, alternative: { kind: 'decorative' } },
    ]);
    expect(bound.content.every((each) => !('binding' in each))).toBe(true);
    // Recorded as placed decorative, from the column the definition declares.
    expect(values).toMatchObject([
      { binding: 'i1', description: 'decorative', column: { name: 'photo', type: DESCRIBED } },
      { binding: 'i2', description: 'decorative', column: { name: 'photo', type: DESCRIBED } },
    ]);
    const made = assemble({
      formats: ['pdf', 'docx'],
      outline,
      occurrences: new Map([[NODE, content]]),
      bindings: new Map([[NODE, results]]),
      refused: [],
      layout: defaultLayout,
      theme: resolved(),
      revision: '0.1',
      covers: () => true,
      assets: new Map([
        [NORTH_ASSET, asset()],
        [SOUTH_ASSET, asset()],
      ]),
    });
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const figures = blocksOf(made.document.nodes).filter((each) => each.type === 'figure');
    expect(figures.map((each) => each.alternative)).toEqual([null, null]);
  });

  it('DAT-097 describes an image by the words its row holds, though they read "decorative": only the column or the author makes one decorative', () => {
    const content = component(
      paragraph('p1', binding('i1', at('east'))),
      figure('f1', binding('i2', at('east'))),
    );
    const rows: CanonicalValue[][] = [['east', NORTH, 'decorative']];
    const results = new Map(['i1', 'i2'].map((each) => [each, photos(...rows)]));
    const { bound, failures } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    expect(failures).toEqual([]);
    const said = { kind: 'own', text: 'decorative' };
    expect(bound.content).toMatchObject([
      { content: [{ type: 'image', alternative: said }] },
      { asset: NORTH_ASSET, alternative: said },
    ]);
  });

  it("fails a figure's binding taking anything but an image, value_not_image, and an image bound in a footnote's text or a caption, image_not_placeable", () => {
    const content = component(
      figure('f1', binding('v1', at('north', 'caption'))),
      paragraph('p1', text('Gate'), {
        type: 'footnote',
        id: 'n1',
        anchor: { kind: 'span' },
        content: [paragraph('np1', binding('i1', at('north')))],
      }),
      { ...figure('f2', binding('i2', at('north'))), caption: [binding('i3', at('north'))] },
    );
    const results = new Map(['v1', 'i1', 'i2', 'i3'].map((each) => [each, photos(...ROWS)]));
    const { failures } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    expect(failures).toEqual([
      { stage: 'bind', code: 'value_not_image', node: NODE, block: 'f1', detail: 'v1' },
      { stage: 'bind', code: 'image_not_placeable', node: NODE, block: 'np1', detail: 'i1' },
      { stage: 'bind', code: 'image_not_placeable', node: NODE, block: 'f2', detail: 'i3' },
    ]);
  });
});

describe("a bound table's words, through the binding stage (TB1.1)", () => {
  it('sets the bindings in its caption, note and source as text, and leaves its own binding and its empty statement for its stage', () => {
    const whole = { ...binding('whole') } as Record<string, unknown>;
    delete whole.take;
    const content = component({
      type: 'boundTable',
      id: 't1',
      binding: whole,
      caption: [text('Reading '), binding('in-caption')],
      columns: [{ column: 'reading', header: 'Reading' }],
      headerColumn: false,
      empty: [binding('in-empty')],
      note: [binding('in-note')],
      source: [binding('in-source')],
    });
    const one = held(result(['north', '1.50']));
    const { bound, failures } = bind(
      NODE,
      content,
      new Map(['in-caption', 'in-empty', 'in-note', 'in-source'].map((name) => [name, one])),
      DEFAULT_VALUE_FORMATS,
    );
    expect(failures).toEqual([]);
    // The empty statement's binding is left for the stage, which sets it only where it prints.
    expect(bound.content[0]).toMatchObject({
      type: 'boundTable',
      binding: whole,
      caption: [text('Reading '), text('1.50')],
      empty: [binding('in-empty')],
      note: [text('1.50')],
      source: [text('1.50')],
    });
  });
});

describe('a bound table published (the TB1 plan, TB1-H; TB1.2)', () => {
  const whole = (name: string) => {
    const each = { ...binding(name) } as Record<string, unknown>;
    delete each.take;
    return each;
  };
  const boundTable = (extra: Record<string, unknown> = {}) => ({
    type: 'boundTable',
    id: 't1',
    binding: whole('rows'),
    caption: [text('Readings')],
    columns: [
      { column: 'site', header: 'Site' },
      { column: 'reading', header: 'Reading', unit: { text: 'kPa', place: 'header' } },
    ],
    headerColumn: false,
    ...extra,
  });
  const tableOf = (made: ReturnType<typeof assemble>) => {
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const table = blocksOf((made.document as PublishedDocument).nodes).find(
      (block) => block.type === 'table',
    );
    if (table === undefined || table.type !== 'table') throw new Error('no table');
    return table;
  };
  const words = (cell: { blocks: readonly PublishedBlock[] }) =>
    cell.blocks
      .flatMap((block) => (block.type === 'paragraph' ? block.runs : []))
      .map((run) => ('text' in run ? run.text : ''))
      .join('');
  const grid = (table: ReturnType<typeof tableOf>) => table.rows.map((row) => row.cells.map(words));

  it("DAT-028 publishes a block binding as a table whose presentation is the block's and the table style's, never the binding's", () => {
    const made = assembled(
      component(
        boundTable({ sort: [{ column: 'reading', direction: 'descending', nulls: 'last' }] }),
      ),
      new Map([['rows', held(result(['north', '4200.5'], ['south', '-12.345'], ['east', null]))]]),
    );
    const table = tableOf(made);
    expect(table).toMatchObject({
      id: 't1',
      style: 'table',
      label: 'Table 1.1',
      headerRows: 1,
      headerColumns: 0,
      columns: 2,
      listed: true,
    });
    expect(table.caption.map((run) => ('text' in run ? run.text : ''))).toEqual(['Readings']);
    // The header from the columns, the unit bracketed as the style says; the rows sorted, each value
    // printed at its scale by the style's format, a null as the layout's words say.
    expect(grid(table)).toEqual([
      ['Site', 'Reading (kPa)'],
      ['north', '4,200.50'],
      ['south', '-12.35'],
      ['east', 'Not available'],
    ]);
    expect(table.rows[0]!.cells.map((cell) => cell.scope)).toEqual(['column', 'column']);
    expect(table.rows[1]!.cells.map((cell) => cell.scope)).toEqual([null, null]);
    // Text at the start and numbers on their separator, the table style's by type; both may wrap.
    expect(table.bound).toEqual({ align: ['start', 'decimal'], wrap: [true, true], source: null });
  });

  it("sets an empty statement's bindings only where it prints: with rows, they record nothing and fail nothing", () => {
    const made = assembled(
      component(boundTable({ empty: [text('None since '), binding('since')] })),
      // `since` has no result recorded: taken, it would fail `binding_unresolved`.
      new Map([['rows', held(result(['north', '1.5']))]]),
    );
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    expect(made.values.map((each) => each.binding)).toEqual(['rows']);
  });

  it("sets an empty statement's bindings where the result has no rows, each printed and recorded", () => {
    const made = assembled(
      component(boundTable({ empty: [text('None since '), binding('since')] })),
      new Map([
        ['rows', held(result())],
        ['since', held(result(['north', '2.25']))],
      ]),
    );
    const table = tableOf(made);
    expect(grid(table)[1]).toEqual(['None since 2.25']);
    if (!made.ok) return;
    expect(made.values.map((each) => each.binding)).toEqual(['rows', 'since']);
    expect(made.values[1]).toMatchObject({ block: 't1', printed: '2.25' });
  });

  it('TAB-046 insets a value printing no parentheses in a column printing them, by what it prints and never by its text, a unit after each value among them', () => {
    const made = assembled(
      component(
        boundTable({
          columns: [
            {
              column: 'reading',
              header: 'Reading',
              unit: { text: 'kg', place: 'value' },
              format: { negative: 'parentheses' },
            },
          ],
        }),
      ),
      new Map([['rows', held(result(['north', '1.5'], ['south', '-1.5'], ['east', null]))]]),
    );
    const table = tableOf(made);
    const nbsp = String.fromCodePoint(0xa0);
    expect(grid(table).slice(1)).toEqual([
      [`1.50${nbsp}kg`],
      [`(1.50)${nbsp}kg`],
      ['Not available'],
    ]);
    // The negative prints its parentheses and so is not inset, though its text ends in its unit.
    expect(table.rows.slice(1).map((row) => row.cells[0]!.inset ?? false)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('heads each row by its first column where the table says so, and sets a no-wrap column, its alignment and its source after the layout word', () => {
    const made = assembled(
      component(
        boundTable({
          headerColumn: true,
          columns: [
            { column: 'site', header: 'Site', wrap: false, align: 'centre' },
            {
              column: 'reading',
              header: 'Reading',
              format: { negative: 'parentheses', negativeColour: true },
            },
          ],
          source: [text('Gauge survey')],
        }),
      ),
      new Map([['rows', held(result(['north', '1.5'], ['south', '-2']))]]),
    );
    const table = tableOf(made);
    expect(table.headerColumns).toBe(1);
    expect(table.rows[1]!.cells.map((cell) => cell.scope)).toEqual(['row', null]);
    expect(grid(table).slice(1)).toEqual([
      ['north', '1.50'],
      ['south', '(2.00)'],
    ]);
    expect(table.bound).toEqual({
      align: ['centre', 'decimal'],
      wrap: [false, true],
      source: [
        { text: 'Source: ', marks: [] },
        { text: 'Gauge survey', marks: [] },
      ],
    });
    // A value without parentheses in a column printing them is inset by one, and a negative is set
    // in the style's colour beside its parentheses.
    expect(table.rows[1]!.cells[1]).toMatchObject({ inset: true });
    expect(table.rows[1]!.cells[1]!.colour).toBeUndefined();
    expect(table.rows[2]!.cells[1]).toMatchObject({ colour: '#c00000' });
    expect(table.rows[2]!.cells[1]!.inset).toBeUndefined();
  });

  it("publishes a bound table's own wide, and the style's where it says none (TB3-G)", () => {
    const rows = new Map([['rows', held(result(['north', '1.5']))]]);
    expect(tableOf(assembled(component(boundTable({ wide: 'rotate' })), rows)).wide).toBe('rotate');
    expect(tableOf(assembled(component(boundTable()), rows)).wide).toBe('scale');
  });

  it('DAT-069 publishes an empty result its definition declares valid as its headers and the statement, a data cell spanning the table', () => {
    for (const headerColumn of [false, true]) {
      const declared = assembled(
        component(boundTable({ headerColumn, empty: [text('No gauge reported.')] })),
        new Map([['rows', held(result())]]),
      );
      const table = tableOf(declared);
      expect(grid(table)).toEqual([['Site', 'Reading (kPa)'], ['No gauge reported.']]);
      expect(table.rows[1]!.cells).toMatchObject([{ colspan: 2, rowspan: 1, scope: null }]);
    }
    const unsaid = tableOf(assembled(component(boundTable()), new Map([['rows', held(result())]])));
    expect(grid(unsaid)[1]).toEqual(['No rows']);
  });

  it("TAB-045 publishes a table in a document's language with its value catalogue's separators and date order for that language", () => {
    const fr: ValueFormats = {
      number: { decimal: ',', group: '.', groupFrom: 4, minus: 'U+2212' },
      date: { order: 'dmy', separator: '/', pad: true },
      time: { separator: ':' },
      boolean: { true: 'vrai', false: 'faux' },
    };
    const theme = resolved();
    const french = {
      ...theme,
      valueCatalogue: { ...theme.valueCatalogue!, byLanguage: [{ language: 'fr', formats: fr }] },
    };
    const columns: Column[] = [
      ...COLUMNS,
      { name: 'taken', from: { column: 'taken_on' }, type: { base: 'date' } },
    ];
    const content = component(
      boundTable({
        columns: [
          { column: 'reading', header: 'Mesure' },
          { column: 'taken', header: 'Date' },
        ],
      }),
    );
    const made = assemble({
      formats: ['pdf'],
      outline: { ...outline, language: 'fr-FR' },
      occurrences: new Map([[NODE, { ...content, language: 'fr-FR' }]]),
      bindings: new Map([
        [
          NODE,
          new Map<string, Held>([
            [
              'rows',
              {
                ...(held({
                  columns: [
                    ['site', 'text'],
                    ['reading', 'decimal'],
                    ['taken', 'date'],
                  ],
                  rows: [['north', '-4200.5', '2026-03-07']],
                }) as Exclude<Held, 'unreadable'>),
                columns,
              },
            ],
          ]),
        ],
      ]),
      refused: [],
      layout: { ...defaultLayout, language: 'fr' },
      theme: french,
      revision: '0.1',
      covers: () => true,
      assets: new Map(),
    });
    const minus = String.fromCodePoint(0x2212);
    expect(grid(tableOf(made))[1]).toEqual([`${minus}4.200,50`, '07/03/2026']);
  });

  it('TAB-004 fails the publish where the dataset version lacks a column shown, naming the table and the column, and prints no empty column', () => {
    const made = assembled(
      component(
        boundTable({
          columns: [
            { column: 'site', header: 'Site' },
            { column: 'depth', header: 'Depth' },
          ],
        }),
      ),
      new Map([['rows', held(result(['north', '1']))]]),
    );
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      { stage: 'bind', code: 'column_missing', node: NODE, block: 't1', detail: 'depth' },
    ]);
  });

  it("fails a bound table by name where its result is unresolved or unreadable, too long, or a format means nothing for its column's type", () => {
    const made = assembled(
      component(
        boundTable(),
        boundTable({ id: 't2', binding: whole('gone') }),
        boundTable({ id: 't3', binding: whole('broken') }),
        boundTable({ id: 't4', binding: whole('long') }),
        boundTable({
          id: 't5',
          binding: whole('rows2'),
          columns: [{ column: 'site', header: 'Site', format: { places: 2 } }],
        }),
      ),
      new Map<string, Held>([
        ['rows', held(result(['north', '1']))],
        ['rows2', held(result(['north', '1']))],
        ['broken', 'unreadable'],
        ['long', held(result(...Array.from({ length: TABLE_ROWS_MAX + 1 }, () => ['x', '1'])))],
      ]),
    );
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      { stage: 'bind', code: 'binding_unresolved', node: NODE, block: 't2', detail: 'gone' },
      { stage: 'bind', code: 'result_unreadable', node: NODE, block: 't3', detail: 'broken' },
      {
        stage: 'bind',
        code: 'table_too_long',
        node: NODE,
        block: 't4',
        detail: String(TABLE_ROWS_MAX + 1),
      },
      { stage: 'bind', code: 'format_mismatch', node: NODE, block: 't5', detail: 'site: places' },
    ]);
  });

  it('fails a bound table under a layout stored without its words by name, table_words_missing', () => {
    const older: Record<string, unknown> = { ...defaultLayout.words };
    delete older.noRows;
    delete older.notAvailable;
    delete older.source;
    const made = assemble({
      formats: ['pdf'],
      outline,
      occurrences: new Map([[NODE, component(boundTable())]]),
      bindings: new Map([[NODE, new Map([['rows', held(result(['north', '1']))]])]]),
      refused: [],
      layout: { ...defaultLayout, words: older as typeof defaultLayout.words },
      theme: resolved(),
      revision: '0.1',
      covers: () => true,
      assets: new Map(),
    });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      {
        stage: 'bind',
        code: 'table_words_missing',
        node: NODE,
        block: 't1',
        detail: 'noRows, notAvailable, source',
      },
    ]);
  });

  it('records each printed cell with the canonical value it was printed from, and each column with its format', () => {
    const made = assembled(
      component(boundTable()),
      new Map([['rows', held(result(['north', '0.125']))]]),
    );
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    expect(made.values).toEqual([
      {
        node: NODE,
        block: 't1',
        binding: 'rows',
        datasetVersion: '00000000-0000-4000-8000-0000000000d1',
        table: {
          columns: [
            { name: 'site', type: { base: 'text' }, header: 'Site', format: {} },
            {
              name: 'reading',
              type: COLUMNS[1]!.type,
              header: 'Reading (kPa)',
              format: { style: 'number', rounding: 'halfAwayFromZero', negative: 'minus' },
            },
          ],
          rows: [
            [
              { printed: 'north', value: 'north' },
              { printed: '0.13', value: '0.125' },
            ],
          ],
          notes: [],
        },
      },
    ]);
  });
});

describe("a bound table's notes published (the TB3 plan, TB3-B, TB3-C and TB3-E)", () => {
  const whole = (name: string) => {
    const each = { ...binding(name) } as Record<string, unknown>;
    delete each.take;
    return each;
  };
  const note = (name: string, anchor: Record<string, unknown>, words = `Note ${name}`) => ({
    type: 'footnote',
    id: name,
    anchor,
    content: [paragraph(`${name}p`, text(words))],
  });
  const keyed = (name: string, site: string, column = 'reading') =>
    note(name, { kind: 'keyed', key: { site }, column });
  const boundTable = (notes: unknown[], extra: Record<string, unknown> = {}) => ({
    type: 'boundTable',
    id: 't1',
    binding: whole('rows'),
    caption: [text('Readings')],
    columns: [
      { column: 'site', header: 'Site' },
      { column: 'reading', header: 'Reading' },
    ],
    headerColumn: false,
    sort: [{ column: 'reading', direction: 'descending', nulls: 'last' }],
    ...(notes.length === 0 ? {} : { notes }),
    ...extra,
  });
  const ROWS = result(['north', '1.5'], ['south', '7'], ['east', '3']);
  const tableOf = (made: ReturnType<typeof assemble>) => {
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const table = blocksOf((made.document as PublishedDocument).nodes).find(
      (block) => block.type === 'table',
    );
    if (table === undefined || table.type !== 'table') throw new Error('no table');
    return table;
  };
  const marks = (cell: { blocks: readonly PublishedBlock[] }) =>
    cell.blocks
      .flatMap((block) => (block.type === 'paragraph' ? block.runs : []))
      .flatMap((run) => ('tableMark' in run ? [run.tableMark] : []));
  const said = (paragraphs: readonly PublishedBlock[]) =>
    paragraphs
      .flatMap((block) => (block.type === 'paragraph' ? block.runs : []))
      .map((run) => ('text' in run ? run.text : ''))
      .join('');

  it('DAT-012 fails a keyed note on a definition declaring no key, key_required, naming the table and the definition', () => {
    const made = assembled(
      component(boundTable([keyed('n1', 'north'), note('n2', { kind: 'column', column: 'site' })])),
      new Map([['rows', held(ROWS, [])]]),
    );
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      { stage: 'bind', code: 'key_required', node: NODE, block: 't1', detail: QUERY },
    ]);
    // A column note asks for no key.
    const columns = assembled(
      component(boundTable([note('n2', { kind: 'column', column: 'site' })])),
      new Map([['rows', held(ROWS, [])]]),
    );
    expect(columns.ok).toBe(true);
  });

  it('DAT-048 fails a note whose row is gone, note_row_missing, naming the note, the key and the definition, gathered with every other failure', () => {
    const made = assembled(
      component(
        boundTable([keyed('n1', 'west'), keyed('n2', 'north'), keyed('n3', 'nowhere')]),
        boundTable([], {
          id: 't2',
          binding: whole('other'),
          columns: [{ column: 'depth', header: 'Depth' }],
          sort: undefined,
        }),
      ),
      new Map([
        ['rows', held(ROWS)],
        ['other', held(ROWS)],
      ]),
    );
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      {
        stage: 'bind',
        code: 'note_row_missing',
        node: NODE,
        block: 't1',
        detail: `n1: {"site":"west"}: ${QUERY}`,
      },
      {
        stage: 'bind',
        code: 'note_row_missing',
        node: NODE,
        block: 't1',
        detail: `n3: {"site":"nowhere"}: ${QUERY}`,
      },
      { stage: 'bind', code: 'column_missing', node: NODE, block: 't2', detail: 'depth' },
    ]);
  });

  it("says a note keyed by columns that are not the definition's key is gone for that reason", () => {
    const made = assembled(
      component(boundTable([note('n1', { kind: 'keyed', key: { reading: '7' }, column: 'site' })])),
      new Map([['rows', held(ROWS)]]),
    );
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      {
        stage: 'bind',
        code: 'note_row_missing',
        node: NODE,
        block: 't1',
        detail: `n1: {"reading":"7"}: ${QUERY}: the key is site`,
      },
    ]);
  });

  it("TAB-024 sets a keyed note's mark in its cell, a link to its note beneath the table, wherever the sort puts its row", () => {
    const table = tableOf(
      assembled(component(boundTable([keyed('n1', 'north')])), new Map([['rows', held(ROWS)]])),
    );
    // Sorted by reading, descending: south, east, north; north's reading carries the mark.
    expect(table.rows.map((row) => row.cells.map(marks))).toEqual([
      [[], []],
      [[], []],
      [[], []],
      [[], [{ letter: 'a', link: `b-${NODE}-n1` }]],
    ]);
    expect(table.notes.map((each) => [each.letter, each.anchor, said(each.paragraphs)])).toEqual([
      ['a', `b-${NODE}-n1`, 'Note n1'],
    ]);
  });

  it("TAB-025 sets a column note's mark in its header, a plain letter, lettered before the cells'", () => {
    const table = tableOf(
      assembled(
        component(
          boundTable([keyed('n1', 'east'), note('n2', { kind: 'column', column: 'reading' })]),
        ),
        new Map([['rows', held(ROWS)]]),
      ),
    );
    expect(marks(table.rows[0]!.cells[1]!)).toEqual([{ letter: 'a', link: null }]);
    expect(marks(table.rows[2]!.cells[1]!)).toEqual([{ letter: 'b', link: `b-${NODE}-n1` }]);
    expect(table.notes.map((each) => each.letter)).toEqual(['a', 'b']);
  });

  it("TAB-025 sets the whole table's note after the layout's word, and records each note's letter, row and column, never its key", () => {
    const made = assembled(
      component(boundTable([keyed('n1', 'north')], { note: [text('Taken at noon')] })),
      new Map([['rows', held(ROWS)]]),
    );
    const table = tableOf(made);
    expect(table.note?.map((run) => ('text' in run ? run.text : ''))).toEqual([
      'Note: ',
      'Taken at noon',
    ]);
    if (!made.ok) return;
    const [value] = made.values;
    // Its row among the rows printed, never the key's values, which the table need not print (M2).
    const notes = value && 'table' in value ? value.table.notes : undefined;
    expect(notes).toEqual([
      { note: 'n1', letter: 'a', row: expect.any(Number), column: 'reading' },
    ]);
    expect(JSON.stringify(notes)).not.toContain('north');
  });
});
