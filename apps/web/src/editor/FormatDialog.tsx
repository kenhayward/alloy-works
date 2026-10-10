import { fieldFormatSchema, type ColumnType, type FieldFormat } from '@alloy-works/domain';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Chip } from '../parts/Chip.js';
import layout from './FormatDialog.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';

/** What each member of a format is called in the dialog (tables.md, "Formatting"). */
export const FORMAT_MEMBERS = {
  style: 'Style',
  places: 'Decimal places',
  rounding: 'Rounding',
  negative: 'Negative numbers',
  negativeColour: 'Negative colour',
  currency: 'Currency symbol',
  percent: 'Percentage from',
  duration: 'Duration',
  fraction: 'Fraction of a second, places',
  null: 'Where there is no value',
} as const satisfies Record<keyof FieldFormat, string>;

/** The words each member's values are offered by. */
export const FORMAT_WORDS = {
  style: {
    number: 'A number',
    currency: 'A currency',
    percent: 'A percentage',
    duration: 'A duration',
  },
  rounding: { halfAwayFromZero: 'Half away from zero', halfEven: 'Half to even' },
  negative: { minus: 'With a minus sign', parentheses: 'In parentheses' },
  negativeColour: { true: 'In the negative colour', false: 'In the text colour' },
  position: { before: 'Before the number', after: 'After the number' },
  percent: { fraction: 'A fraction, 0.25 as 25%', hundred: 'A hundred, 25 as 25%' },
  from: { seconds: 'Seconds', minutes: 'Minutes' },
  show: { 'h:mm': 'Hours and minutes', 'h:mm:ss': 'Hours, minutes and seconds' },
} as const;

/** What a member left unset says it takes: the table style's value, in words. */
export const STYLE_SAYS = 'Table style';
export const STYLE_SETS_NONE = 'not set';

const NUMBER_TYPES = new Set(['integer', 'decimal']);
const FRACTION_TYPES = new Set(['time', 'localDateTime', 'instant']);

/** The members that mean something for a column of this type, in the format's order; all, unknown. */
export function membersFor(type: ColumnType | null): (keyof FieldFormat)[] {
  const all = Object.keys(FORMAT_MEMBERS) as (keyof FieldFormat)[];
  if (type === null) return all;
  if (NUMBER_TYPES.has(type.base)) return all.filter((member) => member !== 'fraction');
  if (FRACTION_TYPES.has(type.base)) return ['fraction', 'null'];
  return ['null'];
}

/** A member's value in words, as the style or the column holds it. */
export function memberSaid(member: keyof FieldFormat, format: FieldFormat): string {
  const value = format[member];
  if (value === undefined) return STYLE_SETS_NONE;
  switch (member) {
    case 'style':
    case 'rounding':
    case 'negative':
    case 'percent':
      return (FORMAT_WORDS[member] as Record<string, string>)[value as string]!;
    case 'negativeColour':
      return FORMAT_WORDS.negativeColour[String(value) as 'true' | 'false'];
    case 'currency': {
      const currency = value as NonNullable<FieldFormat['currency']>;
      return `${currency.symbol}, ${FORMAT_WORDS.position[currency.position].toLowerCase()}${currency.space ? ', spaced' : ''}`;
    }
    case 'duration': {
      const duration = value as NonNullable<FieldFormat['duration']>;
      return `${FORMAT_WORDS.from[duration.from]} as ${FORMAT_WORDS.show[duration.show].toLowerCase()}`;
    }
    default:
      return String(value);
  }
}

export interface FormatDialogProps {
  /** The column's header, which the dialog is named after. */
  readonly header: string;
  /** The column's type in the definition, or null where it cannot be read. */
  readonly type: ColumnType | null;
  /** The table style's format for the column's type: what each member left unset takes (TAB-037). */
  readonly style: FieldFormat;
  /** The column's own format, or none. */
  readonly format: FieldFormat | undefined;
  /** The column's format as set, none where every member is left to the style. */
  readonly onDone: (format: FieldFormat | undefined) => void;
  readonly onCancel: () => void;
}

