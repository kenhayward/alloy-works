import { describe, expect, it } from 'vitest';

import { canonicalise } from '../content/model/canonical.js';
import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { applyConditions } from './conditions.js';

const text = (value: string) => ({ type: 'text', value, marks: [] });
const regulator = [{ axis: 'audience', values: ['regulator'] }];
const paragraph = (id: string, words: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(words)],
});
const table = (id: string, caption: string, over: object = {}) => ({
  type: 'table',
  id,
  style: 'table',
  caption: [text(caption)],
  headerRows: 0,
  headerColumns: 0,
  rows: [{ cells: [{ content: [paragraph(`${id}c`, 'Twelve sites')], colspan: 1, rowspan: 1 }] }],
  ...over,
});
const equation = (id: string, over: object = {}) => ({
  type: 'equation',
  id,
  mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
  numbered: true,
  ...over,
});
const figure = (id: string, over: object = {}) => ({
  type: 'figure',
  id,
  asset: '00000000-0000-4000-8000-0000000000f1',
  imageStyle: 'default',
  caption: [text('The site plan')],
  alternative: { kind: 'own', text: 'A plan of the site' },
  ...over,
});
const content = (...blocks: unknown[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Inspections',
    language: 'en-GB',
    direction: 'ltr',
    content: blocks,
  });

describe('conditions on a numbered block (the R11 plan, R11-B)', () => {
  it('REU-021 marks a table, a figure, a bound table or a block equation with conditions, held in its content and digest', () => {
    const marked = content(
      table('t1', 'Inspections', { conditions: regulator }),
      equation('e1', { conditions: regulator }),
      figure('f1', { conditions: regulator }),
    );
    expect(marked.content.map((block) => 'conditions' in block && block.conditions)).toEqual([
      regulator,
      regulator,
      regulator,
    ]);
    expect(canonicalise(marked)).not.toBe(
      canonicalise(content(table('t1', 'Inspections'), equation('e1'), figure('f1'))),
    );
    // A paragraph carries its conditions as marks, and none is no member.
    expect(() => content({ ...paragraph('p1', 'Kept.'), conditions: regulator })).toThrow();
    expect(() => content(table('t1', 'Inspections', { conditions: [] }))).toThrow();
  });

  it('REU-024 takes out a block its conditions do not select, with what it holds, and reports an axis the profile does not name', () => {
    const marked = content(
      paragraph('p1', 'Readings were taken daily.'),
      table('t1', 'Inspections by the regulator', { conditions: regulator }),
      equation('e1', { conditions: [{ axis: 'status', values: ['draft'] }] }),
      table('t2', 'Totals'),
    );
    const forStaff = applyConditions(marked, { audience: ['internal'] });
    expect(forStaff.content.content.map((block) => block.id)).toEqual(['p1', 't2']);
    expect(forStaff.removed).toEqual(['t1', 'e1']);
    expect(forStaff.excluded).toEqual(['Inspections by the regulator Twelve sites']);
    expect(forStaff.unset).toEqual([{ axis: 'status', block: 'e1' }]);

    const forRegulator = applyConditions(marked, { audience: ['regulator'], status: ['final'] });
    expect(forRegulator.content.content.map((block) => block.id)).toEqual(['p1', 't1', 't2']);
    // What is kept is returned without its conditions, which nothing downstream reads.
    expect(forRegulator.content.content[1]).not.toHaveProperty('conditions');
  });
});
