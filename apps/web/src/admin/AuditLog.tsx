import type { createApiClient, paths } from '@alloy-works/api-client';
import { auditKinds } from '@alloy-works/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Chip } from '../parts/Chip.js';
import { followInFrame } from '../publishing/Preview.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { FAMILY_WORDS, kindWords } from './auditWords.js';
import { words } from '../words/words.js';

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

/** The filters as the service takes them, the read's and an export's alike. */
const filtersOf = (filter: Filter) => ({
  ...(filter.kind === '' ? {} : { kind: filter.kind }),
  ...(filter.from === '' ? {} : { from: dayStart(filter.from) }),
  ...(filter.to === '' ? {} : { to: dayEnd(filter.to) }),
  ...(filter.actor === null ? {} : { actor: filter.actor.id }),
  ...(filter.subject === null ? {} : { subject: filter.subject.id }),
});

/** An export as far as it has gone: asked for, written by its job, or not. */
type Exporting =
  | { readonly state: 'idle' }
  | { readonly state: 'writing'; readonly id: string }
  | { readonly state: 'done'; readonly id: string; readonly events: number }
  | { readonly state: 'failed'; readonly said: string };

const eventsCounted = (count: number) => words('admin.events', { count: count });

/** Who acted, in words, where nobody is named. */
const UNNAMED: Readonly<Record<string, string>> = {
  get system() {
    return words('admin.the-system');
  },
  get vendor() {
    return words('admin.the-vendor');
  },
  get anonymous() {
    return words('admin.somebody-not-signed-in');
  },
};

/**
 * **The Audit log** (ADM-038; audit.md, "Reading and export"): the environment's events newest first,
 * each saying when, who, what and about what, a page at a time, filtered by what happened - one kind or
 * a family - by the days it fell between, and by who acted or what it was about, chosen from a row.
 */
