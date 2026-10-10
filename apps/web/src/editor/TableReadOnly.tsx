import type { BoundTablePlace, TableAt } from '@alloy-works/editor';
import { useState, type ReactNode } from 'react';

import { Chip } from '../parts/Chip.js';
import { usePresentation } from '../theme/presentation.js';
import { tableChoices } from '../theme/StyleChoice.js';
import { BOUND_TABLE_WORDS, Fold, noteOnWords } from './BoundTablePanel.js';
import styles from './BoundTablePanel.module.css';

/** Yes or no, in words. */
const yes = (value: boolean) => (value ? 'Yes' : 'No');

/** A table style by its name in the theme, or its identifier where the theme has none for it. */
function useStyleName(style: string): string {
  const presentation = usePresentation();
  if (presentation?.state !== 'ready') return style;
  return tableChoices(presentation.theme).find((each) => each.value === style)?.label ?? style;
}

/** Label and value pairs, in the tab's two columns. */
function Facts({ rows }: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className={styles['facts']}>
      {rows.map(([label, value]) => (
        <div key={label} className={styles['fact']}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The note that heads the tab while it can only be read (ADR-0052, decision 5). */
function ReadOnlyNote() {
  return <p className={styles['unreadable']}>{BOUND_TABLE_WORDS.readOnly}</p>;
}

/**
 * **A bound table's formatting, read only** (ADR-0052, decision 5): while the reader is viewing, or
 * editing with the cursor in no table - the one it was last in, or the first. Every value as text,
 * Provenance its only act; no bins, no adds, no Delete table.
 */
export function BoundTableReadOnly({
  table,
  value,
  shownNotes,
}: {
  readonly table: BoundTablePlace;
  /** Its value, with Provenance alone. */
  readonly value?: ReactNode;
  /** Each note's letter as the page shows it. */
  readonly shownNotes: readonly { readonly letter: string | null }[];
}) {
  const [chosen, setChosen] = useState(0);
  const [open, setOpen] = useState<'column' | 'sort' | 'notes' | null>('column');
  const inHand = Math.max(0, Math.min(chosen, table.columns.length - 1));
  const column = table.columns[inHand];
  const header = (name: string) =>
    table.columns.find((each) => each.column === name)?.header ?? name;
  const styleName = useStyleName(table.style);
  const shows = [
    table.numbered && BOUND_TABLE_WORDS.numbered,
    table.headerColumn && BOUND_TABLE_WORDS.headerColumn,
    ...(['empty', 'note', 'source'] as const).map(
      (part) => table.parts[part] && BOUND_TABLE_WORDS.parts[part],
    ),
  ].filter((each): each is string => typeof each === 'string');
  return (
    <div role="group" aria-label={BOUND_TABLE_WORDS.panel} className={styles['band']}>
      <ReadOnlyNote />
      {value !== undefined && <div className={styles['section']}>{value}</div>}
      <section className={styles['section']} aria-label={BOUND_TABLE_WORDS.table}>
        <h3 className={styles['heading']}>{BOUND_TABLE_WORDS.table}</h3>
        <Facts
          rows={[
            ['Table style', styleName],
            [BOUND_TABLE_WORDS.wide, BOUND_TABLE_WORDS.wides[table.wide ?? 'style']],
            [
              BOUND_TABLE_WORDS.shows,
              shows.length === 0 ? BOUND_TABLE_WORDS.none : shows.join(', '),
            ],
          ]}
        />
      </section>
      <section className={styles['section']} aria-label={BOUND_TABLE_WORDS.columns}>
        <div className={styles['sectionHead']}>
          <h3 className={styles['heading']}>{BOUND_TABLE_WORDS.columns}</h3>
          <Chip>{table.columns.length}</Chip>
        </div>
        <div role="group" aria-label={BOUND_TABLE_WORDS.columns} className={styles['pills']}>
          {table.columns.map((each, at) => (
            <button
              key={at}
              type="button"
              className={styles['pill']}
              aria-pressed={at === inHand}
              onClick={() => {
                setChosen(at);
                setOpen('column');
              }}
            >
              {each.header.trim() === '' ? each.column : each.header}
            </button>
          ))}
        </div>
      </section>
      {column !== undefined && (
        <Fold
          id={`read-only-column-${table.pos}`}
          label={
            open === 'column'
              ? `${BOUND_TABLE_WORDS.column} ${inHand + 1} ${BOUND_TABLE_WORDS.of} ${table.columns.length}`
              : BOUND_TABLE_WORDS.column
          }
          summary={`${inHand + 1} ${BOUND_TABLE_WORDS.of} ${table.columns.length}, ${header(column.column)}`}
          open={open === 'column'}
          onToggle={() => setOpen(open === 'column' ? null : 'column')}
          group={`${BOUND_TABLE_WORDS.column} ${inHand + 1}`}
        >
          <div className={styles['inHand']}>
            <Facts
              rows={[
                [BOUND_TABLE_WORDS.column, <code key="column">{column.column}</code>],
                [BOUND_TABLE_WORDS.header, column.header],
                [
                  BOUND_TABLE_WORDS.unit,
                  column.unit === undefined
                    ? BOUND_TABLE_WORDS.none
                    : `${column.unit.text}, ${BOUND_TABLE_WORDS.unitPlaces[column.unit.place].toLowerCase()}`,
                ],
                [BOUND_TABLE_WORDS.align, BOUND_TABLE_WORDS.aligns[column.align ?? 'style']],
                [BOUND_TABLE_WORDS.wrap, yes(column.wrap !== false)],
                [
                  BOUND_TABLE_WORDS.format,
                  column.format === undefined
                    ? BOUND_TABLE_WORDS.aligns.style
                    : BOUND_TABLE_WORDS.formatSet,
                ],
              ]}
            />
          </div>
        </Fold>
      )}
      <Fold
        id={`read-only-sort-${table.pos}`}
        label={BOUND_TABLE_WORDS.sort}
        count={table.sort.length}
        summary={
          table.sort.length === 0
            ? BOUND_TABLE_WORDS.none
            : table.sort
                .map(
                  (key) =>
                    `${header(key.column)}${key.direction === 'descending' ? ' descending' : ''}`,
                )
                .join(', then ')
        }
        open={open === 'sort'}
        onToggle={() => setOpen(open === 'sort' ? null : 'sort')}
      >
        {table.sort.map((key, at) => (
          <p key={at} className={styles['row']}>
            <span className={styles['index']}>{at + 1}</span>
            <span className={styles['words']}>
              {`${header(key.column)}, ${BOUND_TABLE_WORDS.directions[key.direction].toLowerCase()}, ${BOUND_TABLE_WORDS.nulls[key.nulls].toLowerCase()}`}
            </span>
          </p>
        ))}
      </Fold>
      <Fold
        id={`read-only-notes-${table.pos}`}
        label={BOUND_TABLE_WORDS.notes}
        count={table.notes.length}
        summary={
          table.notes.length === 0
            ? BOUND_TABLE_WORDS.none
            : table.notes
                .map((note, at) => {
                  const letter = shownNotes[at]?.letter;
                  const on = header(note.anchor.column);
                  return letter ? `${letter} on ${on}` : `On ${on}`;
                })
                .join(', ')
        }
        open={open === 'notes'}
        onToggle={() => setOpen(open === 'notes' ? null : 'notes')}
      >
        {table.notes.map((note, at) => (
          <p key={at} className={styles['row']}>
            <span className={styles['letter']} aria-hidden="true">
              {shownNotes[at]?.letter ?? at + 1}
            </span>
            <span className={styles['words']}>{noteOnWords(note.anchor, header)}</span>
          </p>
        ))}
      </Fold>
    </div>
  );
}

/** **A plain table's formatting, read only** (ADR-0052, decision 5; TF-C): its settings as text. */
export function TableReadOnly({ table }: { readonly table: TableAt }) {
  const styleName = useStyleName(table.style);
  return (
    <div role="group" aria-label={BOUND_TABLE_WORDS.table} className={styles['band']}>
      <ReadOnlyNote />
      <section className={styles['section']} aria-label={BOUND_TABLE_WORDS.table}>
        <h3 className={styles['heading']}>{BOUND_TABLE_WORDS.table}</h3>
        <Facts
          rows={[
            ['Table style', styleName],
            [BOUND_TABLE_WORDS.wide, BOUND_TABLE_WORDS.wides[table.wide ?? 'style']],
            [BOUND_TABLE_WORDS.numbered, yes(table.numbered)],
            ['Header rows', String(table.headerRows)],
            ['Header columns', String(table.headerColumns)],
            ['Size', `${table.rows} rows, ${table.columns} columns`],
          ]}
        />
      </section>
    </div>
  );
}
