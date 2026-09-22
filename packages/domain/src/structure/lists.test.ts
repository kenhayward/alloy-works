import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/document.js';

import { contributionsOf, type Contribution } from './contributions.js';
import { contents, listOf } from './lists.js';
import { conditions, number, resolve, type NumberableNode } from './numbering.js';
import { defaultNumberingScheme } from './scheme.js';

const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>a</mi></math>';

/** A node identifier in the 26-character spelling, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');

const title = (value: string) => [{ type: 'text' as const, value, marks: [] }];

const section = (
  name: string,
  children: NumberableNode[] = [],
  over: Partial<NumberableNode> = {},
): NumberableNode => ({
  type: 'section',
  id: id(name),
  numbered: true,
  matter: 'body',
  title: title(name),
  children,
  ...over,
});

const reference = (name: string, over: Partial<NumberableNode> = {}): NumberableNode => ({
  type: 'reference',
  id: id(name),
  numbered: true,
  matter: 'body',
  children: [],
  ...over,
});

const figure = (block: string, caption: string) => ({
  type: 'figure',
  id: block,
  asset: 'asset',
  imageStyle: 'wide',
  caption: caption === '' ? [] : [{ type: 'text', value: caption, marks: [] }],
  alternative: { kind: 'decorative' },
});

/** What a component holding these blocks contributes, through the content model's own parse. */
const holding = (...content: unknown[]) =>
  contributionsOf(
    parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content,
    }),
  );

/** The pipeline in its order, and the stage and table both lists read. */
const pipeline = (nodes: NumberableNode[], known: Record<string, readonly Contribution[]> = {}) => {
  const conditioned = conditions(
    resolve({ nodes }, new Map(Object.entries(known).map(([name, list]) => [id(name), list]))),
  );
  return { conditioned, numbering: number(conditioned, defaultNumberingScheme) };
};

describe('a table of contents', () => {
  const outline = [
    section('preface', [], { numbered: false }),
    section('method', [
      section('scope', [section('sample', [section('deeper')])]),
      reference('printer'),
    ]),
    section('glossary', [section('terms')], { matter: 'appendix' }),
  ];

  it('STR-040 is generated to a declared depth, each entry naming its node, number, title and depth', () => {
    const { conditioned, numbering } = pipeline(outline);
    expect(contents(conditioned, numbering, 1)).toEqual([
      {
        node: id('preface'),
        type: 'section',
        depth: 1,
        matter: 'body',
        number: null,
        title: title('preface'),
      },
      {
        node: id('method'),
        type: 'section',
        depth: 1,
        matter: 'body',
        number: '1',
        title: title('method'),
      },
      {
        node: id('glossary'),
        type: 'section',
        depth: 1,
        matter: 'appendix',
        number: 'A',
        title: title('glossary'),
      },
    ]);
    const two = contents(conditioned, numbering, 2);
    expect(two.map((entry) => [entry.node, entry.depth, entry.number, entry.matter])).toEqual([
      [id('preface'), 1, null, 'body'],
      [id('method'), 1, '1', 'body'],
      [id('scope'), 2, '1.1', 'body'],
      [id('printer'), 2, '1.2', 'body'],
      [id('glossary'), 1, 'A', 'appendix'],
      // 'terms' takes the appendix's own matter, not the 'body' its own node carries by default -
      // a child of an appendix section is in the appendix.
      [id('terms'), 2, 'A.1', 'appendix'],
    ]);
    // A reference's heading is its component's title, which the domain does not read.
    expect(two.find((entry) => entry.node === id('printer'))).toMatchObject({
      type: 'reference',
      title: null,
    });
    expect(contents(conditioned, numbering, 9)).toHaveLength(8);
  });

  it('refuses a depth that is not a whole number of at least one', () => {
    const { conditioned, numbering } = pipeline(outline);
    expect(() => contents(conditioned, numbering, 0)).toThrow(RangeError);
    expect(() => contents(conditioned, numbering, 1.5)).toThrow(RangeError);
  });

  it('is empty for an outline of no nodes', () => {
    const { conditioned, numbering } = pipeline([]);
    expect(contents(conditioned, numbering, 3)).toEqual([]);
  });
});

describe('a list of figures, of tables or of equations', () => {
  const printer = holding(
    figure('f1', 'The tray'),
    {
      type: 'table',
      id: 't1',
      caption: [{ type: 'text', value: 'Parts', marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [{ type: 'paragraph', id: 'c1', content: [] }] }] }],
    },
    { type: 'equation', id: 'e1', mathml: MATHML, numbered: true },
    { type: 'equation', id: 'e2', mathml: MATHML, numbered: false },
    figure('f2', ''),
  );

  // A second occurrence's own content, its figure's block id ('f1') the same as printer's but its
  // caption different - so a lookup keyed by block alone, rather than by occurrence and block, would
  // show one occurrence's caption on the other's row.
  const printerAgain = holding(
    figure('f1', 'The paper tray'),
    {
      type: 'table',
      id: 't1',
      caption: [{ type: 'text', value: 'Parts', marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [{ type: 'paragraph', id: 'c1', content: [] }] }] }],
    },
    { type: 'equation', id: 'e1', mathml: MATHML, numbered: true },
    { type: 'equation', id: 'e2', mathml: MATHML, numbered: false },
    figure('f2', ''),
  );

  it('STR-041 generates a list of figures, a list of tables and a list of equations', () => {
    const { conditioned, numbering } = pipeline(
      [section('one', [reference('first')]), section('two', [reference('again')])],
      { first: printer, again: printerAgain },
    );
    expect(listOf(conditioned, numbering, 'figure')).toEqual([
      { node: id('first'), block: 'f1', number: '1.1', label: 'Figure 1.1', caption: 'The tray' },
      { node: id('first'), block: 'f2', number: '1.2', label: 'Figure 1.2', caption: '' },
      {
        node: id('again'),
        block: 'f1',
        number: '2.1',
        label: 'Figure 2.1',
        caption: 'The paper tray',
      },
      { node: id('again'), block: 'f2', number: '2.2', label: 'Figure 2.2', caption: '' },
    ]);
    expect(listOf(conditioned, numbering, 'table')).toEqual([
      { node: id('first'), block: 't1', number: '1.1', label: 'Table 1.1', caption: 'Parts' },
      { node: id('again'), block: 't1', number: '2.1', label: 'Table 2.1', caption: 'Parts' },
    ]);
    // An unnumbered equation is not in the list: it takes no number, so it is no entry.
    expect(listOf(conditioned, numbering, 'equation')).toEqual([
      { node: id('first'), block: 'e1', number: '1', label: 'Equation 1', caption: null },
      { node: id('again'), block: 'e1', number: '2', label: 'Equation 2', caption: null },
    ]);
    // Sections are not a list of anything a component holds.
    expect(listOf(conditioned, numbering, 'section')).toEqual([]);
  });

  it('lists what an occurrence nobody here can read would have moved without a number, and nothing it holds', () => {
    const { conditioned, numbering } = pipeline(
      [section('one', [reference('first'), reference('unknown'), reference('again')])],
      { first: printer, again: printer },
    );
    expect(
      listOf(conditioned, numbering, 'figure').map((entry) => [
        entry.node,
        entry.label,
        entry.caption,
      ]),
    ).toEqual([
      [id('first'), 'Figure 1.1', 'The tray'],
      [id('first'), 'Figure 1.2', ''],
      [id('again'), null, 'The tray'],
      [id('again'), null, ''],
    ]);
  });
});