type Draft = Record<string, string | boolean>;

const draftOf = (format: FieldFormat | undefined): Draft => ({
  style: format?.style ?? '',
  places: format?.places === undefined ? '' : String(format.places),
  rounding: format?.rounding ?? '',
  negative: format?.negative ?? '',
  negativeColour: format?.negativeColour === undefined ? '' : String(format.negativeColour),
  symbol: format?.currency?.symbol ?? '',
  position: format?.currency?.position ?? 'before',
  space: format?.currency?.space ?? false,
  percent: format?.percent ?? '',
  from: format?.duration?.from ?? '',
  show: format?.duration?.show ?? 'h:mm:ss',
  fraction: format?.fraction === undefined ? '' : String(format.fraction),
  null: format?.null ?? '',
});

/** The format a draft sets: each member typed or chosen, the rest left to the style. */
function formatOf(draft: Draft, members: readonly (keyof FieldFormat)[]): Record<string, unknown> {
  const format: Record<string, unknown> = {};
  const text = (name: string) => String(draft[name] ?? '');
  for (const member of members) {
    switch (member) {
      case 'places':
      case 'fraction':
        if (text(member).trim() !== '') format[member] = Number(text(member));
        break;
      case 'negativeColour':
        if (text(member) !== '') format[member] = text(member) === 'true';
        break;
      case 'currency':
        if (text('symbol') !== '') {
          format.currency = {
            symbol: text('symbol').normalize('NFC'),
            position: text('position'),
            space: draft.space === true,
          };
        }
        break;
      case 'duration':
        if (text('from') !== '') format.duration = { from: text('from'), show: text('show') };
        break;
      case 'null':
        if (text('null') !== '') format.null = text('null').normalize('NFC');
        break;
      default:
        if (text(member) !== '') format[member] = text(member);
    }
  }
  return format;
}

/**
 * **The Format dialog** (the TB2 plan, TB2-F): a column's format, member by member, each left to the
 * table style unless set here - and saying beside each one left unset what the style's is, so a set
 * member is seen to override it alone (TAB-037). Only the members that mean something for the column's
 * type are offered (`format_mismatch`). Nothing changes on Cancel, Close or Escape.
 */
