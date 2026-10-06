import { describe, expect, it } from 'vitest';

import { canonicalise } from '../content/model/canonical.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from '../content/model/document.js';
import { inlineNodeSchema } from '../content/model/inline.js';
import {
  bindingDigestInput,
  bindingsIn,
  checkTake,
  literalValues,
  type Binding,
} from './binding.js';
import type { QueryDefinition } from './definition.js';

/** A query definition's and one of its versions' identifiers, invented. */
const QUERY = '00000000-0000-4000-8000-00000000d001';
const VERSION = '00000000-0000-4000-8000-00000000d002';

/** A decomposed accent, built from its code point so no editor can fold it. */
const ACUTE = String.fromCharCode(0x301);

const binding = (over: Record<string, unknown> = {}) => ({
  type: 'binding',
  id: 'k1',
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'depth' },
  ...over,
});

const admitted = (value: unknown) => inlineNodeSchema.safeParse(value).success;

const paragraph = (id: string, content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});

const words = (value: string) => ({ type: 'text', value, marks: [] });

const doc = (content: unknown[]) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'A component',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

describe('a binding in a component', () => {
  it("DAT-029 holds a binding's definition, its parameters and the value it takes, or refuses it by rule", () => {
    const held = inlineNodeSchema.parse(
      binding({
        version: VERSION,
        parameters: {
          site: { literal: 'north' },
          ids: { literal: ['1', '2'] },
          active: { literal: true },
          since: { literal: null },
          region: { document: 'region' },
        },
        take: { key: { id: '7' }, column: 'depth' },
      }),
    );
    expect(held).toEqual({
      type: 'binding',
      id: 'k1',
      query: QUERY,
      version: VERSION,
      parameters: {
        site: { literal: 'north' },
        ids: { literal: ['1', '2'] },
        active: { literal: true },
        since: { literal: null },
        region: { document: 'region' },
      },
      mode: 'checked',
      take: { key: { id: '7' }, column: 'depth' },
    });
    // A pinned one, floating at the definition's latest, with no parameters.
    expect(admitted(binding({ mode: 'pinned', parameters: {} }))).toBe(true);
    // Without its definition, its parameters, its mode or what it takes, it is refused.
    for (const member of ['query', 'parameters', 'mode', 'take', 'id']) {
      const rest: Record<string, unknown> = binding();
      delete rest[member];
      expect(admitted(rest), member).toBe(false);
    }
    // And it never holds a value (CNT-030).
    expect(admitted(binding({ value: '42' }))).toBe(false);
  });

  it('DAT-067 refuses an inline binding that names neither a single-row column nor a key and a column, when it is written', () => {
    expect(admitted(binding({ take: { column: 'depth' } }))).toBe(true);
    expect(admitted(binding({ take: { key: { id: '7' }, column: 'depth' } }))).toBe(true);
    for (const take of [
      {},
      { key: { id: '7' } },
      { row: 0, column: 'depth' },
      { key: { id: '7' }, column: 'depth', row: 0 },
      { key: {}, column: 'depth' },
      { column: '' },
      'depth',
      null,
    ]) {
      expect(admitted(binding({ take })), JSON.stringify(take)).toBe(false);
    }
    const untaken: Record<string, unknown> = binding();
    delete untaken.take;
    expect(admitted(untaken)).toBe(false);
  });

  it('refuses each member of the stored shape that breaks its rule', () => {
    // The identifier.
    expect(admitted(binding({ id: '' }))).toBe(false);
    // The definition and its version: lower-case UUIDs.
    for (const query of ['q-1', QUERY.toUpperCase(), '']) {
      expect(admitted(binding({ query })), query).toBe(false);
    }
    for (const version of ['v-1', VERSION.toUpperCase(), '']) {
      expect(admitted(binding({ version })), version).toBe(false);
    }
    // The parameters: by a parameter's name, at most 50, each a literal or a document's parameter.
    const many = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, at) => [`p${at}`, { literal: String(at) }]),
      );
    expect(admitted(binding({ parameters: many(50) }))).toBe(true);
    expect(admitted(binding({ parameters: many(51) }))).toBe(false);
    for (const parameters of [
      { Site: { literal: 'north' } },
      { '1site': { literal: 'north' } },
      { site: { literal: 42 } },
      { site: { literal: {} } },
      { site: 'north' },
      { site: { literal: 'north', document: 'site' } },
      { site: { document: 'Region' } },
      { site: { document: '' } },
      { site: {} },
      { ids: { literal: [] } },
      { ids: { literal: ['1', null] } },
      { ids: { literal: [['1']] } },
      { ids: { literal: Array.from({ length: 51 }, (_, at) => String(at)) } },
      { site: { literal: 'x'.repeat(1001) } },
      { site: { literal: `a${String.fromCharCode(0)}b` } },
    ]) {
      expect(admitted(binding({ parameters })), JSON.stringify(parameters)).toBe(false);
    }
    expect(
      admitted(binding({ parameters: { ids: { literal: Array.from({ length: 50 }, String) } } })),
    ).toBe(true);
    // The mode.
    expect(admitted(binding({ mode: 'live' }))).toBe(false);
    // The take: a column a source's name; a key of 1 to 32 columns, each value a value and never null.
    const keyOf = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, at) => [`k${at}`, String(at)]));
    expect(admitted(binding({ take: { key: keyOf(32), column: 'depth' } }))).toBe(true);
    for (const take of [
      { key: keyOf(33), column: 'depth' },
      { key: { id: null }, column: 'depth' },
      { key: { id: 7 }, column: 'depth' },
      { key: { id: ['7'] }, column: 'depth' },
      { key: { '': '7' }, column: 'depth' },
      { column: 'x'.repeat(64) },
      { column: `de${String.fromCharCode(1)}pth` },
    ]) {
      expect(admitted(binding({ take })), JSON.stringify(take)).toBe(false);
    }
  });

  it('refuses a binding holding any string not in NFC, which the canonical form would fold into another', () => {
    const decomposed = `cafe${ACUTE}`;
    const composed = decomposed.normalize('NFC');
    expect(admitted(binding({ parameters: { site: { literal: composed } } }))).toBe(true);
    for (const over of [
      { parameters: { site: { literal: decomposed } } },
      { parameters: { ids: { literal: ['1', decomposed] } } },
      { take: { column: decomposed } },
      { take: { key: { [decomposed]: '7' }, column: 'depth' } },
      { take: { key: { id: decomposed }, column: 'depth' } },
    ]) {
      expect(admitted(binding(over)), JSON.stringify(over)).toBe(false);
    }
    // The identifier is held to NFC by the walk, as every identifier in a component is.
    expect(() =>
      parseContentDocument(doc([paragraph('b1', [words('Depth '), binding({ id: decomposed })])])),
    ).toThrow(/NFC/);
  });

  it("holds a binding's identifier unique among the component's identifiers", () => {
    expect(() =>
      parseContentDocument(doc([paragraph('b1', [words('Depth '), binding({ id: 'b1' })])])),
    ).toThrow(/more than once/);
    expect(() =>
      parseContentDocument(
        doc([paragraph('b1', [binding({ id: 'k1' })]), paragraph('b2', [binding({ id: 'k1' })])]),
      ),
    ).toThrow(/more than once/);
  });

  it('digests a list under a parameter named marks in its order, for the content and for the binding', () => {
    // The content model's set rule sorts an array under a member named `marks`. A parameter's list is
    // under `literal`, so a parameter named `marks` never reaches the rule as an array.
    const holding = (list: string[]) =>
      parseContentDocument(
        doc([paragraph('b1', [binding({ parameters: { marks: { literal: list } } })])]),
      );
    const one = holding(['b', 'a']);
    const other = holding(['a', 'b']);
    expect(canonicalise(one)).not.toEqual(canonicalise(other));
    const [first] = bindingsIn(one);
    const [second] = bindingsIn(other);
    expect(bindingDigestInput(first!.binding)).not.toEqual(bindingDigestInput(second!.binding));
  });

  it('digests every member of a binding, its identifier and its mode among them', () => {
    const base = inlineNodeSchema.parse(binding()) as Binding;
    const digest = bindingDigestInput(base);
    expect(bindingDigestInput({ ...base })).toEqual(digest);
    for (const over of [
      { id: 'k2' },
      { mode: 'pinned' },
      { version: VERSION },
      { parameters: { site: { literal: 'south' } } },
      { take: { column: 'height' } },
      { query: '00000000-0000-4000-8000-00000000d003' },
    ]) {
      expect(bindingDigestInput({ ...base, ...over } as Binding), JSON.stringify(over)).not.toEqual(
        digest,
      );
    }
    // The members' order is not a difference.
    const reordered = {
      take: base.take,
      mode: base.mode,
      parameters: base.parameters,
      query: base.query,
      id: base.id,
      type: base.type,
    } as Binding;
    expect(bindingDigestInput(reordered)).toEqual(digest);
  });

  it('finds every binding in a component, wherever component content admits an inline', () => {
    const note = {
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [paragraph('fp1', [binding({ id: 'in-note' })])],
    };
    const stored = parseContentDocument(
      doc([
        paragraph('b1', [words('Depth '), binding({ id: 'in-paragraph' }), note]),
        {
          type: 'list',
          id: 'l1',
          kind: 'definition',
          items: [
            {
              term: [binding({ id: 'in-term' })],
              content: [paragraph('b2', [binding({ id: 'in-item' })])],
            },
          ],
        },
        {
          type: 'blockquote',
          id: 'q1',
          content: [paragraph('b3', [words('Quoted.')])],
          attribution: [binding({ id: 'in-attribution' })],
        },
        {
          type: 'table',
          id: 't1',
          caption: [binding({ id: 'in-caption' })],
          note: [binding({ id: 'in-table-note' })],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  rowspan: 1,
                  colspan: 1,
                  content: [paragraph('c1', [binding({ id: 'in-cell' })])],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(bindingsIn(stored).map(({ binding, path }) => [binding.id, path])).toEqual([
      ['in-paragraph', 'content.0.content.1'],
      ['in-note', 'content.0.content.2.content.0.content.0'],
      ['in-term', 'content.1.items.0.term.0'],
      ['in-item', 'content.1.items.0.content.0.content.0'],
      ['in-attribution', 'content.2.attribution.0'],
      ['in-caption', 'content.3.caption.0'],
      ['in-table-note', 'content.3.note.0'],
      ['in-cell', 'content.3.rows.0.cells.0.content.0.content.0'],
    ]);
    // Placed in a line everywhere but a footnote's text, where an image may not stand (B6-D).
    expect(bindingsIn(stored).map(({ place }) => place)).toEqual([
      'line',
      'footnote',
      'line',
      'line',
      'line',
      'line',
      'line',
      'line',
    ]);
  });

  it("DAT-098 finds a figure's binding, placed as its image, before its caption's", () => {
    const stored = parseContentDocument(
      doc([
        {
          type: 'figure',
          id: 'f1',
          binding: binding({ id: 'as-figure', take: { column: 'site_photo' } }),
          imageStyle: 'figure',
          caption: [words('Site '), binding({ id: 'in-figure-caption' })],
          alternative: { kind: 'inherited' },
        },
      ]),
    );
    expect(bindingsIn(stored).map(({ binding, path, place }) => [binding.id, path, place])).toEqual(
      [
        ['as-figure', 'content.0.binding', 'figure'],
        ['in-figure-caption', 'content.0.caption.1', 'line'],
      ],
    );
  });
});

describe('what a binding takes, against the definition it resolves to', () => {
  const definition = {
    columns: [
      { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
      { name: 'site', from: { column: 'site' }, type: { base: 'text' } },
      {
        name: 'depth',
        from: { column: 'depth' },
        type: { base: 'decimal', precision: 6, scale: 2 },
      },
    ],
    key: ['id', 'site'],
  } as unknown as QueryDefinition;

  it("takes a declared column, or a declared column of the row the definition's whole key names", () => {
    expect(checkTake({ column: 'depth' }, definition)).toBeNull();
    expect(checkTake({ key: { site: 'north', id: '7' }, column: 'depth' }, definition)).toBeNull();
  });

  it("refuses a column not declared, a key that is not the definition's, and a key value not canonical", () => {
    expect(checkTake({ column: 'height' }, definition)).toMatch(/height/);
    expect(checkTake({ key: { id: '7' }, column: 'depth' }, definition)).toMatch(/key/);
    expect(
      checkTake({ key: { id: '7', site: 'north', depth: '1' }, column: 'depth' }, definition),
    ).toMatch(/key/);
    expect(checkTake({ key: { id: '07', site: 'north' }, column: 'depth' }, definition)).toMatch(
      /id/,
    );
    expect(checkTake({ key: { id: true, site: 'north' }, column: 'depth' }, definition)).toMatch(
      /id/,
    );
    const keyless = { ...definition, key: [] } as unknown as QueryDefinition;
    expect(checkTake({ key: { id: '7' }, column: 'depth' }, keyless)).toMatch(/key/);
    expect(checkTake({ key: { id: '7', site: 'north' }, column: 'height' }, definition)).toMatch(
      /height/,
    );
  });
});

describe('the values a binding runs with', () => {
  it('answers its literals by name, and the first parameter it takes from the document', () => {
    const literal = inlineNodeSchema.parse(
      binding({ parameters: { site: { literal: 'north' }, ids: { literal: ['1', '2'] } } }),
    ) as Binding;
    expect(literalValues(literal)).toEqual({ values: { site: 'north', ids: ['1', '2'] } });
    // A parameter named `document` is a literal like any other.
    const named = inlineNodeSchema.parse(
      binding({ parameters: { document: { literal: 'region' } } }),
    ) as Binding;
    expect(literalValues(named)).toEqual({ values: { document: 'region' } });
    const fromDocument = inlineNodeSchema.parse(
      binding({ parameters: { site: { literal: 'north' }, region: { document: 'region' } } }),
    ) as Binding;
    expect(literalValues(fromDocument)).toEqual({ document: 'region' });
  });
});
