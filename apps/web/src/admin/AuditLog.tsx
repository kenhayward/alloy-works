import type { createApiClient, paths } from '@alloy-works/api-client';
import { auditKinds } from '@alloy-works/domain';
import { useCallback, useEffect, useState } from 'react';

import { Chip } from '../parts/Chip.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { FAMILY_WORDS, kindWords } from './auditWords.js';

type Client = ReturnType<typeof createApiClient>;
type AuditEventView =
  paths['/v1/audit']['get']['responses']['200']['content']['application/json']['items'][number];

const PAGE = 50;

/** Someone or something a filter names: its id, and its name as the log keeps it. */
interface Named {
  readonly id: string;
  readonly name: string;
}

interface Filter {
  /** A kind, or a family and its dot. */
  readonly kind: string;
  /** Days, as a date field holds them: `YYYY-MM-DD`, or empty. */
  readonly from: string;
  readonly to: string;
  readonly actor: Named | null;
  readonly subject: Named | null;
}

const NO_FILTER: Filter = { kind: '', from: '', to: '', actor: null, subject: null };

type Read =
  | { readonly rows: readonly AuditEventView[]; readonly next: string | null }
  | 'refused'
  | 'signedOut'
  | 'failed'
  | null;

/** The families, by name, each with its kinds: what the kind filter offers. */
const FAMILIES = Object.entries(FAMILY_WORDS)
  .map(([family, name]) => ({
    family,
    name,
    kinds: auditKinds.filter((kind) => kind.startsWith(`${family}.`)),
  }))
  .sort((one, other) => one.name.localeCompare(other.name));

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** A day's first or last instant, where the reader is, as the service reads an instant. */
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/** Who acted, in words, where nobody is named. */
const UNNAMED: Readonly<Record<string, string>> = {
  system: 'The system',
  vendor: 'The vendor',
  anonymous: 'Somebody not signed in',
};

/**
 * **The Audit log** (ADM-038; audit.md, "Reading and export"): the environment's events newest first,
 * each saying when, who, what and about what, a page at a time, filtered by what happened - one kind or
 * a family - by the days it fell between, and by who acted or what it was about, chosen from a row.
 */
export function AuditLog({ client }: { client: Client }) {
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [read, setRead] = useState<Read>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      try {
        const { data, response } = await client.GET('/v1/audit', {
          params: {
            query: {
              limit: String(PAGE),
              ...(cursor === null ? {} : { cursor }),
              ...(filter.kind === '' ? {} : { kind: filter.kind }),
              ...(filter.from === '' ? {} : { from: dayStart(filter.from) }),
              ...(filter.to === '' ? {} : { to: dayEnd(filter.to) }),
              ...(filter.actor === null ? {} : { actor: filter.actor.id }),
              ...(filter.subject === null ? {} : { subject: filter.subject.id }),
            },
          },
        });
        if (!data) {
          if (cursor === null) {
            setRead(
              response.status === 403
                ? 'refused'
                : response.status === 401
                  ? 'signedOut'
                  : 'failed',
            );
          }
          return;
        }
        setRead((was) => ({
          rows:
            cursor === null || was === null || typeof was !== 'object'
              ? data.items
              : [...was.rows, ...data.items],
          next: data.next,
        }));
      } catch {
        if (cursor === null) setRead('failed');
      }
    },
    [client, filter],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const choose = (change: Partial<Filter>) => setFilter((was) => ({ ...was, ...change }));

  const who = (event: AuditEventView) => {
    const name = event.labels['actor']?.text;
    if (event.actor === null || name === undefined) {
      return <span className={styles['muted']}>{UNNAMED[event.actorKind] ?? 'Somebody'}</span>;
    }
    const actor = { id: event.actor, name };
    return (
      <>
        <button
          type="button"
          className={styles['plainButton']}
          aria-label={`Only what ${name} did`}
          onClick={() => choose({ actor })}
        >
          {name}
        </button>
        {event.actorKind === 'token' && <span className={styles['muted']}> by an API token</span>}
      </>
    );
  };

  const about = (event: AuditEventView) => {
    const name = event.labels['subject']?.text ?? event.labels['space']?.text;
    const id = event.subject?.id ?? null;
    if (name === undefined) return null;
    if (id === null) return name;
    return (
      <button
        type="button"
        className={styles['plainButton']}
        aria-label={`Only events about ${name}`}
        onClick={() => choose({ subject: { id, name } })}
      >
        {name}
      </button>
    );
  };

  const shown = (
    <>
      <div className={styles['toolbar']}>
        <label className={styles['filter']}>
          What happened
          <select value={filter.kind} onChange={(change) => choose({ kind: change.target.value })}>
            <option value="">Everything</option>
            {FAMILIES.map(({ family, name, kinds }) => (
              <optgroup key={family} label={name}>
                <option value={`${family}.`}>{`Any of ${name.toLocaleLowerCase()}`}</option>
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindWords(kind)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          From
          <input
            type="date"
            value={filter.from}
            max={filter.to === '' ? undefined : filter.to}
            onChange={(change) => choose({ from: change.target.value })}
          />
        </label>
        <label className={styles['filter']}>
          To
          <input
            type="date"
            value={filter.to}
            min={filter.from === '' ? undefined : filter.from}
            onChange={(change) => choose({ to: change.target.value })}
          />
        </label>
        {filter.actor !== null && (
          <Chip tone="accent">
            {`Who: ${filter.actor.name} `}
            <button
              type="button"
              className={styles['plainButton']}
              aria-label={`Stop showing only what ${filter.actor.name} did`}
              onClick={() => choose({ actor: null })}
            >
              ×
            </button>
          </Chip>
        )}
        {filter.subject !== null && (
          <Chip tone="accent">
            {`About: ${filter.subject.name} `}
            <button
              type="button"
              className={styles['plainButton']}
              aria-label={`Stop showing only events about ${filter.subject.name}`}
              onClick={() => choose({ subject: null })}
            >
              ×
            </button>
          </Chip>
        )}
      </div>
      {read === null ? (
        <Waiting>Loading...</Waiting>
      ) : read === 'refused' ? (
        <Notice tone="refused">
          <p>You may not read the audit log here.</p>
        </Notice>
      ) : read === 'signedOut' ? (
        <Notice tone="signedOut">
          <p>You are signed out. Sign in again to read the audit log.</p>
        </Notice>
      ) : read === 'failed' ? (
        <Notice tone="failed">
          <p>The audit log could not be read.</p>
        </Notice>
      ) : read.rows.length === 0 ? (
        <Empty>
          <p>No events match.</p>
        </Empty>
      ) : (
        <>
          <table aria-label="Audit log" className={styles['table']}>
            <colgroup>
              <col className={styles['whenColumn']} />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">About</th>
              </tr>
            </thead>
            <tbody>
              {read.rows.map((event) => (
                <tr key={event.sequence}>
                  <td className={styles['muted']}>{when(event.at)}</td>
                  <td>{who(event)}</td>
                  <td>
                    {kindWords(event.kind)}
                    {event.outcome === 'refused' && event.kind !== 'access.refused' && (
                      <>
                        {' '}
                        <Chip tone="danger">Refused</Chip>
                      </>
                    )}
                  </td>
                  <td>{about(event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {read.next !== null && (
            <div className={styles['showMore']}>
              <button type="button" onClick={() => void load(read.next)}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
  return <div className={styles['holder']}>{shown}</div>;
}
