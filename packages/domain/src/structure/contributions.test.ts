import { unbound } from '../publishing/bind.js';
import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/document.js';

import { contributionsOf } from './contributions.js';

const MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';

const note = (id: string) => ({
  type: 'footnote',
  id,
  anchor: { kind: 'span' },
  content: [{ type: 'paragraph', id: `${id}p`, content: [{ type: 'text', value: 'A note' }] }],
});

const figure = (id: string) => ({
  type: 'figure',
  id,
  asset: '00000000-0000-4000-8000-00000000a551',
  imageStyle: 'wide',
  caption: [{ type: 'text', value: 'A caption', marks: [] }],
  alternative: { kind: 'decorative' },
});

describe('what a component contributes to the sequences', () => {
  it('takes every caption-bearing block and footnote in document order, wherever it is nested', () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          content: [{ type: 'text', value: 'Unpack it.' }, note('n1')],
        },
        figure('f1'),
        {
          type: 'table',
          id: 't1',
          caption: [{ type: 'text', value: 'Parts', marks: [] }],
          headerRows: 1,
          headerColumns: 0,
          note: [{ type: 'text', value: 'Sizes vary.' }, note('n3')],
          rows: [
            {
              cells: [
                { content: [{ type: 'paragraph', id: 'c1', content: [note('n2')] }] },
                { content: [{ type: 'paragraph', id: 'c2', content: [] }] },
              ],
            },
          ],
        },
        // A cell holds paragraphs and lists alone (tables 1, decision T-D), so the equation that stood
        // in one stands after the table.
        { type: 'equation', id: 'e1', mathml: MATHML, numbered: true },
        { type: 'list', id: 'l1', kind: 'ordered', items: [{ content: [figure('f2')] }] },
        {
          type: 'blockquote',
          id: 'q1',
          content: [{ type: 'equation', id: 'e2', mathml: MATHML, numbered: false }],
          attribution: [note('n4')],
        },
        { type: 'preformatted', id: 'x1', text: 'lpr -P office' },
      ],
    });
    // The table before its cells, a cell's footnote lettered in the table's own sequence and its
    // note's in none (TB3-D), and an unnumbered equation said so.
    expect(contributionsOf(unbound(content))).toEqual([
      { block: 'n1', sequence: 'footnote', numbered: true },
      { block: 'f1', sequence: 'figure', numbered: true, caption: 'A caption' },
      { block: 't1', sequence: 'table', numbered: true, caption: 'Parts' },
      { block: 'n2', sequence: 'tableNote', numbered: true, table: 't1', letter: 'a' },
      { block: 'e1', sequence: 'equation', numbered: true },
      { block: 'f2', sequence: 'figure', numbered: true, caption: 'A caption' },
      { block: 'e2', sequence: 'equation', numbered: false },
      { block: 'n4', sequence: 'footnote', numbered: true },
    ]);
  });

  it('contributes nothing for a component of paragraphs alone', () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [{ type: 'paragraph', id: 'p1', content: [] }],
    });
    expect(contributionsOf(unbound(content))).toEqual([]);
  });
});

describe('a bound table, numbered as the table its stage sets (the TB1 plan, TB1-D)', () => {
  const words = (value: string) => ({ type: 'text', value, marks: [] });
  const caption = [words('Depths '), note('n1')];
  const bound = {
    type: 'boundTable',
    id: 't2',
    binding: {
      type: 'binding',
      id: 'k1',
      query: '00000000-0000-4000-8000-00000000d001',
      parameters: {},
      mode: 'checked',
    },
    caption,
    columns: [{ column: 'depth', header: 'Depth' }],
    headerColumn: false,
    note: [words('At noon'), note('n2')],
    source: [words('Survey'), note('n3')],
  };
  /** The table the stage will set in its place: its caption, a body of values, its note, its source. */
  const asSet = {
    type: 'table',
    id: 't2',
    caption,
    headerRows: 1,
    headerColumns: 0,
    rows: [{ cells: [{ content: [{ type: 'paragraph', id: 'c1', content: [words('Depth')] }] }] }],
    note: [words('At noon'), note('n2'), words(' Survey'), note('n3')],
  };
  const authored = (id: string) => ({
    ...asSet,
    id,
    caption: [words(id)],
    note: undefined,
    rows: [{ cells: [{ content: [{ type: 'paragraph', id: `${id}c`, content: [words('A')] }] }] }],
  });
  const of = (table: unknown) =>
    contributionsOf(
      unbound(
        parseContentDocument({
          schemaVersion: 1,
          title: 'Readings',
          language: 'en-GB',
          direction: 'ltr',
          content: [authored('t1'), table, figure('f1'), authored('t3')],
        }),
      ),
    );

  it('contributes as the authored table it becomes, so the page numbers it as the publish will', () => {
    const contributed = of(bound);
    expect(contributed).toEqual(of(asSet));
    expect(contributed.filter((each) => each.sequence === 'table')).toEqual([
      { block: 't1', sequence: 'table', numbered: true, caption: 't1' },
      { block: 't2', sequence: 'table', numbered: true, caption: 'Depths ' },
      { block: 't3', sequence: 'table', numbered: true, caption: 't3' },
    ]);
  });

  it('takes no number where its author marked it unnumbered', () => {
    expect(of({ ...bound, numbered: false }).find((each) => each.block === 't2')).toMatchObject({
      numbered: false,
    });
  });
});
