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
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import { resolved } from '../theme/theme.fixture.js';

import { assemble } from './assemble.js';
import { bind, type Held } from './bind.js';
import { defaultLayout } from './layout.js';
import type { PublishedBlock, PublishedNode } from './published.js';

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
const held = (r: CanonicalResult): Held => ({
  result: r,
  columns: COLUMNS,
  datasetVersion: '00000000-0000-4000-8000-0000000000d1',
  images: {},
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
      figure('f1', binding('i2', at('south'))),
      // A decorative figure is still taken by its definition's rule, which reads the row's description.
      figure('f2', binding('i3', at('south')), { kind: 'decorative' }),
    );
    const results = new Map(['i1', 'i2', 'i3'].map((each) => [each, photos(...ROWS)]));
    const expected = [
      ['p1', 'i1'],
      ['f1', 'i2'],
      ['f2', 'i3'],
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
      undefined,
    ]);
    const made = assembled(content, results);
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures.filter((each) => each.stage === 'bind')).toEqual(expected);
  });

  it("fails a figure's binding taking anything but an image, value_not_image, and an image bound in a footnote's text, image_not_placeable", () => {
    const content = component(
      figure('f1', binding('v1', at('north', 'caption'))),
      paragraph('p1', text('Gate'), {
        type: 'footnote',
        id: 'n1',
        anchor: { kind: 'span' },
        content: [paragraph('np1', binding('i1', at('north')))],
      }),
    );
    const results = new Map(['v1', 'i1'].map((each) => [each, photos(...ROWS)]));
    const { failures } = bind(NODE, content, results, DEFAULT_VALUE_FORMATS);
    expect(failures).toEqual([
      { stage: 'bind', code: 'value_not_image', node: NODE, block: 'f1', detail: 'v1' },
      { stage: 'bind', code: 'image_not_placeable', node: NODE, block: 'np1', detail: 'i1' },
    ]);
  });
});
