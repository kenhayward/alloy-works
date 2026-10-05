import {
  formatsFor,
  formatValue,
  DEFAULT_VALUE_FORMATS,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  type CanonicalResult,
  type Column,
  type ContentDocument,
  type Held,
  type ResolvedTheme,
  type ValueCatalogue,
  type ValueFormats,
  type ValueType,
} from '@alloy-works/domain';

import { defaultTheme } from './theme.js';

/**
 * **The Word check's fixture holding values** (the B3 plan, "The Word check ... gains a fixture
 * holding a value"): one component whose bindings stand in a paragraph, a table's caption, its cells,
 * its note and a footnote, every one held by one stored result, and printed by a value catalogue
 * whose formats for English differ from the default's in every separator, a date's order and padding
 * and a boolean's words - so that a value printed in the default's formats, or in the catalogue's own
 * rather than its language's, shows. Pure, so that the worker's suite holds it in CI as well as the
 * Word check does where Word is.
 */

/** Formats unlike the default in every member a number, a date and a boolean print by. */
export const VALUE_FORMATS: ValueFormats = {
  number: { decimal: ',', group: '.', groupFrom: 4, minus: 'U+2212' },
  date: { order: 'dmy', separator: '/', pad: false },
  time: { separator: '.' },
  boolean: { true: 'Affirmed', false: 'Withheld' },
};

/**
 * The value catalogue: the default's formats as its own, and `VALUE_FORMATS` for English, which the
 * document is written in - so a value printed by the catalogue's own formats shows as well.
 */
const catalogue: ValueCatalogue = {
  schemaVersion: 3,
  kind: 'value',
  formats: DEFAULT_VALUE_FORMATS,
  byLanguage: [{ language: 'en', formats: VALUE_FORMATS }],
};

/** The default theme with that catalogue in place of its own. */
export const valuesTheme: ResolvedTheme = { ...defaultTheme, valueCatalogue: catalogue };

/** The result's columns, declared as a dataset version's provenance declares them. */
const COLUMNS: readonly Column[] = [
  { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 12, scale: 2 } },
  { name: 'ratio', from: { column: 'ratio' }, type: { base: 'decimal', precision: 6, scale: 3 } },
  { name: 'count', from: { column: 'count' }, type: { base: 'integer' } },
  { name: 'change', from: { column: 'change' }, type: { base: 'integer' } },
  { name: 'measured', from: { column: 'measured' }, type: { base: 'date' } },
  { name: 'checked', from: { column: 'checked' }, type: { base: 'date' } },
  { name: 'passed', from: { column: 'passed' }, type: { base: 'boolean' } },
  { name: 'failed', from: { column: 'failed' }, type: { base: 'boolean' } },
];

/** One row, each value canonical in its column's type (ADR-0035). */
const RESULT: CanonicalResult = {
  columns: COLUMNS.map((column) => [column.name, column.type.base] as const),
  rows: [['-1234567.5', '0.25', '9876543', '-42', '2026-07-04', '2026-03-05', true, false]],
};

/** Where a value stands in the component, as the Word check reads each place back. */
export type ValuePlace = 'paragraph' | 'caption' | 'cell' | 'note' | 'footnote';

/** Each binding: its identifier, the column it takes and where it stands, in the binding stage's order. */
const BOUND: readonly {
  readonly id: string;
  readonly column: string;
  readonly place: ValuePlace;
}[] = [
  { id: 'vdepth', column: 'depth', place: 'paragraph' },
  { id: 'vpassed', column: 'passed', place: 'paragraph' },
  { id: 'vmeasured', column: 'measured', place: 'caption' },
  { id: 'vchange', column: 'change', place: 'note' },
  { id: 'vcount', column: 'count', place: 'cell' },
  { id: 'vchecked', column: 'checked', place: 'cell' },
  { id: 'vratio', column: 'ratio', place: 'footnote' },
  { id: 'vfailed', column: 'failed', place: 'footnote' },
];

