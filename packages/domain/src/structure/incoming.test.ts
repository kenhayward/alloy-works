import { describe, expect, it } from 'vitest';

import type { BlockNode } from '../content/model/blocks.js';
import type { CrossReferenceTarget, InlineNode } from '../content/model/inline.js';

import { incomingReferences } from './incoming.js';
import type { OutlineViewNode } from './outline.js';

/** A node identifier in the 26-character spelling, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');

/** Two components, by invented names. */
const ADA = '0b9a6c1e-2f3d-4a5b-8c7d-6e5f4a3b2c1d';
const GRACE = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const positional = {
  numbered: true,
  matter: 'body' as const,
  pageBreak: 'none' as const,
  values: {},
};

const section = (
  name: string,
  title: InlineNode[] | string,
  children: OutlineViewNode[] = [],
): OutlineViewNode => ({
  type: 'section',
  id: id(name),
  title: typeof title === 'string' ? [{ type: 'text', value: title, marks: [] }] : title,
  ...positional,
  children,
});

/** An occurrence of `component`, or of one the reader may not read where it is `null`. */
const occurrence = (
  name: string,
  component: string | null,
  children: OutlineViewNode[] = [],
): OutlineViewNode => ({
  type: 'reference',
  id: id(name),
  component,
  mode: { kind: 'latest' },
  ...positional,
  children,
});

const xref = (reference: string, target: CrossReferenceTarget): InlineNode => ({
  type: 'crossReference',
  id: reference,
  target,
  display: 'number',
});
const toNode = (name: string): CrossReferenceTarget => ({ kind: 'node', node: id(name) });
const paragraph = (block: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id: block,
  style: 'body',
  content,
});
const figure = (block: string): BlockNode =>
  ({
    type: 'figure',
    id: block,
    image: { asset: 'sha256:'.padEnd(71, '0'), mediaType: 'image/png' },
    alternative: { kind: 'decorative' },
    caption: [{ type: 'text', value: 'The tray', marks: [] }],
  }) as unknown as BlockNode;

const at = (references: readonly { from: string; reference: string }[]) =>
  references.map((each) => `${each.from.replace(/a+$/, '')}:${each.reference}`);

describe('what in its own document references a node', () => {
  it('STR-074 finds every reference to a node or to a block in it, from a section title or any text, in document order', () => {
    const outline = {
      nodes: [
        section('intro', [
          { type: 'text', value: 'See ', marks: [] },
          xref('t1', toNode('method')),
        ]),
        section('method', 'Method', [occurrence('ada', ADA)]),
        occurrence('grace', GRACE),
      ],
    };
    const occurrences = new Map<string, readonly BlockNode[]>([
      [id('ada'), [figure('f1'), paragraph('p1', xref('own', { kind: 'block', block: 'f1' }))]],
      [
        id('grace'),
        [
          paragraph(
            'p1',
            xref('g1', toNode('method')),
            xref('g2', { kind: 'component', component: ADA, block: 'f1' }),
            {
              type: 'footnote',
              id: 'n1',
              anchor: { kind: 'inline' },
              content: [paragraph('np', xref('g3', toNode('ada')))],
            } as unknown as InlineNode,
          ),
        ],
      ],
    ]);
    const incoming = incomingReferences({ outline, occurrences });

    // Method: its title's, and a reference to it and into what it holds, from outside it alone.
    expect(at(incoming(id('method')))).toEqual(['intro:t1', 'grace:g1', 'grace:g2', 'grace:g3']);
    // The occurrence: its figure and itself, never its own reference to its own figure.
    expect(incoming(id('ada'))).toEqual([
      { from: id('grace'), reference: 'g2', node: id('ada'), block: 'f1' },
      { from: id('grace'), reference: 'g3', node: id('ada'), block: null },
    ]);
    expect(incoming(id('intro'))).toEqual([]);
  });

  it('STR-074 counts no reference it cannot bind: a component placed twice, a block not there, a node not in the outline', () => {
    const outline = {
      nodes: [occurrence('ada', ADA), occurrence('again', ADA), occurrence('grace', GRACE)],
    };
    const occurrences = new Map<string, readonly BlockNode[]>([
      [id('ada'), [figure('f1')]],
      [id('again'), [figure('f1')]],
      [
        id('grace'),
        [
          paragraph(
            'p1',
            xref('g1', { kind: 'component', component: ADA, block: 'f1' }),
            xref('g2', { kind: 'block', block: 'nowhere' }),
            xref('g3', toNode('gone')),
          ),
        ],
      ],
    ]);
    const incoming = incomingReferences({ outline, occurrences });
    expect([id('ada'), id('again'), id('grace')].flatMap(incoming)).toEqual([]);
  });

  it('STR-074 never counts a reference in text it was not given, or binds one to an occurrence it may not read', () => {
    // Grace's occurrence is withheld: its component is not named, and its text is not given.
    const outline = {
      nodes: [section('method', 'Method'), occurrence('grace', null), occurrence('ada', ADA)],
    };
    const occurrences = new Map<string, readonly BlockNode[]>([
      [
        id('ada'),
        [paragraph('p1', xref('a1', { kind: 'component', component: GRACE, block: 'f1' }))],
      ],
    ]);
    const incoming = incomingReferences({ outline, occurrences });
    expect(incoming(id('method'))).toEqual([]);
    expect(incoming(id('grace'))).toEqual([]);
  });
});
