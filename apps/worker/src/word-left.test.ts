import { describe, expect, it } from 'vitest';

import { unheld, type Found, type Left } from './testing/word-left.js';

/**
 * **What W15.2 left, held exactly** (the final review of W15.2): Word's measurement names each kind of
 * difference it leaves and must fail on anything else - so a kind holds how many it measured, the
 * largest of each length and no other property, and, where it is held difference by difference, each
 * by name, a colour only so. Run in CI, where Word's measurement itself is skipped.
 */
const found = (
  theme: string,
  token: string,
  property: string,
  editor: number | string,
  pdf: number | string,
  left: string | null = 'tables',
): Found => ({ theme, token, what: `a cell, ${token}`, property, editor, pdf, left });

const tables: Left = {
  kind: 'tables',
  route: "Word's side",
  holds: () => true,
  count: 2,
  largest: { step: 8.12, 'fill top': 7.2 },
};
const colours: Left = {
  kind: 'colours',
  route: "Word's side",
  holds: () => true,
  count: 1,
  largest: {},
  named: ['Default: Zt21 bottom rule colour'],
};
const measured = [
  found('Default', 'Zt14', 'step from Zt13', 21.96, 21),
  found('Contrary', 'Zt11', 'fill top', 14.91, 12.25),
  found('Default', 'Zt21', 'bottom rule colour', '#1c1e0f', '#18232a', 'colours'),
];

describe("Word's measurement, what W15.2 left held exactly", () => {
  it('holds a run that found exactly what each kind measured', () => {
    expect(unheld(measured, [tables, colours])).toEqual([]);
  });

  it('fails on a colour a kind does not name, as every table rule drawn red would be', () => {
    const red = found('Default', 'Zt11', 'top rule colour', '#ff0000', '#000000', 'colours');
    expect(unheld([...measured, red], [tables, colours])).toEqual([
      'colours: 2 differences, where 1 were measured',
      'colours: not named, Default: Zt11 top rule colour',
    ]);
  });

  it("fails on a difference that is not a length in a kind held by its lengths, as a cell's background under white paper would be", () => {
    const white = found('Default', 'Zt21', 'background', '#ffffff', '#fdfaf2');
    expect(unheld([...measured.slice(0, 1), white, measured[2]!], [tables, colours])).toEqual([
      'tables: not a length, Default: Zt21 background',
    ]);
  });

  it('fails on a length of a property its kind does not name, never reading a missing largest as nought', () => {
    const wider = found('Default', 'Zt11', 'fill left', 0.9, 0);
    expect(unheld([measured[0]!, wider, measured[2]!], [tables, colours])).toEqual([
      'tables: a property it does not name, Default: Zt11 fill left',
    ]);
  });

  it('fails on one difference more of a kind, though under its largest, and on one fewer', () => {
    const more = found('Generated 1 (1301)', 'Zt22', 'step from Zt21', 22, 21.5);
    expect(unheld([...measured, more], [tables, colours])).toEqual([
      'tables: 3 differences, where 2 were measured',
    ]);
    expect(unheld(measured.slice(1), [tables, colours])).toEqual([
      'tables: 1 differences, where 2 were measured',
    ]);
  });

  it('fails on a length past its kind largest, and on a named difference not found', () => {
    const past = found('Default', 'Zt14', 'step from Zt13', 31, 21);
    expect(unheld([past, measured[1]!], [tables, colours])).toEqual([
      'tables: Default: Zt14 step from Zt13 by 10, past 8.12',
      'colours: 0 differences, where 1 were measured',
      'colours: named and not found, Default: Zt21 bottom rule colour',
    ]);
  });

  it('fails on a difference of no kind', () => {
    const none = found('Default', 'Zp01', 'start', 3, 1, null);
    expect(unheld([...measured, none], [tables, colours])).toEqual([
      'of no kind: Default: Zp01 start',
    ]);
  });
});
