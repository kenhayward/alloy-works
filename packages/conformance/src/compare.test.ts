import { describe, expect, it } from 'vitest';

import {
  approved,
  compare,
  compareRules,
  EDITOR_DEVIATIONS,
  WORD_DEVIATIONS,
  type Difference,
} from './compare.js';
import type { Measured, MeasuredRules } from './measure.js';
import type { Token } from './styled.js';

const difference = (property: string, what: string): Difference => ({
  token: 'Ze1',
  what,
  property,
  editor: 'Cambria Math',
  pdf: 'STIX Two Math',
});

describe('the lists of approved deviations, one for each pair of outputs (the W15 plan, W15-H)', () => {
  it('approves nothing between the editor and the PDF, and between Word and the PDF only the maths face a theme names for Word', () => {
    const face = difference('maths face', "the equation's face");
    expect(EDITOR_DEVIATIONS).toEqual([]);
    expect(approved(face, EDITOR_DEVIATIONS)).toBe(false);
    expect(approved(face, WORD_DEVIATIONS)).toBe(true);
  });

  it('approves a difference only by its property and what it stands in together', () => {
    expect(approved(difference('maths face', 'a heading at depth 1'), WORD_DEVIATIONS)).toBe(false);
    expect(approved(difference('face', "the equation's face"), WORD_DEVIATIONS)).toBe(false);
  });
});

const at = (token: string, baseline: number, page = 1, x = 0): Measured => ({
  token,
  x,
  baseline,
  page,
  size: 11,
  family: 'Liberation Serif',
  bold: false,
  italic: false,
  colour: '#000000',
  underline: false,
  background: '#ffffff',
  line: [x, x + 20],
});
const byToken = (measured: readonly Measured[]) => new Map(measured.map((m) => [m.token, m]));
const flow = (text: string): Token => ({ text, where: 'flow', what: `a paragraph, ${text}` });
const cell = (text: string): Token => ({ text, where: 'cell', what: `a cell, ${text}` });

describe('the comparison, where one output breaks a page the other does not (the W15 plan, W15-G)', () => {
  it('compares a step only where both outputs set both lines on one page', () => {
    const tokens = [flow('Za1'), flow('Za2'), flow('Za3')];
    // The PDF sets all three on one page; the other output breaks its page before the second.
    const pdf = byToken([at('Za1', 100), at('Za2', 120), at('Za3', 140)]);
    const other = byToken([at('Za1', 700), at('Za2', 90, 2), at('Za3', 110.2, 2)]);
    const steps: string[] = [];
    const found = compare(tokens, other, pdf, () => 'start', (property) => steps.push(property));
    expect(found).toEqual([]);
    expect(steps.filter((each) => each.startsWith('step'))).toEqual(['step from Za2']);
  });

  it('compares no step into or out of a line the caller sets apart - a floated figure, an equation in another face', () => {
    const tokens = [flow('Za1'), flow('Za2'), flow('Za3'), flow('Za4')];
    const pdf = byToken([at('Za1', 100), at('Za2', 120), at('Za3', 140), at('Za4', 160)]);
    // The second line held open in the other output, by an equation's face.
    const other = byToken([at('Za1', 100), at('Za2', 130), at('Za3', 160), at('Za4', 180)]);
    const steps: string[] = [];
    const found = compare(
      tokens,
      other,
      pdf,
      () => 'start',
      (property) => steps.push(property),
      new Set(['Za2']),
    );
    expect(found).toEqual([]);
    expect(steps.filter((each) => each.startsWith('step'))).toEqual(['step from Za3']);
  });

  it("compares no edge of a cell where either output breaks the table's page beside it", () => {
    const rule = { at: 5, width: 1, colour: '#000000' };
    const rules: MeasuredRules = { top: rule, bottom: rule, left: rule, right: rule };
    // One column of two cells: the PDF sets both on one page, the other breaks its page between them
    // and frames each part in a rule of its own, which stands elsewhere.
    const pdf = byToken([at('Zc1', 100), at('Zc2', 120)]);
    const other = byToken([at('Zc1', 760), at('Zc2', 90, 2)]);
    const framed = { ...rule, at: 7, width: 2 };
    const found = compareRules(
      [cell('Zc1'), cell('Zc2')],
      new Map([
        ['Zc1', { ...rules, bottom: framed }],
        ['Zc2', { ...rules, top: framed }],
      ]),
      new Map([
        ['Zc1', rules],
        ['Zc2', rules],
      ]),
      other,
      pdf,
    );
    expect(found).toEqual([]);
  });
});
