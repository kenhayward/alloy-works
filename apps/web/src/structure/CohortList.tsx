import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';
import styles from './CohortList.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A cohort as the listing shows it (SCH-065; the R14 plan, R14-A). */
interface Listed {
  readonly id: string;
  readonly title: string;
  readonly template: { readonly name: string };
  readonly space: { readonly name: string };
  readonly requestedAt: string;
  readonly rows: { readonly made: number; readonly failed: number; readonly pending: number };
}

type State = 'all' | 'complete' | 'failed' | 'pending';
const STATES: Readonly<Record<State, string>> = {
  get all() {
    return words('document.all');
  },
  get complete() {
    return words('document.complete');
  },
  get failed() {
    return words('document.with-a-row-that-failed');
  },
  get pending() {
    return words('document.waiting');
  },
};
type Sort = 'requested' | 'title';
const SORTS: Readonly<Record<Sort, string>> = {
  get requested() {
    return words('document.newest-first');
  },
  get title() {
    return words('document.title');
  },
};

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** How a cohort's rows stand, in words: what is made, failed and waiting, each only where there is one. */
export const rowsWords = (rows: Listed['rows']) =>
  [
    rows.made > 0 ? words('document.made-2', { made: rows.made }) : '',
    rows.failed > 0 ? words('document.failed', { failed: rows.failed }) : '',
    rows.pending > 0 ? words('document.waiting-2', { pending: rows.pending }) : '',
  ]
    .filter(Boolean)
    .join(', ') || words('document.no-rows');

/**
 * **Cohorts** (SCH-065, TPL-040; the R14 plan, R14-A): every cohort the reader may read, newest first or
 * by title, filtered by how its rows stand, each opening its own page, so a set of documents made
 * together is found again as a set.
 */
export function CohortList({ client }: { client: Client }) {
  const ids = useId();
  const [state, setState] = useState<State>('all');
  const [sort, setSort] = useState<Sort>('requested');
  const [listed, setListed] = useState<readonly Listed[] | 'unread' | null>(null);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/cohorts', {
        params: { query: { sort, ...(state === 'all' ? {} : { state }), limit: '100' } },
      })
      .catch(() => ({ data: undefined }))
      .then(({ data }) => {
        if (current) setListed(data ? (data.items as readonly Listed[]) : 'unread');
      });
    return () => {
      current = false;
    };
  }, [client, sort, state]);

  return (
    <section aria-labelledby={`${ids}-heading`} className={styles['page']}>
      <h1 id={`${ids}-heading`}>{words('document.cohorts')}</h1>
      <p>
        <a href="#/templates">{words('document.templates')}</a>
      </p>
      <div className={styles['filters']}>
        <label htmlFor={`${ids}-state`}>{words('document.show')}</label>{' '}
        <select
          id={`${ids}-state`}
          value={state}
          onChange={(event) => setState(event.target.value as State)}
        >
          {(Object.keys(STATES) as State[]).map((each) => (
            <option key={each} value={each}>
              {STATES[each]}
            </option>
          ))}
        </select>{' '}
        <label htmlFor={`${ids}-sort`}>{words('document.sort-by')}</label>{' '}
        <select
          id={`${ids}-sort`}
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          {(Object.keys(SORTS) as Sort[]).map((each) => (
            <option key={each} value={each}>
              {SORTS[each]}
            </option>
          ))}
        </select>
      </div>
      {listed === null && <p role="status">{words('document.reading-the-cohorts')}</p>}
      {listed === 'unread' && <p role="alert">{words('document.the-cohorts-could-not-be')}</p>}
      {listed !== null && listed !== 'unread' && listed.length === 0 && (
        <p>{words('document.no-cohort-here-a-template')}</p>
      )}
      {listed !== null && listed !== 'unread' && listed.length > 0 && (
        <table aria-label={words('document.cohorts')} className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">{words('document.title')}</th>
              <th scope="col">{words('document.template')}</th>
              <th scope="col">{words('document.space')}</th>
              <th scope="col">{words('document.rows')}</th>
              <th scope="col">{words('document.asked-for-2')}</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((each) => (
              <tr key={each.id}>
                <td>
                  <a href={`#/cohorts/${each.id}`}>{each.title}</a>
                </td>
                <td>{each.template.name}</td>
                <td>{each.space.name}</td>
                <td>{rowsWords(each.rows)}</td>
                <td>{when.format(new Date(each.requestedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
