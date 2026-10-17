import type { CohortView, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import { Notice } from '../states/Notice.js';
import styles from './CohortPage.module.css';
import { documentLink } from './links.js';

type Client = ReturnType<typeof createApiClient>;
type Row = CohortView['rows'][number];

/** How often the page reads the cohort again while a row is still being made. */
export const COHORT_POLL_MS = 2000;

/** A row's parameters as one line: `name: value`, in the order the row gives them. */
const parametersSaid = (row: Row) =>
  Object.entries(row.parameters)
    .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('; ');

/**
 * **A cohort's page** (REU-033 to REU-035; the R7 plan, R7-E to R7-G): every row in order, made, failed
 * or still being made, read again until none is waiting; each made row's document to open; each failed
 * row's reason, its parameters to correct, and **Run the failed again**, which touches no other row.
 */
export function CohortPage({
  client,
  id,
  pollMs = COHORT_POLL_MS,
}: {
  readonly client: Client;
  readonly id: string;
  readonly pollMs?: number;
}) {
  const [cohort, setCohort] = useState<CohortView | 'missing' | 'unread' | null>(null);
  const [corrections, setCorrections] = useState<Readonly<Record<number, Record<string, string>>>>(
    {},
  );
  const [said, setSaid] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data, response } = await client.GET('/v1/cohorts/{id}', { params: { path: { id } } });
      setCohort(data ?? (response.status === 404 ? 'missing' : 'unread'));
    } catch {
      setCohort('unread');
    }
  }, [client, id]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  // Read again while a row is still waiting: the run makes them one at a time. A run that stopped at a
  // failed row, as asked, makes no more of them (TPL-047).
  const stoppedAt =
    cohort !== null && typeof cohort === 'object' ? (cohort.stoppedAt ?? null) : null;
  const waiting =
    cohort !== null &&
    typeof cohort === 'object' &&
    stoppedAt === null &&
    cohort.rows.some((row) => row.state === 'pending');
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setAttempt((count) => count + 1), pollMs);
    return () => clearTimeout(timer);
  }, [waiting, attempt, pollMs]);

  if (cohort === null) return null;
  if (cohort === 'missing') {
    return (
      <Notice tone="failed">
        <p>There is no such cohort, or none you may see.</p>
      </Notice>
    );
  }
  if (cohort === 'unread') {
    return (
      <Notice tone="failed">
        <p>The cohort could not be read.</p>
        <button type="button" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </button>
      </Notice>
    );
  }

  const made = cohort.rows.filter((row) => row.state === 'made').length;
  const failed = cohort.rows.filter((row) => row.state === 'failed');
  const names = [...new Set(cohort.rows.flatMap((row) => Object.keys(row.parameters)))];

  const rerun = async () => {
    setSaid(null);
    const given = Object.fromEntries(
      Object.entries(corrections).map(([row, values]) => [
        row,
        Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== '')),
      ]),
    );
    const { data, error } = await client.POST('/v1/cohorts/{id}/rerun', {
      params: { path: { id } },
      body: Object.keys(given).length === 0 ? {} : { corrections: given },
    });
    if (data) {
      setCohort(data.cohort);
      setCorrections({});
      return;
    }
    const message = (error as { message?: unknown } | undefined)?.message;
    setSaid(typeof message === 'string' ? message : 'The failed rows could not be run again.');
  };

  return (
    <section aria-labelledby="cohort-heading" className={styles['page']}>
      <h1 id="cohort-heading">Generated documents</h1>
      <p className={styles['summary']} role="status">
        {`${made} of ${cohort.rows.length} made`}
        {failed.length > 0 ? `, ${failed.length} failed` : ''}
        {waiting
          ? '. Still making the rest.'
          : stoppedAt !== null
            ? `. Stopped at row ${stoppedAt}: the rows after it wait for Run the failed again.`
            : '.'}
      </p>
      <table className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Parameters</th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {cohort.rows.map((row) => (
            <tr key={row.row} data-state={row.state}>
              <td>{row.row}</td>
              <td>
                {row.state === 'failed' ? (
                  <div className={styles['corrections']}>
                    {names.map((name) => (
                      <label key={name}>
                        {name}
                        <input
                          value={corrections[row.row]?.[name] ?? String(row.parameters[name] ?? '')}
                          onChange={(event) =>
                            setCorrections((now) => ({
                              ...now,
                              [row.row]: {
                                ...Object.fromEntries(
                                  names.map((each) => [each, String(row.parameters[each] ?? '')]),
                                ),
                                ...now[row.row],
                                [name]: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  parametersSaid(row)
                )}
              </td>
              <td>
                {row.state === 'made' && row.document !== null && (
                  <a href={documentLink(row.document)}>Open the document</a>
                )}
                {row.state === 'pending' && (stoppedAt === null ? 'Being made' : 'Waiting')}
                {row.state === 'failed' && (
                  <span className={styles['failed']}>{row.failure?.message ?? 'It failed.'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {failed.length > 0 && !waiting && (
        <div className={styles['actions']}>
          <button type="button" onClick={() => void rerun()}>
            Run the failed again
          </button>
          <span className={styles['note']}>The rows already made are left as they are.</span>
        </div>
      )}
      {said !== null && <p role="alert">{said}</p>}
    </section>
  );
}
