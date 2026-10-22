import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { isRecord } from '../data/shapes.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { StateLozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { termLink } from './links.js';
import { isSummary, said, saveText, type Summary } from './shape.js';

type Client = ReturnType<typeof createApiClient>;

interface Space {
  readonly id: string;
  readonly name: string;
}

interface Imported {
  readonly key: string;
  readonly outcome: 'created' | 'merged' | 'refused';
  readonly term: { readonly id: string; readonly label: string } | null;
  readonly merged: readonly string[];
  readonly message: string | null;
}

interface Unrepresented {
  readonly concept: string | null;
  readonly what: string;
  readonly detail: string;
}

const FORMATS = [
  { value: 'json-ld', label: 'SKOS JSON-LD' },
  { value: 'turtle', label: 'SKOS Turtle' },
] as const;

/** What one concept of an import came to, as a sentence. */
function importedLine(each: Imported): string {
  if (each.outcome === 'refused') return `${each.key}: refused. ${each.message ?? ''}`;
  const label = each.term?.label ?? each.key;
  if (each.outcome === 'created') return `${label}: made`;
  return each.merged.length === 0
    ? `${label}: already here, nothing new`
    : `${label}: merged, and given ${each.merged.join(', ')}`;
}

/**
 * A space's terms (terms.md, "The term"; the TM plan, TM-A): each by its preferred label and
 * abbreviation, with its standing; a new term by its preferred label; SKOS imported, saying what no
 * term could hold (LIB-029), and exported (LIB-028).
 */
export function Terms({ client }: { readonly client: Client }) {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [terms, setTerms] = useState<readonly Summary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<'new' | 'import' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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
    const { data } = await client.GET('/v1/spaces/{space}/terms', { params: { path: { space } } });
    if (!data) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setTerms(data.items.filter(isSummary));
    setTotal(data.total);
  }, [client, space]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The space's terms as SKOS JSON-LD, saved as a file (LIB-028). */
  const exportTerms = async () => {
    if (space === null) return;
    setProblem(null);
    const { data } = await client.GET('/v1/spaces/{space}/terms/export', {
      params: { path: { space } },
    });
    if (!data) {
      setProblem('The terms could not be exported.');
      return;
    }
    saveText('terms.jsonld', data.text, 'application/ld+json');
  };

  if (failed && terms === null) {
    return (
      <section aria-labelledby="terms-heading">
        <h1 id="terms-heading">Terms</h1>
        <Notice tone="failed">
          <p>The terms could not be loaded.</p>
        </Notice>
      </section>
    );
  }
  if (spaces === null) return null;

  return (
    <section aria-labelledby="terms-heading">
      <div className={styles['titleRow']}>
        <h1 id="terms-heading">Terms</h1>
        {space !== null && (
          <span className={styles['actions']}>
            <button type="button" onClick={() => void exportTerms()}>
              Export
            </button>
            <button type="button" onClick={() => setOpen(open === 'import' ? null : 'import')}>
              Import
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setOpen(open === 'new' ? null : 'new')}
            >
              New term
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
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
      {space !== null && open === 'new' && <NewTerm client={client} space={space} />}
      {space !== null && open === 'import' && (
        <ImportTerms client={client} space={space} onImported={() => void load()} />
      )}
      {terms === null ? null : terms.length === 0 ? (
        <Empty>
          <p>This space holds no terms you may read.</p>
        </Empty>
      ) : (
        <>
          <p className={styles['summary']}>
            <span>{`${total} ${total === 1 ? 'term' : 'terms'} you may read.`}</span>
            {terms.length < total && <span>{`Showing 1 to ${terms.length}.`}</span>}
          </p>
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col">Abbreviation</th>
                  <th scope="col">Standing</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((each) => (
                  <tr key={each.id}>
                    <td className={styles['title']}>
                      <a href={termLink(each.id)}>{each.label}</a>
                    </td>
                    <td>{each.abbreviation ?? ''}</td>
                    <td>{each.state && <StateLozenge state={each.state} />}</td>
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

/** A new term by its preferred label in its base language; the rest on its page. */
function NewTerm({ client, space }: { readonly client: Client; readonly space: string }) {
  const [preferred, setPreferred] = useState('');
  const [language, setLanguage] = useState('en');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { data, error } = await client.POST('/v1/spaces/{space}/terms', {
        params: { path: { space } },
        body: {
          term: {
            schemaVersion: 1,
            base: language.trim(),
            labels: [{ language: language.trim(), preferred: preferred.trim(), alternatives: [] }],
            definition: [],
            broader: [],
            narrower: [],
            related: [],
          },
        },
      });
      if (!data) {
        setProblem(said(error, 'The term could not be made.'));
        return;
      }
      window.location.hash = termLink(data.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label="New term" onSubmit={(event) => void submit(event)}>
      <label>
        Preferred label{' '}
        <input value={preferred} required onChange={(event) => setPreferred(event.target.value)} />
      </label>
      <label>
        Language <input value={language} onChange={(event) => setLanguage(event.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || preferred.trim() === ''}>
        Make term
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </form>
  );
}

/** SKOS pasted as JSON-LD or Turtle, what each concept came to, and what none could hold. */
function ImportTerms({
  client,
  space,
  onImported,
}: {
  readonly client: Client;
  readonly space: string;
  readonly onImported: () => void;
}) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]['value']>('json-ld');
  const [text, setText] = useState('');
  const [done, setDone] = useState<{
    readonly concepts: readonly Imported[];
    readonly unrepresented: readonly Unrepresented[];
    readonly total: number;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { data, error } = await client.POST('/v1/spaces/{space}/terms/import', {
        params: { path: { space } },
        body: { format, text },
      });
      if (!data) {
        setProblem(said(error, 'The terms could not be imported.'));
        return;
      }
      setDone({
        concepts: data.concepts as readonly Imported[],
        unrepresented: data.unrepresented,
        total: data.unrepresentedTotal,
      });
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
        SKOS <textarea value={text} rows={8} onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || text.trim() === ''}>
        Import terms
      </button>
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
      {done !== null && (
        <section aria-label="Imported">
          <ul>
            {done.concepts.map((each) => (
              <li key={each.key}>{importedLine(each)}</li>
            ))}
          </ul>
          {done.unrepresented.length > 0 && (
            <ul aria-label="Not represented">
              {done.unrepresented.map((each, at) => (
                <li key={at}>
                  {`Not represented: ${each.concept === null ? '' : `${each.concept}, `}${each.detail}`}
                </li>
              ))}
            </ul>
          )}
          {done.total > done.unrepresented.length && (
            <p>{`And ${done.total - done.unrepresented.length} more not represented.`}</p>
          )}
        </section>
      )}
    </form>
  );
}
