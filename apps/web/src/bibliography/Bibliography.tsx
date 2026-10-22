import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { isRecord } from '../data/shapes.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { entryLink } from './links.js';
import { authorsShort, authorsTyped, FOUND_BY, TYPES, yearOf, type Csl } from './shape.js';

type Client = ReturnType<typeof createApiClient>;

interface Space {
  readonly id: string;
  readonly name: string;
}

interface Summary {
  readonly id: string;
  readonly key: string;
  readonly csl: Csl;
}

interface Match {
  readonly by: string;
  readonly entry: Summary;
}

interface Imported {
  readonly outcome: 'created' | 'merged' | 'refused';
  readonly entry: Summary | null;
  readonly by: string | null;
  readonly merged: readonly string[];
  readonly dropped: readonly string[];
  readonly message: string | null;
}

const FORMATS = [
  { value: 'csl-json', label: 'CSL-JSON' },
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'ris', label: 'RIS' },
] as const;

const isSummary = (value: unknown): value is Summary =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.key === 'string' &&
  isRecord(value.csl);

/** What one record of an import came to, as a sentence. */
function importedLine(record: Imported): string {
  if (record.outcome === 'refused') return `Refused: ${record.message ?? ''}`;
  const key = record.entry?.key ?? '';
  if (record.outcome === 'created') return `${key}: made`;
  const found = `found by ${FOUND_BY[record.by ?? ''] ?? record.by}`;
  return record.merged.length === 0
    ? `${key}: already here, ${found}, nothing new`
    : `${key}: merged, ${found}, and given ${record.merged.join(', ')}`;
}

/**
 * A space's bibliography (citations.md, "The entry"; the CI plan, CI-B): its entries by key, authors,
 * title and year; a new entry by hand, offered the one already there (LIB-044); and an import of
 * pasted CSL-JSON, BibTeX or RIS, saying what each record came to (LIB-010).
 */