export function AuditLog({
  client,
  followMs = 1000,
  follow = followInFrame,
}: {
  client: Client;
  /** How often an export is asked whether it is written: given in tests, which need not wait. */
  followMs?: number;
  /** Goes to a download link: given in tests, where there is nowhere to go. */
  follow?: (url: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [read, setRead] = useState<Read>(null);
  const [exporting, setExporting] = useState<Exporting>({ state: 'idle' });
  /** Why a download did not go, said beside Download, which stays to try again. */
  const [downloadSaid, setDownloadSaid] = useState('');
  /** The filters the latest read was asked under: a page answered for others is dropped. */
  const asked = useRef<Filter>(filter);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(
    async (cursor: string | null) => {
      asked.current = filter;
      try {
        const { data, response } = await client.GET('/v1/audit', {
          params: {
            query: {
              limit: String(PAGE),
              ...(cursor === null ? {} : { cursor }),
              ...filtersOf(filter),
            },
          },
        });
        // Answered for filters since changed: the read under the new ones is the page's.
        if (asked.current !== filter) return;
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

  // An export being written is asked after until its job has written it, or given up.
  useEffect(() => {
    if (exporting.state !== 'writing') return undefined;
    const timer = setTimeout(() => {
      void client
        .GET('/v1/audit/exports/{id}', { params: { path: { id: exporting.id } } })
        .then(({ data }) => {
          if (!live.current) return;
          if (!data) {
            setExporting({ state: 'failed', said: words('admin.the-export-could-not-be') });
            return;
          }
          if (data.export.state === 'done') {
            setExporting({ state: 'done', id: exporting.id, events: data.export.events ?? 0 });
          } else if (data.export.state === 'failed') {
            setExporting({ state: 'failed', said: words('admin.the-export-could-not-be-2') });
          } else {
            setExporting({ state: 'writing', id: exporting.id });
          }
        })
        .catch(() => {
          if (live.current) {
            setExporting({ state: 'failed', said: words('admin.the-export-could-not-be') });
          }
        });
    }, followMs);
    return () => clearTimeout(timer);
  }, [client, exporting, followMs]);

  const exportShown = async () => {
    try {
      const { data, error } = await client.POST('/v1/audit/exports', { body: filtersOf(filter) });
      if (!live.current) return;
      if (data) setExporting({ state: 'writing', id: data.export.id });
      else
        setExporting({
          state: 'failed',
          said: refusal(error, words('admin.the-export-could-not-be-3')),
        });
    } catch {
      if (live.current)
        setExporting({ state: 'failed', said: words('admin.the-export-could-not-be-3') });
    }
  };

  const download = async (id: string) => {
    setDownloadSaid('');
    try {
      const { data, error } = await client.GET('/v1/audit/exports/{id}/download', {
        params: { path: { id } },
      });
      // Only a link the service signed, to the store, over the web.
      if (data && /^https?:\/\//.test(data.download)) follow(data.download);
      else setDownloadSaid(refusal(error, words('admin.the-export-could-not-be-4')));
    } catch {
      setDownloadSaid(words('admin.the-export-could-not-be-4'));
    }
  };

  const who = (event: AuditEventView) => {
    const name = event.labels['actor']?.text;
    if (event.actor === null || name === undefined) {
      return (
        <span className={styles['muted']}>
          {UNNAMED[event.actorKind] ?? words('admin.somebody')}
        </span>
      );
    }
    const actor = { id: event.actor, name };
    return (
      <>
        <button
          type="button"
          className={styles['plainButton']}
          aria-label={words('admin.only-what-did', { name })}
          onClick={() => choose({ actor })}
        >
          {name}
        </button>
        {event.actorKind === 'token' && (
          <span className={styles['muted']}> {words('admin.by-an-api-token')}</span>
        )}
      </>
    );
  };

  const about = (event: AuditEventView) => {
    const name = event.labels['subject']?.text;
    const id = event.subject?.id ?? null;
    // Only its subject's own name filters to it; a space's name is said, never offered as the subject.
    if (name === undefined || id === null) return name ?? event.labels['space']?.text ?? null;
    return (
      <button
        type="button"
        className={styles['plainButton']}
        aria-label={words('admin.only-events-about', { name })}
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
          {words('admin.what-happened')}
          <select value={filter.kind} onChange={(change) => choose({ kind: change.target.value })}>
            <option value="">{words('admin.everything')}</option>
            {FAMILIES.map(({ family, name, kinds }) => (
              <optgroup key={family} label={name}>
                <option value={`${family}.`}>
                  {words('admin.any-of', { value1: name.toLocaleLowerCase() })}
                </option>
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
          {words('admin.from')}
          <input
            type="date"
            value={filter.from}
            max={filter.to === '' ? undefined : filter.to}
            onChange={(change) => choose({ from: change.target.value })}
          />
        </label>
        <label className={styles['filter']}>
          {words('admin.to')}
          <input
            type="date"
            value={filter.to}
            min={filter.from === '' ? undefined : filter.from}
            onChange={(change) => choose({ to: change.target.value })}
          />
        </label>
        <button
          type="button"
          className={styles['exportButton']}
          disabled={exporting.state === 'writing'}
          onClick={() => void exportShown()}
        >
          {words('admin.export')}
        </button>
        {filter.actor !== null && (
          <Chip tone="accent">
            {words('admin.who', { name: filter.actor.name })}
            <button
              type="button"
              className={styles['plainButton']}
              aria-label={words('admin.stop-showing-only-what-did', { name: filter.actor.name })}
              onClick={() => choose({ actor: null })}
            >
              ×
            </button>
          </Chip>
        )}
        {filter.subject !== null && (
          <Chip tone="accent">
            {words('admin.about', { name: filter.subject.name })}
            <button
              type="button"
              className={styles['plainButton']}
              aria-label={words('admin.stop-showing-only-events-about', {
                name: filter.subject.name,
              })}
              onClick={() => choose({ subject: null })}
            >
              ×
            </button>
          </Chip>
        )}
      </div>
      <p role="status" className={styles['exported']}>
        {exporting.state === 'writing' && words('admin.writing-the-export')}
        {exporting.state === 'failed' && exporting.said}
        {exporting.state === 'done' &&
          words('admin.the-export-holds', {
            value1: eventsCounted(exporting.events),
            value2: downloadSaid === '' ? '' : ` ${downloadSaid}`,
          })}
      </p>
      {exporting.state === 'done' && (
        <p>
          <button type="button" className="primary" onClick={() => void download(exporting.id)}>
            {words('admin.download-export')}
          </button>
        </p>
      )}
      {read === null ? (
        <Waiting>{words('admin.loading')}</Waiting>
      ) : read === 'refused' ? (
        <Notice tone="refused">
          <p>{words('admin.you-may-not-read-the')}</p>
        </Notice>
      ) : read === 'signedOut' ? (
        <Notice tone="signedOut">
          <p>{words('admin.you-are-signed-out-sign')}</p>
        </Notice>
      ) : read === 'failed' ? (
        <Notice tone="failed">
          <p>{words('admin.the-audit-log-could-not')}</p>
        </Notice>
      ) : read.rows.length === 0 ? (
        <Empty>
          <p>{words('admin.no-events-match')}</p>
        </Empty>
      ) : (
        <>
          <table aria-label={words('admin.audit-log')} className={styles['table']}>
            <colgroup>
              <col className={styles['whenColumn']} />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{words('admin.when')}</th>
                <th scope="col">{words('admin.who-2')}</th>
                <th scope="col">{words('admin.what')}</th>
                <th scope="col">{words('admin.about-2')}</th>
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
                        <Chip tone="danger">{words('admin.refused')}</Chip>
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
                {words('admin.show-more')}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
  return <div className={styles['holder']}>{shown}</div>;
}
