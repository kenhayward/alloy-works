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
