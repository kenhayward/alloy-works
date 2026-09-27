import { useId } from 'react';

import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';

/** A sort a listing view offers: the listing's sort and order, and what a reader is told. */
export interface SortOption {
  readonly sort: string;
  readonly order: 'asc' | 'desc';
  readonly label: string;
}

/** The sort a view is in, chosen from its options (SCH-064): the first is the listing's default. */
export function SortChooser({
  options,
  chosen,
  onChoose,
}: {
  readonly options: readonly SortOption[];
  readonly chosen: SortOption;
  readonly onChoose: (option: SortOption) => void;
}) {
  const id = useId();
  const key = (option: SortOption) => `${option.sort}:${option.order}`;
  return (
    <div className={styles['sort']}>
      <label htmlFor={id}>Sort by</label>
      <select
        id={id}
        value={key(chosen)}
        onChange={(event) => {
          const picked = options.find((option) => key(option) === event.target.value);
          if (picked) onChoose(picked);
        }}
      >
        {options.map((option) => (
          <option key={key(option)} value={key(option)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One value of a facet, as the service counts it with the other filters in force. */
export interface FacetValue {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/**
 * One facet of a listing view: a checkbox a value, each with how many it would leave. A value chosen
 * that no longer counts any is still shown, at none, so it can be taken off again.
 */
export function Facet({
  legend,
  values,
  chosen,
  labelOf = (value) => value.label,
  onToggle,
}: {
  readonly legend: string;
  readonly values: readonly FacetValue[];
  readonly chosen: readonly string[];
  readonly labelOf?: (value: FacetValue) => string;
  readonly onToggle: (value: string) => void;
}) {
  const shown = [
    ...values,
    ...chosen
      .filter((value) => !values.some((each) => each.value === value))
      .map((value) => ({ value, label: value, count: 0 })),
  ];
  return (
    <fieldset className={styles['facet']}>
      <legend className={styles['overline']}>{legend}</legend>
      {shown.map((value) => (
        <label key={value.value} className={styles['option']}>
          <input
            type="checkbox"
            checked={chosen.includes(value.value)}
            onChange={() => onToggle(value.value)}
          />
          <span className={styles['optionName']}>{labelOf(value)}</span>
          <span className={styles['count']}>{value.count}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** A filter's values with one added, or taken away where it was already there. */
export const toggled = <T,>(held: readonly T[], value: T): readonly T[] =>
  held.includes(value) ? held.filter((one) => one !== value) : [...held, value];

/** Show more, or Try again where the page after the last one shown did not arrive. */
export function More({
  listing,
  what,
}: {
  readonly listing: {
    readonly next: string | null;
    readonly failed: string | null | undefined;
    readonly loading: boolean;
    readonly load: (cursor: string | null) => Promise<void>;
  };
  readonly what: string;
}) {
  if (listing.failed !== undefined) {
    return (
      <Notice tone="failed">
        <p>{`The ${what} could not be loaded.`}</p>
        <button
          type="button"
          disabled={listing.loading}
          onClick={() => void listing.load(listing.failed ?? null)}
        >
          Try again
        </button>
      </Notice>
    );
  }
  if (listing.next === null) return null;
  return (
    <div className={styles['more']}>
      <button
        type="button"
        disabled={listing.loading}
        onClick={() => void listing.load(listing.next)}
      >
        Show more
      </button>
    </div>
  );
}
