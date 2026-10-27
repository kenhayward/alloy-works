import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  publishedImagePath,
  PUBLISHING_SCHEMA_1,
  readTheme,
  writeHtml,
  type AssembleInput,
  type PublishingAsset,
} from '@alloy-works/domain';
import { renderContent } from '@alloy-works/editor';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';

/**
 * The HTML writer's markup against the editor's (the HT plan, HT-C): each kind both draw, written
 * from the published document and rendered by `renderContent` from the stored one, so the theme's CSS
 * projection reads the same elements in both. Invented content only.
 */

const RED = '00000000-0000-4000-8000-00000000a551';
const RED_ASSET: PublishingAsset = {
  object: `t_acme/sha256/${'ab'.repeat(32)}`,
  format: 'png',
  width: 800,
  height: 600,
  alternative: { text: 'Two red squares', language: 'en-GB' },
};
const MATH =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x plus one"><mi>x</mi><mo>+</mo><mn>1</mn></math>';

const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const paragraph = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const cell = (id: string, value: string) => ({
  content: [paragraph(id, text(value))],
  colspan: 1,
  rowspan: 1,
});

/** Every kind both draw, each block identified. */
const CONTENT = {
  schemaVersion: 1,
  title: 'Calibration',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    paragraph(
      'p1',
      text('See '),
      text('the report', { type: 'hyperlink', id: 'k1', href: 'https://example.test/r' }),
      text(', '),
      text('both', { type: 'emphasis', id: 'k2' }, { type: 'strong', id: 'k3' }),
      text(', H'),
      text('2', { type: 'subscript', id: 'k4' }),
      text('O, '),
      text('printer.cfg', { type: 'inlineCode', id: 'k5' }),
      text(' and '),
      text('la mesure', { type: 'language', id: 'k6', tag: 'fr-FR' }),
      text('.'),
    ),
    {
      type: 'list',
      id: 'l1',
      kind: 'ordered',
      start: 3,
      format: 'alphabetic',
      items: [{ content: [paragraph('p2', text('Unbox it.'))] }],
    },
    {
      type: 'list',
      id: 'l2',
      kind: 'unordered',
      items: [{ content: [paragraph('p3', text('Plug it in.'))] }],
    },
    {
      type: 'list',
      id: 'l3',
      kind: 'definition',
      items: [{ term: [text('Level')], content: [paragraph('p4', text('How full it is.'))] }],
    },
    { type: 'preformatted', id: 'c1', text: 'print(1)', language: 'python' },
    {
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('p5', text('Measure twice.'))],
      attribution: [text('Grace')],
    },
    {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings')],
      headerRows: 1,
      headerColumns: 0,
      rows: [
        { cells: [cell('t1a', 'Site'), cell('t1b', 'Level')] },
        { cells: [cell('t1c', 'York'), cell('t1d', '12')] },
      ],
    },
    {
      type: 'figure',
      id: 'f1',
      asset: RED,
      imageStyle: 'figure',
      caption: [text('Shapes at rest')],
      alternative: { kind: 'inherited' },
    },
    paragraph(
      'p6',
      text('Press '),
      { type: 'image', asset: RED, imageStyle: 'inline', alternative: { kind: 'inherited' } },
      text(' and let '),
      { type: 'equation', mathml: MATH },
      text(' rise.'),
    ),
    { type: 'equation', id: 'e1', mathml: MATH, numbered: true },
  ],
};

const read = readTheme(
  DEFAULT_PRESENTATION.theme.content,
  new Map(DEFAULT_PRESENTATION.theme.catalogues.map((each) => [each.versionId, each.content])),
);
if (!read.ok) throw new Error('the default theme does not read');
const THEME = read.theme;