export function FormatDialog({ header, type, style, format, onDone, onCancel }: FormatDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(format));
  const [said, setSaid] = useState<string | null>(null);
  const members = membersFor(type);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, []);
  // Modal in full (ADR-0052): everything else at the top of the page is inert while it stands -
  // the editor and the panel beside the text it sets, which stand apart - and taken back as it goes.
  useEffect(() => {
    const own = dialog.current?.closest('body > *');
    const others = [...document.body.children].filter(
      (each) => each !== own && !each.hasAttribute('inert'),
    );
    for (const each of others) each.setAttribute('inert', '');
    return () => {
      for (const each of others) each.removeAttribute('inert');
    };
  }, []);

  const set_ = (name: string, value: string | boolean) => setDraft({ ...draft, [name]: value });
  const unset = (member: keyof FieldFormat) => `${STYLE_SAYS}: ${memberSaid(member, style)}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select, textarea, button',
      ) ?? []),
    ];
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && dialog.current?.contains(active) === true;
    const end = event.shiftKey ? stops[0] : stops.at(-1);
    if (inside && active !== end) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  /**
   * One member's row (ADR-0051, decision 7): its name, a Set badge where the column sets it, and under
   * the name what the table style says; its field on the right.
   */
  const row = (
    member: keyof FieldFormat,
    name: string,
    set: boolean,
    hint: string | null,
    field: React.ReactNode,
    more: React.ReactNode = null,
  ) => (
    <div key={member} className={layout['row']}>
      <div className={layout['name']}>
        <label htmlFor={`${id}-${name}`}>{FORMAT_MEMBERS[member]}</label>
        {set && <Chip tone="accent">Set</Chip>}
        {hint !== null && (
          <span id={`${id}-${name}-style`} className={layout['hint']}>
            {hint}
          </span>
        )}
      </div>
      <div className={layout['field']}>
        {field}
        {more}
      </div>
    </div>
  );

  /** A member chosen from a list, its first entry the style's, which is said under it once set. */
  const choose = (
    member: keyof FieldFormat,
    name: string,
    words: Record<string, string>,
    more: React.ReactNode = null,
  ) => {
    const set = String(draft[name]) !== '';
    return row(
      member,
      name,
      set,
      set ? unset(member) : null,
      <select
        id={`${id}-${name}`}
        value={String(draft[name])}
        {...(set ? { 'aria-describedby': `${id}-${name}-style` } : {})}
        onChange={(event) => set_(name, event.target.value)}
      >
        <option value="">{unset(member)}</option>
        {Object.entries(words).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>,
      more,
    );
  };

  /** A member typed, what the style says under its name, and "Left unset" while it is empty. */
  const typed = (
    member: keyof FieldFormat,
    name: string,
    kind: 'number' | 'text',
    more: React.ReactNode = null,
  ) => {
    const set = String(draft[name]) !== '';
    return row(
      member,
      name,
      set,
      set ? unset(member) : `Left unset. ${unset(member)}`,
      <input
        id={`${id}-${name}`}
        type={kind}
        {...(kind === 'number' ? { min: 0, max: member === 'fraction' ? 6 : 20 } : {})}
        value={String(draft[name])}
        aria-describedby={`${id}-${name}-style`}
        onChange={(event) => set_(name, event.target.value)}
      />,
      more,
    );
  };

  const fields = members.map((member) => {
    switch (member) {
      case 'style':
      case 'rounding':
      case 'negative':
      case 'percent':
        return choose(member, member, FORMAT_WORDS[member]);
      case 'negativeColour':
        return choose(member, member, FORMAT_WORDS.negativeColour);
      case 'places':
      case 'fraction':
        return typed(member, member, 'number');
      case 'null':
        return typed(member, 'null', 'text');
      case 'currency':
        return typed(
          member,
          'symbol',
          'text',
          draft.symbol !== '' && (
            <>
              <label htmlFor={`${id}-position`}>Symbol stands</label>
              <select
                id={`${id}-position`}
                value={String(draft.position)}
                onChange={(event) => set_('position', event.target.value)}
              >
                {Object.entries(FORMAT_WORDS.position).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={draft.space === true}
                  onChange={(event) => set_('space', event.target.checked)}
                />
                A space between symbol and number
              </label>
            </>
          ),
        );
      case 'duration':
        return choose(
          member,
          'from',
          FORMAT_WORDS.from,
          draft.from !== '' && (
            <>
              <label htmlFor={`${id}-show`}>Shown as</label>
              <select
                id={`${id}-show`}
                value={String(draft.show)}
                onChange={(event) => set_('show', event.target.value)}
              >
                {Object.entries(FORMAT_WORDS.show).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          ),
        );
    }
  });

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = fieldFormatSchema.safeParse(formatOf(draft, members));
            if (!parsed.success) {
              const member = parsed.error.issues[0]?.path[0] as keyof FieldFormat | undefined;
              setSaid(
                member === 'null'
                  ? 'Where there is no value, the words cannot be empty or read as a number.'
                  : `${member === undefined ? 'The format' : FORMAT_MEMBERS[member]} is not one a column can take.`,
              );
              return;
            }
            onDone(Object.keys(parsed.data).length === 0 ? undefined : parsed.data);
          }}
        >
          <h2 id={`${id}-heading`} className={styles['heading']}>
            Format of {header}
          </h2>
          <p className={styles['note']}>
            Each member left unset takes the table style's, shown under its name.
            {type?.base === 'text' && ' A text column takes only this one.'}
          </p>
          <div className={layout['rows']}>{fields}</div>
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Apply
            </button>
          </div>
        </form>
        <button
          type="button"
          className={shell['close']}
          aria-label="Close"
          title="Close"
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
