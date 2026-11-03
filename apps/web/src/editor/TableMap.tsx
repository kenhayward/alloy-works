import type { TableCursor, TableGrid } from '@alloy-works/editor';
import { useId, type CSSProperties, type KeyboardEvent } from 'react';

import { inlineKey } from '../parts/inline.js';
import styles from './TablePanel.module.css';
import { words } from '../words/words.js';

/** The most rows the map draws: past this, those around the cursor's row (ADR-0079). */
const ROWS_SHOWN = 9;
/** Past this many columns only the header row keeps its words. */
const COLUMNS_WITH_WORDS = 12;

/** Which rows it draws: all, or nine around the row the cursor is in, so that row is always drawn. */
export function rowsWindow(rows: number, at: number): { first: number; last: number } {
  if (rows <= ROWS_SHOWN) return { first: 0, last: rows };
  const first = Math.max(0, Math.min(at - Math.floor(ROWS_SHOWN / 2), rows - ROWS_SHOWN));
  return { first, last: first + ROWS_SHOWN };
}

/**
 * **The Table tab's map** (ADR-0079): a grid of the table, a cell's span drawn as its span, its header
 * cells and first column in words and the rest as a bar as long as its words. It is one tab stop: the
 * arrows move the cursor through the table with the focus staying here, Shift and an arrow selects
 * cells, and Enter goes to the text. A press moves the cursor and leaves the focus on the text, Shift
 * and a press selecting. Without `onChoose` it only reads, as a table of text.
 */
export function TableMap({
  grid,
  cursor,
  onChoose,
  onEnter,
}: {
  readonly grid: TableGrid;
  readonly cursor: TableCursor | null;
  /** Moves the cursor there; absent while the table can only be read. */
  readonly onChoose?: ((row: number, column: number, extend: boolean) => void) | undefined;
  readonly onEnter?: (() => void) | undefined;
}) {
  const id = useId();
  const inCell = cursor?.where === 'cell' ? cursor : null;
  const { first, last } = rowsWindow(grid.rows, inCell?.row ?? 0);
  const selected = inCell?.selected ?? null;
  const covers = (cell: TableGrid['cells'][number]) =>
    selected !== null
      ? cell.row < selected.bottom &&
        cell.row + cell.rowSpan > selected.top &&
        cell.column < selected.right &&
        cell.column + cell.colSpan > selected.left
      : inCell !== null && cell.row === inCell.row && cell.column === inCell.column;
  const cellId = (row: number, column: number) => `${id}-${row}-${column}`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (onChoose === undefined) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter?.();
      return;
    }
    const row = inCell?.row ?? 0;
    const column = inCell?.column ?? 0;
    const move: Record<string, readonly [number, number]> = {
      ArrowUp: [row - 1, column],
      ArrowDown: [row + (inCell?.rowSpan ?? 1), column],
      ArrowLeft: [row, column - 1],
      ArrowRight: [row, column + (inCell?.colSpan ?? 1)],
    };
    const to = move[inlineKey(event.key)];
    if (to === undefined) return;
    event.preventDefault();
    const [toRow, toColumn] = to;
    if (toRow < 0 || toColumn < 0 || toRow >= grid.rows || toColumn >= grid.columns) return;
    onChoose(toRow, toColumn, event.shiftKey);
  };
  const interactive = onChoose !== undefined;
  const above = first;
  const below = grid.rows - last;
  return (
    <div className={styles['map']}>
      {above > 0 && (
        <p className={styles['mapMore']}>{words('editor.table-more-rows', { count: above })}</p>
      )}
      <div
        role={interactive ? 'grid' : 'table'}
        aria-label={words('editor.table-map')}
        aria-rowcount={grid.rows}
        aria-colcount={grid.columns}
        className={styles['mapGrid']}
        style={{ '--map-columns': grid.columns } as CSSProperties}
        {...(interactive
          ? {
              tabIndex: 0,
              onKeyDown,
              ...(inCell === null
                ? {}
                : { 'aria-activedescendant': cellId(inCell.row, inCell.column) }),
            }
          : {})}
      >
        {Array.from({ length: last - first }, (_, index) => first + index).map((row) => (
          <div key={row} role="row" aria-rowindex={row + 1} className={styles['mapRow']}>
            {grid.cells
              .filter((cell) => cell.row === row || (row === first && cell.row < first))
              .filter((cell) => cell.row + cell.rowSpan > first)
              .map((cell) => {
                const top = Math.max(cell.row, first);
                const bottom = Math.min(cell.row + cell.rowSpan, last);
                const withWords =
                  (cell.row === 0 && cell.header) ||
                  (cell.column === 0 && grid.columns <= COLUMNS_WITH_WORDS);
                return (
                  <div
                    key={`${cell.row}-${cell.column}`}
                    id={cellId(cell.row, cell.column)}
                    role={interactive ? 'gridcell' : 'cell'}
                    aria-colindex={cell.column + 1}
                    aria-label={cell.words === '' ? words('editor.table-map-empty') : cell.words}
                    {...(cell.colSpan > 1 ? { 'aria-colspan': cell.colSpan } : {})}
                    {...(cell.rowSpan > 1 ? { 'aria-rowspan': cell.rowSpan } : {})}
                    {...(interactive ? { 'aria-selected': covers(cell) } : {})}
                    className={styles['mapCell']}
                    data-header={cell.header}
                    data-current={covers(cell)}
                    style={{
                      gridRow: `${top - first + 1} / ${bottom - first + 1}`,
                      gridColumn: `${cell.column + 1} / span ${cell.colSpan}`,
                    }}
                    {...(interactive
                      ? {
                          onMouseDown: (event: { preventDefault: () => void }) =>
                            event.preventDefault(),
                          onClick: (event: { shiftKey: boolean }) =>
                            onChoose(cell.row, cell.column, event.shiftKey),
                        }
                      : {})}
                  >
                    {withWords ? (
                      <span className={styles['mapWords']} data-content>
                        {cell.words}
                      </span>
                    ) : cell.words === '' ? null : (
                      <span
                        className={styles['mapBar']}
                        style={{ width: `${Math.min(80, 20 + cell.words.length * 2)}%` }}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      {below > 0 && (
        <p className={styles['mapMore']}>{words('editor.table-more-rows', { count: below })}</p>
      )}
    </div>
  );
}