export function Bibliography({ client }: { readonly client: Client }) {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [entries, setEntries] = useState<readonly Summary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<'new' | 'import' | null>(null);

  useEffect(() => {
    let live = true;
    void everyPage<unknown>(async (cursor) =>
      client.GET('/v1/spaces', { params: { query: cursor === undefined ? {} : { cursor } } }),
    ).then((answer) => {
      if (!live) return;
      if (!('items' in answer)) {
        setFailed(true);
        return;
      }
      const found = answer.items.flatMap((each) =>
        isRecord(each) && typeof each.id === 'string' && typeof each.name === 'string'
          ? [{ id: each.id, name: each.name }]
          : [],
      );
      setSpaces(found);
      setSpace((held) => held ?? found[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, [client]);

  const load = useCallback(async () => {
    if (space === null) return;
    const { data } = await client.GET('/v1/spaces/{space}/bibliography-entries', {
      params: { path: { space } },
    });
    if (!data) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setEntries(data.items.filter(isSummary));
    setTotal(data.total);
  }, [client, space]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed && entries === null) {
    return (
      <section aria-labelledby="bibliography-heading">
        <h1 id="bibliography-heading">Bibliography</h1>
        <Notice tone="failed">
          <p>The bibliography could not be loaded.</p>
        </Notice>
      </section>
    );
  }
  if (spaces === null) return null;

  return (
    <section aria-labelledby="bibliography-heading">
      <div className={styles['titleRow']}>
        <h1 id="bibliography-heading">Bibliography</h1>
        {space !== null && (
          <span className={styles['actions']}>
            <button type="button" onClick={() => setOpen(open === 'import' ? null : 'import')}>
              Import
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setOpen(open === 'new' ? null : 'new')}
            >
              New entry
            </button>
          </span>
        )}
      </div>
      {spaces.length > 1 && (
        <label>
          Space{' '}
          <select value={space ?? ''} onChange={(event) => setSpace(event.target.value)}>
            {spaces.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {space !== null && open === 'new' && <NewEntry client={client} space={space} />}
      {space !== null && open === 'import' && (
        <ImportRecords client={client} space={space} onImported={() => void load()} />
      )}
      {entries === null ? null : entries.length === 0 ? (
        <Empty>
          <p>This space holds no bibliography entries you may read.</p>
        </Empty>
      ) : (
        <>
          <p className={styles['summary']}>
            <span>{`${total} ${total === 1 ? 'entry' : 'entries'} you may read.`}</span>
            {entries.length < total && <span>{`Showing 1 to ${entries.length}.`}</span>}
          </p>
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Authors</th>
                  <th scope="col">Title</th>
                  <th scope="col">Year</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className={styles['title']}>
                      <a href={entryLink(entry.id)}>{entry.key}</a>
                    </td>
                    <td>{authorsShort(entry.csl)}</td>
                    <td>{entry.csl.title ?? ''}</td>
                    <td className={styles['muted']}>{yearOf(entry.csl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** A new entry by hand: the same search as an import first, the match offered (LIB-044). */
function NewEntry({ client, space }: { readonly client: Client; readonly space: string }) {
  const [type, setType] = useState('article-journal');
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [doi, setDoi] = useState('');
  const [matches, setMatches] = useState<readonly Match[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async (despiteMatches: boolean) => {
    const author = authorsTyped(authors);
    const csl: Csl = {
      type,
      title: title.trim(),
      ...(author !== undefined && author.length > 0 ? { author } : {}),
      ...(/^\d{1,4}$/.test(year.trim())
        ? { issued: { 'date-parts': [[Number(year.trim())]] } }
        : {}),
      ...(doi.trim() === '' ? {} : { DOI: doi.trim() }),
    };
    setBusy(true);
    setProblem(null);
    try {
      const { data, error } = await client.POST('/v1/spaces/{space}/bibliography-entries', {
        params: { path: { space } },
        body: {
          entry: { csl: csl as never },
          ...(despiteMatches ? { despiteMatches: true } : {}),
        },
      });
      if (!data) {
        setProblem(
          isRecord(error) && typeof error.message === 'string'
            ? error.message
            : 'The entry could not be made.',
        );
        return;
      }
      if (data.entry !== null) {
        window.location.hash = entryLink(data.entry.id);
        return;
      }
      setMatches(data.matches.flatMap((each) => (isSummary(each.entry) ? [each as Match] : [])));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void make(false);
  };

  return (
    <form aria-label="New entry" onSubmit={submit}>
      <label>
        Type{' '}
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {TYPES.map((each) => (
            <option key={each.value} value={each.value}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title <input value={title} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Authors, one a line, family name first{' '}
        <textarea value={authors} onChange={(event) => setAuthors(event.target.value)} />
      </label>
      <label>
        Year{' '}
        <input value={year} inputMode="numeric" onChange={(event) => setYear(event.target.value)} />
      </label>
      <label>
        DOI <input value={doi} onChange={(event) => setDoi(event.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || title.trim() === ''}>
        Make entry
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
      {matches !== null && matches.length > 0 && (
        <section aria-label="Already in this space">
          <p>This source is already in the space. Open it, or make another anyway.</p>
          <ul>
            {matches.map((each) => (
              <li key={each.entry.id}>
                <a href={entryLink(each.entry.id)}>{each.entry.key}</a> {each.entry.csl.title ?? ''}
                . Found by {FOUND_BY[each.by] ?? each.by}.
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy} onClick={() => void make(true)}>
            Make it anyway
          </button>
        </section>
      )}
    </form>
  );
}

/** Records pasted as CSL-JSON, BibTeX or RIS, and what each came to (LIB-009, LIB-010). */
function ImportRecords({
  client,
  space,
  onImported,
}: {
  readonly client: Client;
  readonly space: string;
  readonly onImported: () => void;
}) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]['value']>('csl-json');
  const [text, setText] = useState('');
  const [done, setDone] = useState<readonly Imported[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { data, error } = await client.POST('/v1/spaces/{space}/bibliography-entries/import', {
        params: { path: { space } },
        body: { format, text },
      });
      if (!data) {
        setProblem(
          isRecord(error) && typeof error.message === 'string'
            ? error.message
            : 'The records could not be imported.',
        );
        return;
      }
      setDone(data.records as readonly Imported[]);
      onImported();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="Import" onSubmit={(event) => void submit(event)}>
      <label>
        Format{' '}
        <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
          {FORMATS.map((each) => (
            <option key={each.value} value={each.value}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Records <textarea value={text} rows={8} onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || text.trim() === ''}>
        Import records
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
      {done !== null && (
        <section aria-label="Imported">
          <ul>
            {done.map((record, at) => (
              <li key={at}>
                {importedLine(record)}
                {record.dropped.length > 0 && `. Not kept: ${record.dropped.join(', ')}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  );
}
