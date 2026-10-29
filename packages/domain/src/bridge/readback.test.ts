import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Block, DecomposedDocument, Inline, Table } from '@kenhayward/bridge-contract';
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../content/model/index.js';

import { mapDocument } from './document.js';
import { elementIdFor } from './ids.js';
import { readBack, type WrittenDocument } from './readback.js';

const require = createRequire(import.meta.url);
const ASSET = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
const EQUATION_ASSET = '0d6b3c55-2f1a-4e7b-9c8d-6a5f4e3d2c1b';
const VERSION = '3b1f6a52-9c04-4d7e-a1b8-52e6f0c97d34';
const PERSISTENT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const text = (value: string, ...marks: ('superscript' | 'bold')[]): Inline => ({
  kind: 'text',
  text: value,
  marks,
});
const para = (id: string, ...inlines: Inline[]): Block => ({ kind: 'paragraph', id, inlines });
const cellOf = (...blocks: Block[]) => ({
  rowSpan: 1,
  colSpan: 1,
  hAlign: 'left' as const,
  vAlign: 'top' as const,
  header: false,
  blocks,
});
const table = (id: string, over: Partial<Table>): Table => ({
  kind: 'table',
  id,
  numbered: true,
  caption: [],
  captionPosition: 'above',
  columnWidths: [],
  headerRows: 0,
  rows: [],
  notes: [],
  wide: false,
  key: null,
  ...over,
});
const documentOf = (over: Partial<DecomposedDocument>): DecomposedDocument => ({
  blocks: [],
  sections: [],
  images: [],
  equations: [],
  notes: [],
  properties: [],
  report: [],
  ...over,
});

/** A document mapped and stored as the delivery writes it, every reference pinned. */
function stored(document: DecomposedDocument, assets = new Map<string, string>()) {
  const mapped = mapDocument(document, { persistentId: PERSISTENT, title: 'Report', assets });
  const pins = new Map(mapped.components.map((each) => [each.artifactId, VERSION]));
  const components = new Map<string, ContentDocument>(
    mapped.components.map((each) => [each.artifactId, each.content]),
  );
  return {
    persistentId: PERSISTENT,
    outline: mapped.outline(pins),
    components,
    assets,
    carried: mapped.carried,
  } satisfies WrittenDocument;
}

const fixture = (): DecomposedDocument => {
  const path = join(
    dirname(dirname(require.resolve('@kenhayward/bridge-contract'))),
    'test',
    'fixtures',
    'package-decomposed.json',
  );
  return (JSON.parse(readFileSync(path, 'utf8')) as { document: DecomposedDocument }).document;
};

/** A document holding what the mapping changes on purpose: breaks, notes, cross-references, equations. */
function rich() {
  const notes: Table['notes'] = [
    { marker: '1)', inlines: [text('First note')] },
    { marker: '2)', inlines: [text('Second'), { kind: 'break' }, text('line')] },
    { marker: 'a', inlines: [text('Named nowhere')] },
    { marker: 'b', inlines: [text('Named twice')] },
  ];
  const noted = table('t1', {
    caption: [text('Results')],
    notes,
    rows: [
      {
        cells: [
          cellOf(para('c1', text('Dose'), text('1)2)', 'superscript'))),
          cellOf(para('c2', text('Rate'), text('b', 'superscript'))),
        ],
      },
      {
        cells: [
          cellOf(para('c3', text('5'))),
          cellOf(para('c4', text('7'), text('b', 'superscript'))),
        ],
      },
    ],
  });
  const flattened = table('t2', {
    rows: [
      {
        cells: [
          cellOf(
            para('o1', text('Outer')),
            table('inner', { rows: [{ cells: [cellOf(para('i1', text('In 1')))] }] }),
          ),
        ],
      },
    ],
  });
  const document = documentOf({
    blocks: [para('lead', text('Before'), { kind: 'break' }, text('after'))],
    sections: [
      {
        id: 's1',
        title: [],
        blocks: [
          para(
            'p1',
            text('See '),
            { kind: 'xref', targetId: 'elsewhere', text: 'the annex' },
            text(' and '),
            { kind: 'xref', targetId: 'p2', text: 'below' },
            { kind: 'note_ref', noteId: 'n1' },
          ),
          para('p2', text('Then '), { kind: 'inline_equation', equationId: 'e1' }),
          { kind: 'equation', id: 'eq', equationId: 'e2' },
          {
            kind: 'figure',
            id: 'f1',
            imageId: 'i1',
            numbered: true,
            caption: [text('A plot')],
            captionPosition: 'below',
          },
          noted,
          flattened,
        ],
        sections: [{ id: 's2', title: [text('Two')], blocks: [], sections: [] }],
      },
    ],
    images: [
      {
        id: 'i1',
        contentType: 'image/png',
        widthMm: 10,
        heightMm: 5,
        align: 'center',
        alt: 'a plot',
        origin: 'embedded',
        originalContentType: null,
      },
      {
        id: 'ie',
        contentType: 'image/png',
        widthMm: 10,
        heightMm: 5,
        align: 'inline',
        alt: null,
        origin: 'rendered',
        originalContentType: null,
      },
    ],
    equations: [
      { id: 'e1', mathml: '<math><mi>x</mi></math>', latex: 'x', imageId: 'ie' },
      { id: 'e2', mathml: null, latex: 'y = 2', imageId: 'ie' },
    ],
    notes: [{ id: 'n1', blocks: [para('n1p', text('A note'), { kind: 'break' }, text('more'))] }],
  });
  const assets = new Map([
    ['i1', ASSET],
    ['ie', EQUATION_ASSET],
  ]);
  return { document, assets };
}

