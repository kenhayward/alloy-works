import { widthDrawnTables } from '@alloy-works/editor';
import { describe, expect, it } from 'vitest';

/**
 * A table drawn outside the editor's content - a bound table's grid, or the read text's every table -
 * given its widths as a column group (the TG plan, TG3; the TG3 final review).
 */

const drawn = () => {
  const figure = document.createElement('figure');
  figure.dataset.tableStyle = 'table';
  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr><td>N1</td><td>A long reading</td></tr></tbody>';
  figure.append(table);
  document.body.append(figure);
  return { figure, table };
};

describe('a drawn table widthed (TG3)', () => {
  it('TAB-053 sets a column group of its shares, measured once however often it is asked', () => {
    const { figure, table } = drawn();
    let measured = 0;
    const seen = new WeakSet<HTMLTableElement>();
    const measure = () => {
      measured += 1;
      return [0.2, 0.8];
    };
    widthDrawnTables(figure, '[data-table-style] table', measure, seen);
    widthDrawnTables(figure, '[data-table-style] table', measure, seen);
    expect(measured).toBe(1);
    const columns = [...table.querySelectorAll(':scope > colgroup > col')] as HTMLElement[];
    expect(columns.map((each) => each.style.width)).toEqual(['20%', '80%']);
    figure.remove();
  });

  it('sets none, and takes away any set before, where its style shares the measure equally', () => {
    const { figure, table } = drawn();
    widthDrawnTables(figure, '[data-table-style] table', () => [0.5, 0.5]);
    widthDrawnTables(figure, '[data-table-style] table', () => undefined);
    expect(table.querySelector('colgroup')).toBeNull();
    figure.remove();
  });
});
