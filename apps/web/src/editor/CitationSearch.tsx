import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';

import { entryName, flagSaid, type EntryFlag } from '../bibliography/entries.js';
import type { Csl } from '../bibliography/shape.js';
import styles from './MarkPrompt.module.css';
import own from './ReferenceDialog.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
/** A declared source's id, or a reference extension's `ext:` key (the XR plan, XR-J). */
type SourceId = string;

/** Why a result is shown but cannot be chosen. */
export const MAY_NOT_MAKE = "You may not add entries to this space's bibliography.";
/** What the tab says where no source is on. */
export const NO_SOURCES = 'No reference source is on in this environment.';

/** What a chosen result cites: an entry already in the space, or a source's record to make one of. */
export type Picked =
  { readonly entry: string } | { readonly source: SourceId; readonly identifier: string };

interface Result {
  readonly identifier: string;
  readonly csl: Csl;
  /** The space's entry for the same source, where there is one. */
  readonly match:
    | { readonly id: string; readonly key: string; readonly flag?: EntryFlag | undefined }
    | undefined;
}

/**
 * **The Cite dialog's Search tab** (the XR plan, XR-D; LIB-031): a source that is on, the terms
 * typed, which it says are sent there, and each result a radio. A result already in the space's
 * bibliography cites that entry; another is made an entry, which needs the space's write, so without
 * it such a result is shown disabled, saying why.
 */
export function CitationSearch({
  client,
  space,
  onPick,
}: {
  readonly client: Client;
  readonly space: string;
  readonly onPick: (picked: Picked | null) => void;
}) {
  const id = useId();
  const [sources, setSources] = useState<
    readonly { id: SourceId; name: string }[] | 'unread' | null
  >(null);
  const [source, setSource] = useState<SourceId | null>(null);
  const [terms, setTerms] = useState('');
  const [found, setFound] = useState<
    { results: readonly Result[]; mayCreate: boolean } | 'searching' | string | null
  >(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client.GET('/v1/reference-sources').then(
      ({ data }) => {
        if (!live) return;
        const on = (data?.items ?? []).filter((each) => each.enabled);
        setSources(data ? on : 'unread');
        setSource(on[0]?.id ?? null);
      },
      () => live && setSources('unread'),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const choose = (result: Result | undefined) => {
    setChosen(result?.identifier ?? null);
    onPick(
      result === undefined
        ? null
        : result.match
          ? { entry: result.match.id }
          : { source: source!, identifier: result.identifier },
    );
  };

  const search = async () => {
    if (source === null || terms.trim() === '') return;
    setFound('searching');
    choose(undefined);
    try {
      const { data } = await client.POST('/v1/reference-sources/{source}/search', {
        params: { path: { source } },
        body: { space: `space:${space}`, terms: terms.trim() },
      });
      if (!data) {
        setFound(words('editor.the-source-could-not-be'));
        return;
      }
      setFound({
        mayCreate: data.mayCreate,
        results: data.results.map((each) => ({
          identifier: each.identifier,
          csl: each.csl as Csl,
          match: each.matches[0]
            ? {
                id: each.matches[0].entry.id,
                key: each.matches[0].entry.key,
                flag: each.matches[0].entry.flag ?? undefined,
              }
            : undefined,
        })),
      });
    } catch {
      setFound(words('editor.the-source-could-not-be'));
    }
  };

  // Enter in the terms searches, never inserts.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void search();
  };

  if (sources === null) return <p role="status">{words('editor.reading-the-reference-sources')}</p>;
  if (sources === 'unread')
    return <p role="alert">{words('editor.the-reference-sources-could-not')}</p>;
  if (sources.length === 0) return <p className={styles['note']}>{NO_SOURCES}</p>;
  const name = sources.find((each) => each.id === source)?.name ?? '';
  return (
    <>
      <label className={styles['field']}>
        {words('editor.source')}
        <select
          value={source ?? ''}
          onChange={(event) => {
            setSource(event.target.value as SourceId);
            setFound(null);
            choose(undefined);
          }}
        >
          {sources.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      <p className={styles['note']}>{words('editor.your-search-is-sent-to', { name })}</p>
      <label className={styles['field']}>
        {words('editor.search-terms')}
        <input
          type="search"
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <div>
        <button type="button" onClick={() => void search()}>
          {words('editor.search')}
        </button>
      </div>
      {found === 'searching' && <p role="status">{words('editor.searching')}</p>}
      {typeof found === 'string' && found !== 'searching' && <p role="alert">{found}</p>}
      {typeof found === 'object' && found !== null && (
        <>
          <p className={styles['note']} aria-live="polite">
            {words('editor.results', { count: found.results.length })}
          </p>
          {found.results.length > 0 && (
            <fieldset className={own['group']}>
              <legend>{words('editor.result')}</legend>
              <div className={own['targets']}>
                {found.results.map((each) => {
                  const barred = each.match === undefined && !found.mayCreate;
                  return (
                    <label key={each.identifier} className={own['choice']}>
                      <input
                        type="radio"
                        name={`${id}-result`}
                        value={each.identifier}
                        checked={each.identifier === chosen}
                        disabled={barred}
                        aria-describedby={barred ? `${id}-barred` : undefined}
                        onChange={() => choose(each)}
                      />
                      {entryName({ id: each.identifier, key: '', csl: each.csl })}
                      {each.match &&
                        words('editor.in-the-bibliography-as', {
                          key: each.match.key,
                          value2: each.match.flag ? `, ${flagSaid(each.match.flag)}` : '',
                        })}
                    </label>
                  );
                })}
              </div>
              {!found.mayCreate && (
                <p id={`${id}-barred`} className={styles['note']}>
                  {MAY_NOT_MAKE}
                </p>
              )}
            </fieldset>
          )}
        </>
      )}
    </>
  );
}
