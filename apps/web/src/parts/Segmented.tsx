import { useRef, type KeyboardEvent } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from './parts.module.css';

export interface Segment {
  readonly value: string;
  /** Its name in full, for a screen reader and its title: "In the header", "The table style's". */
  readonly name: string;
  /** Short words on its face, where the name is too long to draw: "Header", "Style". */
  readonly label?: string;
  /** A glyph from `Icon` drawn in place of words. */
  readonly icon?: string;
}

/**
 * One choice of a few, side by side on a sunken ground, the chosen one raised (ADR-0051): a radio
 * group of one tab stop, the arrows choosing as they go. Each segment is named in full; a short label
 * or an icon is only its face. `disabled` keeps it reachable and chooses nothing.
 */
export function Segmented({
  label,
  value,
  options,
  onChange,
  disabled = false,
  describedBy,
}: {
  label: string;
  /** What says more of it, such as why it is disabled: the id of that text. */
  describedBy?: string | undefined;
  value: string;
  options: readonly Segment[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const elements = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const choose = (index: number) => {
    elements.current[index]?.focus();
    if (!disabled) onChange(options[index]!.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = options.length;
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (at + 1) % count
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (at - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    choose(to);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={styles['segmented']}
      onKeyDown={onKeyDown}
      {...(disabled ? { 'aria-disabled': true } : {})}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            elements.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={index === at}
          aria-label={option.name}
          title={option.name}
          tabIndex={index === at ? 0 : -1}
          onClick={() => {
            if (!disabled) onChange(option.value);
          }}
        >
          {option.icon !== undefined ? <Icon name={option.icon} /> : (option.label ?? option.name)}
        </button>
      ))}
    </div>
  );
}
