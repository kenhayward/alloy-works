import {
  setTableHeaders,
  setTableNumbered,
  setTableWide,
  tableCommand,
  type EditorView,
  type TableAt,
  type Wide,
} from '@alloy-works/editor';
import { useId } from 'react';

import { BOUND_TABLE_WORDS } from './BoundTablePanel.js';
import { Icon } from './Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { TableStyle } from '../theme/StyleChoice.js';
import styles from './TablePanel.module.css';
import { words } from '../words/words.js';

/** Wide's three choices, each named by its full words and shown by its short one. */
const WIDES = [
  { key: 'style', icon: 'Wide style', short: () => words('editor.table-short-style') },
  { key: 'scale', icon: 'Wide scale', short: () => words('editor.table-short-scale') },
  { key: 'rotate', icon: 'Wide landscape', short: () => words('editor.table-short-landscape') },
] as const;

/**
 * A header count: the number as the table holds it, typed or stepped, clamped by the command so a box
 * never says one number while the table holds another (ADR-0079).
 */
function Counter({
  label,
  fewer,
  more,
  value,
  max,
  enabled,
  onChange,
}: {
  readonly label: string;
  readonly fewer: string;
  readonly more: string;
  readonly value: number;
  readonly max: number;
  readonly enabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  const id = useId();
  const step = (to: number, may: boolean) => ({
    'aria-disabled': !may,
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: () => {
      if (may) onChange(to);
    },
  });
  return (
    <div className={styles['counter']}>
      <label htmlFor={id}>{label}</label>
      <div className={styles['counterField']}>
        <IconButton label={fewer} {...step(value - 1, enabled && value > 0)}>
          <Icon name="Minus" size={14} />
        </IconButton>
        <input
          id={id}
          type="number"
          min={0}
          max={max}
          value={value}
          disabled={!enabled}
          onChange={(event) => {
            const typed = Number(event.target.value);
            if (event.target.value !== '' && Number.isInteger(typed) && typed >= 0) onChange(typed);
          }}
        />
        <IconButton label={more} {...step(value + 1, enabled && value < max)}>
          <Icon name="Add" size={14} />
        </IconButton>
      </div>
    </div>
  );
}

/** A setting as a switch, with its line beneath where the tab gives it one. */
function Switch({
  label,
  line,
  checked,
  enabled,
  onChange,
}: {
  readonly label: string;
  readonly line?: string | undefined;
  readonly checked: boolean;
  readonly enabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles['switchRow']}>
      <span className={styles['switchWords']}>
        {label}
        {line !== undefined && <small>{line}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-disabled={!enabled}
        onMouseDown={(event) => event.preventDefault()}
        onChange={(event) => {
          if (enabled) onChange(event.target.checked);
        }}
      />
    </label>
  );
}

/**
 * **A table's settings**, one component for the toolbar's popover and the Table tab, so the two cannot
 * disagree (ADR-0079, as `useFigureSettings` holds a figure's): Table style, its header counts, Wide,
 * Numbered (STR-071, TAB-034), the note beneath it (CNT-038), and Delete table. `lines` adds the words
 * the tab sets under its switches.
 */
export function TableSettings({
  view,
  table,
  enabled,
  lines,
}: {
  readonly view: EditorView;
  readonly table: TableAt;
  readonly enabled: boolean;
  readonly lines?: { readonly numbered: string; readonly note: string };
}) {
  const group = useId();
  const chosenWide = table.wide ?? 'style';
  return (
    <div className={styles['settings']}>
      <div className={styles['counters']}>
        <Counter
          label={words('editor.header-rows')}
          fewer={words('editor.table-fewer-header-rows')}
          more={words('editor.table-more-header-rows')}
          value={table.headerRows}
          max={table.rows}
          enabled={enabled}
          onChange={(rows) => setTableHeaders({ rows })(view.state, view.dispatch)}
        />
        <Counter
          label={words('editor.header-columns')}
          fewer={words('editor.table-fewer-header-columns')}
          more={words('editor.table-more-header-columns')}
          value={table.headerColumns}
          max={table.columns}
          enabled={enabled}
          onChange={(columns) => setTableHeaders({ columns })(view.state, view.dispatch)}
        />
      </div>
      <TableStyle view={view} value={table.style} enabled={enabled} />
      <div
        role="radiogroup"
        aria-labelledby={`${group}-wide`}
        className={styles['wide']}
        data-wide-choices
      >
        <span id={`${group}-wide`} className={styles['wideLabel']}>
          {BOUND_TABLE_WORDS.wide}
        </span>
        <div className={styles['wideChoices']}>
          {WIDES.map(({ key, icon, short }) => (
            <label key={key} title={BOUND_TABLE_WORDS.wides[key]} data-chosen={chosenWide === key}>
              <input
                type="radio"
                name={`${group}-wide-choice`}
                aria-label={BOUND_TABLE_WORDS.wides[key]}
                checked={chosenWide === key}
                disabled={!enabled}
                onChange={() =>
                  setTableWide(key === 'style' ? null : (key as Wide))(view.state, view.dispatch)
                }
              />
              <Icon name={icon} size={16} />
              <span>{short()}</span>
            </label>
          ))}
        </div>
      </div>
      <Switch
        label={words('editor.numbered')}
        line={lines?.numbered}
        checked={table.numbered}
        enabled={enabled}
        onChange={(numbered) => setTableNumbered(numbered)(view.state, view.dispatch)}
      />
      <Switch
        label={words('editor.table-note-beneath')}
        line={lines?.note}
        checked={table.note}
        enabled={enabled}
        onChange={(note) =>
          tableCommand(note ? 'addNote' : 'removeNote')(view.state, view.dispatch)
        }
      />
      <button
        type="button"
        className={styles['deleteTable']}
        aria-disabled={!enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (enabled) tableCommand('deleteTable')(view.state, view.dispatch);
        }}
      >
        <Icon name="Delete" size={14} />
        {words('editor.delete-table')}
      </button>
    </div>
  );
}