/** The query definition every binding names; nothing reads it, since the result is held. */
const QUERY = '00000000-0000-4000-8000-000000000099';
const binding = (name: string) => {
  const { column } = BOUND.find((each) => each.id === name)!;
  return {
    type: 'binding',
    id: name,
    query: QUERY,
    parameters: {},
    mode: 'pinned',
    take: { column },
  };
};
const text = (value: string) => ({ type: 'text', value, marks: [] });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});
const cell = (name: string, ...inlines: unknown[]) => ({
  content: [paragraph(name, ...inlines)],
  colspan: 1,
  rowspan: 1,
});

/** The occurrence's node, and its outline: one numbered chapter, under the cover and the contents. */
export const VALUES_NODE = 'valuesoccurrence'.padEnd(26, 'a');
export const valuesOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The gauge report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    {
      type: 'section',
      id: 'valuessection'.padEnd(26, 'a'),
      title: [text('Gauges')],
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [
        {
          type: 'reference',
          id: VALUES_NODE,
          component: '00000000-0000-4000-8000-000000000098',
          mode: { kind: 'latest' },
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          children: [],
        },
      ],
    },
  ],
});

/** The component, every binding where `BOUND` places it. */
export const valuesComponent: ContentDocument = parseContentDocument({
  schemaVersion: 1,
  title: 'Gauge readings',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    paragraph(
      'vp1',
      text('The depth at the north gauge was '),
      binding('vdepth'),
      text(' metres; its seal was '),
      binding('vpassed'),
      text('.'),
    ),
    {
      type: 'table',
      id: 'VT',
      style: 'table',
      caption: [text('Counts on '), binding('vmeasured')],
      headerRows: 1,
      headerColumns: 0,
      note: [text('Change since the last reading: '), binding('vchange'), text('.')],
      rows: [
        { cells: [cell('vh1', text('Count')), cell('vh2', text('Checked on'))] },
        { cells: [cell('vc1', binding('vcount')), cell('vc2', binding('vchecked'))] },
      ],
    },
    paragraph(
      'vp2',
      text('The ratio is noted below.'),
      {
        type: 'footnote',
        id: 'VF',
        anchor: { kind: 'span' },
        content: [
          paragraph(
            'vf1',
            text('A ratio of '),
            binding('vratio'),
            text(', its second seal '),
            binding('vfailed'),
            text('.'),
          ),
        ],
      },
      text(' Nothing more was read.'),
    ),
  ],
});

/** The occurrences `assemble` is handed. */
export const valuesOccurrences = new Map<string, ContentDocument>([[VALUES_NODE, valuesComponent]]);

/** The binding stage's input: every binding's result, held as the worker holds one it read. */
export const valuesBindings: ReadonlyMap<string, ReadonlyMap<string, Held>> = new Map([
  [
    VALUES_NODE,
    new Map<string, Held>(
      BOUND.map((each) => [
        each.id,
        {
          result: RESULT,
          columns: COLUMNS,
          datasetVersion: '00000000-0000-4000-8000-000000000097',
        },
      ]),
    ),
  ],
]);

/**
 * Every value the fixture prints, in the component's order: where it stands, what `formatValue`
 * prints for it in the formats the document's language takes from the catalogue, and what the
 * default's formats would print instead.
 */
export const VALUES: readonly {
  readonly binding: string;
  readonly place: ValuePlace;
  readonly printed: string;
  readonly byDefault: string;
}[] = BOUND.map((each) => {
  const at = COLUMNS.findIndex((column) => column.name === each.column);
  const value = RESULT.rows[0]![at]! as string | boolean;
  const type = COLUMNS[at]!.type as ValueType;
  return {
    binding: each.id,
    place: each.place,
    printed: formatValue(value, type, formatsFor(catalogue, valuesOutline.language)),
    byDefault: formatValue(value, type, DEFAULT_VALUE_FORMATS),
  };
});
