import { useId, useState } from 'react';

import { Chip } from '../parts/Chip.js';
import { Pager, pageOf } from '../parts/Pager.js';
import styles from './uses.module.css';

/** What uses something: those the caller may read, by title, and how many more there are (D3-M). */
export interface Uses {
  readonly readable: readonly {
    readonly id: string;
    readonly title: string;
    /** A query definition naming a connection, retired. */
    readonly retired?: boolean;
  }[];
  readonly others: number;
}

export function isUses(value: unknown): value is Uses {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { others?: unknown }).others === 'number' &&
    Array.isArray((value as { readable?: unknown }).readable) &&
    (value as { readable: unknown[] }).readable.every(
      (each) =>
        typeof each === 'object' &&
        each !== null &&
        typeof (each as { id?: unknown }).id === 'string' &&
        typeof (each as { title?: unknown }).title === 'string',
    )
  );
}

/**
 * One kind of use, the readable ones linked and the rest counted, never named (DAT-016, DAT-064):
 * `counted` says how the rest use it - a component binds a definition, a document holds a result of a
 * definition or from a connection.
 */
export function UsedList({
  heading,
  uses,
  link,
  counted,
}: {
  readonly heading: string;
  readonly uses: Uses;
  readonly link: (id: string) => string;
  readonly counted: (others: number) => string;
}) {
  if (uses.readable.length === 0 && uses.others === 0) return null;
  return (
    <>
      <h3>{heading}</h3>
      {uses.readable.length > 0 && (
        <ul>
          {uses.readable.map((each) => (
            <li key={each.id}>
              <a href={link(each.id)}>{each.title}</a>
            </li>
          ))}
        </ul>
      )}
      {uses.others > 0 && (
        <p>
          {uses.readable.length > 0
            ? `And ${uses.others} more you may not read.`
            : counted(uses.others)}
        </p>
      )}
    </>
  );
}

/**
 * One kind of use as a list of its own on a Used by tab (ADR-0050, decision 8): headed and counted,
 * the readable ones linked ten to a page, and the rest counted, never named.
 */
export function PagedUses({
  heading,
  uses,
  link,
  counted,
}: {
  readonly heading: string;
  readonly uses: Uses;
  readonly link: (id: string) => string;
  readonly counted: (others: number) => string;
}) {
  const id = useId();
  const [page, setPage] = useState(0);
  const total = uses.readable.length + uses.others;
  return (
    <section aria-labelledby={id} className={styles['list']}>
      <header className={styles['head']}>
        <h2 id={id}>{heading}</h2>
        <Chip className={styles['count']}>{total}</Chip>
      </header>
      {uses.readable.length > 0 && (
        <ul className={styles['items']}>
          {pageOf(uses.readable, page).map((each) => (
            <li key={each.id}>
              <a href={link(each.id)}>{each.title}</a>
              {each.retired && <Chip tone="warn">Retired</Chip>}
            </li>
          ))}
        </ul>
      )}
      {uses.others > 0 && (
        <p className={styles['others']}>
          {uses.readable.length > 0
            ? `And ${uses.others} more you may not read.`
            : counted(uses.others)}
        </p>
      )}
      {total === 0 && <p className={styles['others']}>None.</p>}
      {uses.readable.length > 0 && (
        <div className={styles['foot']}>
          <Pager
            label={`Pages of ${heading.toLocaleLowerCase()}`}
            total={uses.readable.length}
            page={page}
            onPage={setPage}
          />
        </div>
      )}
    </section>
  );
}