/** The writer's body for that content, published alone in one section. */
function written(): Document {
  const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
  const assembled = assemble({
    formats: ['html'],
    refused: [],
    layout: defaultLayout,
    theme: THEME,
    revision: '0.7',
    covers: () => true,
    assets: new Map([[RED, RED_ASSET]]),
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: 'calib'.padEnd(26, 'a'),
          component: '00000000-0000-4000-8000-000000000001',
          mode: { kind: 'latest' },
          ...positional,
          children: [],
        },
      ],
    }),
    occurrences: new Map([['calib'.padEnd(26, 'a'), parseContentDocument(CONTENT)]]),
  } as unknown as AssembleInput);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  if (assembled.document.schema === PUBLISHING_SCHEMA_1) throw new Error('assembled as schema 1');
  const faces = new Map<string, Uint8Array>();
  for (const face of THEME.typefaces.values()) {
    for (const file of face.files) faces.set(file.sha256, Uint8Array.of(0, 1, 0, 0));
  }
  const writing = writeHtml({
    document: assembled.document,
    html: assembled.html!,
    faces,
    images: new Map([[publishedImagePath(RED_ASSET), Uint8Array.of(0x89, 0x50, 0x4e, 0x47)]]),
    subset: (bytes) => bytes,
  });
  if (!writing.ok) throw new Error(JSON.stringify(writing.failures));
  return new DOMParser().parseFromString(new TextDecoder().decode(writing.bytes), 'text/html');
}

/**
 * What the projection and the read text find an element by: its tag, its classes and its `data-`
 * attributes, a list's `start` and an equation's `display`. Not the editor's alone: its asset route
 * and a mark's stored identity, which the published document does not carry, nor the sentence the
 * editor gives an image whose description it inherits, where the writer has the description itself.
 */
const NOT_SHARED = new Set(['data-asset', 'data-mark-id', 'contenteditable', 'src', 'style', 'id']);
function significant(element: Element): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const { name, value } of element.attributes) {
    if (NOT_SHARED.has(name)) continue;
    if (name === 'class' || name.startsWith('data-') || ['start', 'display'].includes(name)) {
      kept[name] = value;
    }
  }
  return kept;
}

/** The style a paragraph's place sets a stored `body` in. */
const defaultAt = (element: Element): string | undefined =>
  THEME.places[element.getAttribute('data-place') as keyof typeof THEME.places];

const describeElement = (element: Element) =>
  `<${element.localName}${Object.entries(significant(element))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')}>`;

describe("the HTML writer's markup against the editor's (the HT plan, HT-C)", () => {
  it('writes every element the editor renders for each kind both draw, in order, with its classes and data', () => {
    const editor = renderContent(CONTENT, document);
    if (editor === null) throw new Error('the editor renders nothing');
    const host = document.createElement('div');
    host.append(editor);
    const writer = [...written().querySelectorAll('.aw-canvas *')];
    let at = 0;
    const missing: string[] = [];
    for (const element of host.querySelectorAll('*')) {
      // MathML's own elements are the maths tree's, compared by the writer's own tests (HT-H).
      if (element.closest('math') !== null && element.localName !== 'math') continue;
      const wanted = significant(element);
      const found = writer.findIndex(
        (each, index) =>
          index >= at &&
          each.localName === element.localName &&
          Object.entries(wanted).every(([name, value]) =>
            name === 'class'
              ? value.split(' ').every((one) => each.classList.contains(one))
              : name === 'data-style' && value === 'body'
                ? // A stored `body` the published document may resolve to the default where it
                  // stands (TH-E), which the projection sets by the same rule either way.
                  [value, defaultAt(each)].includes(each.getAttribute(name) ?? '')
                : each.getAttribute(name) === value,
          ),
      );
      if (found === -1) missing.push(describeElement(element));
      else at = found + 1;
    }
    expect(missing).toEqual([]);
  });

  it('identifies every block it writes by `data-block`, as the read text does', () => {
    const editor = renderContent(CONTENT, document);
    const host = document.createElement('div');
    host.append(editor!);
    const blocks = (root: ParentNode) =>
      [...root.querySelectorAll('[data-block]')].map((each) => [
        each.localName,
        each.getAttribute('data-block'),
      ]);
    expect(blocks(written())).toEqual(blocks(host));
  });
});
