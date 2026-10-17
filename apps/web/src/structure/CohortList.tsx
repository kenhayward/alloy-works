import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';
import styles from './CohortList.module.css';

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
  all: 'All',
  complete: 'Complete',
  failed: 'With a row that failed',
  pending: 'Waiting',
};
type Sort = 'requested' | 'title';
const SORTS: Readonly<Record<Sort, string>> = { requested: 'Newest first', title: 'Title' };

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** How a cohort's rows stand, in words: what is made, failed and waiting, each only where there is one. */
export const rowsWords = (rows: Listed['rows']) =>
  [
    rows.made > 0 ? `${rows.made} made` : '',
    rows.failed > 0 ? `${rows.failed} failed` : '',
    rows.pending > 0 ? `${rows.pending} waiting` : '',
  ]
    .filter(Boolean)
    .join(', ') || 'No rows';

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
      .then(({ data }) => {
        if (current) setListed(data ? (data.items as readonly Listed[]) : 'unread');
      });
    return () => {
      current = false;
    };
  }, [client, sort, state]);

  return (
    <section aria-labelledby={`${ids}-heading`} className={styles['page']}>
      <h1 id={`${ids}-heading`}>Cohorts</h1>
      <p>
        <a href="#/templates">Templates</a>
      </p>
      <div className={styles['filters']}>
        <label htmlFor={`${ids}-state`}>Show</label>{' '}
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
        <label htmlFor={`${ids}-sort`}>Sort by</label>{' '}
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
      {listed === null && <p role="status">Reading the cohorts.</p>}
      {listed === 'unread' && <p role="alert">The cohorts could not be read.</p>}
      {listed !== null && listed !== 'unread' && listed.length === 0 && (
        <p>No cohort here. A template&apos;s Generate makes one.</p>
      )}
      {listed !== null && listed !== 'unread' && listed.length > 0 && (
        <table aria-label="Cohorts" className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Template</th>
              <th scope="col">Space</th>
              <th scope="col">Rows</th>
              <th scope="col">Asked for</th>
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