describe('reading a delivery back', () => {
  it('the package fixture reads back as it was sent', () => {
    const document = fixture();
    const assets = new Map(document.images.map((image) => [image.id, ASSET]));
    expect(readBack(document, stored(document, assets))).toEqual({
      ok: true,
      at: null,
      detail: null,
    });
  });

  it('a word stored otherwise is the first difference, by its unit', () => {
    const document = documentOf({
      sections: [
        { id: 's1', title: [text('One')], blocks: [para('p1', text('Hello'))], sections: [] },
      ],
    });
    const read = stored(document);
    const [component] = read.components.values();
    const changed: ContentDocument = {
      ...component!,
      content: [{ type: 'paragraph', id: component!.content[0]!.id, style: 'body', content: [] }],
    };
    read.components.set([...read.components.keys()][0]!, changed);
    expect(readBack(document, read)).toEqual({
      ok: false,
      at: 'text[1]',
      detail: 'sent "Hello", read nothing',
    });
  });

  it('a cell stored otherwise is a grid that differs', () => {
    const grid = table('t1', { rows: [{ cells: [cellOf(para('c1', text('A')))] }] });
    const document = documentOf({ blocks: [grid] });
    const read = stored(document);
    const [id, component] = [...read.components.entries()][0]!;
    const node = component.content[0] as Extract<
      ContentDocument['content'][number],
      { type: 'table' }
    >;
    read.components.set(id, {
      ...component,
      content: [{ ...node, rows: [{ cells: [{ ...node.rows[0]!.cells[0]!, colspan: 2 }] }] }],
    });
    expect(readBack(document, read)).toEqual({
      ok: false,
      at: 'table t1',
      detail: 'the table grid differs',
    });
  });

  it('what the mapping does on purpose still reads back as sent', () => {
    const { document, assets } = rich();
    const read = stored(document, assets);
    expect(read.carried.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'title_from_text',
        'xref_outside',
        'note_anchored_table',
        'table_flattened',
        'equation_image_only',
      ]),
    );
    expect(readBack(document, read)).toEqual({ ok: true, at: null, detail: null });
  });

  it.each([
    'First note',
    'line',
    'Named nowhere',
    'Named twice',
    'more',
    'after',
    'Results',
    'the annex',
    'In 1',
  ])('the words %j stored otherwise are a difference', (words) => {
    const { document, assets } = rich();
    const read = stored(document, assets);
    for (const [id, component] of read.components) {
      const json = JSON.stringify(component);
      read.components.set(id, JSON.parse(json.replaceAll(words, `${words}!`)) as ContentDocument);
    }
    expect(readBack(document, read).ok).toBe(false);
  });

  it('a cross-reference stored with another target is a difference', () => {
    const { document, assets } = rich();
    const read = stored(document, assets);
    const retarget = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(retarget);
      if (typeof value !== 'object' || value === null) return value;
      const node = Object.fromEntries(
        Object.entries(value).map(([key, each]) => [key, retarget(each)]),
      );
      return node['type'] === 'crossReference'
        ? { ...node, target: { kind: 'node', node: elementIdFor(PERSISTENT, 's2') } }
        : node;
    };
    for (const [id, component] of read.components) {
      read.components.set(id, retarget(component) as ContentDocument);
    }
    expect(readBack(document, read).ok).toBe(false);
  });

  it('MathML stored otherwise is a difference', () => {
    const { document, assets } = rich();
    const read = stored(document, assets);
    for (const [id, component] of read.components) {
      const json = JSON.stringify(component).replaceAll('x</mi>', 'z</mi>');
      read.components.set(id, JSON.parse(json) as ContentDocument);
    }
    expect(JSON.stringify([...read.components.values()])).toContain('z</mi>');
    expect(readBack(document, read).ok).toBe(false);
  });

  it('a note no footnote holds is a difference', () => {
    const document = documentOf({
      blocks: [para('p1', text('Text'))],
      notes: [{ id: 'n1', blocks: [para('n1p', text('Orphan'))] }],
    });
    expect(readBack(document, stored(document))).toMatchObject({
      ok: false,
      at: 'text[1]',
    });
  });
});
