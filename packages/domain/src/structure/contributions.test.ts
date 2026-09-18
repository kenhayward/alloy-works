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
  asset: 'asset',
  imageStyle: 'wide',
  caption: 'A caption',
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
          caption: 'Parts',
          headerRows: 1,
          headerColumns: 0,
          note: [{ type: 'text', value: 'Sizes vary.' }, note('n3')],
          rows: [
            {
              cells: [
                { content: [{ type: 'paragraph', id: 'c1', content: [note('n2')] }] },
                { content: [{ type: 'equation', id: 'e1', mathml: MATHML, numbered: true }] },
              ],
            },
          ],
        },
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
    // The table before its cells, its cells before its note, and an unnumbered equation said so.
    expect(contributionsOf(content)).toEqual([
      { block: 'n1', sequence: 'footnote', numbered: true },
      { block: 'f1', sequence: 'figure', numbered: true },
      { block: 't1', sequence: 'table', numbered: true },
      { block: 'n2', sequence: 'footnote', numbered: true },
      { block: 'e1', sequence: 'equation', numbered: true },
      { block: 'n3', sequence: 'footnote', numbered: true },
      { block: 'f2', sequence: 'figure', numbered: true },
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
    expect(contributionsOf(content)).toEqual([]);
  });
});
