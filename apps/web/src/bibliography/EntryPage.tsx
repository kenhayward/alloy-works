import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { Notice } from '../states/Notice.js';
import { BIBLIOGRAPHY } from './links.js';
import { authorsFull, TYPES, yearOf, type Csl } from './shape.js';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly id: string;
  readonly space: { readonly name: string };
  readonly version: { readonly number: string };
  readonly entry: {
    readonly key: string;
    readonly csl: Csl;
    readonly obtained?: { readonly from: string; readonly at: string };
    readonly checkedAt?: string;
  };
  readonly archived: boolean;
  readonly mayRetire: boolean;
}

interface Uses {
  readonly components: {
    readonly named: readonly { readonly id: string; readonly title: string }[];
    readonly unreadable: boolean;
  };
  readonly baselines: {
    readonly named: readonly {
      readonly id: string;
      readonly name: string;
      readonly document: string;
    }[];
    readonly unreadable: boolean;
  };
}

/**
 * A bibliography entry's page (citations.md, "The entry"): its key, authors, title and year, where it
 * was obtained and when checked (LIB-011), and where it is cited; archived only while nothing cites
 * it (citations.md, "Kept while cited").
 */
export function EntryPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [uses, setUses] = useState<Uses | null>(null);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await client.GET('/v1/bibliography-entries/{id}', {
        params: { path: { id } },
      });
      if (!live) return;
      if (!data) {
        setFailed(true);
        return;
      }
      setShown(data as unknown as Shown);
      const used = await client.GET('/v1/bibliography-entries/{id}/uses', {
        params: { path: { id } },
      });
      if (live && used.data) setUses(used.data);
    })();
    return () => {
      live = false;
    };
  }, [client, id]);

  if (failed) {
    return (
      <Notice tone="failed">
        <p>The entry could not be loaded.</p>
      </Notice>
    );
  }
  if (shown === null) return null;
  const { csl } = shown.entry;
  const cited =
    uses !== null &&
    (uses.components.named.length > 0 ||
      uses.baselines.named.length > 0 ||
      uses.components.unreadable ||
      uses.baselines.unreadable);

  const archive = async (archived: boolean) => {
    setProblem(null);
    const path = archived
      ? '/v1/bibliography-entries/{id}/archive'
      : '/v1/bibliography-entries/{id}/unarchive';
    const { data, error } = await client.POST(path, { params: { path: { id } } });
    if (!data) {
      setProblem(
        (error as { message?: string } | undefined)?.message ?? 'The entry could not be changed.',
      );
      return;
    }
    setShown({ ...shown, archived: data.archived });
  };

  return (
    <article aria-labelledby="entry-heading">
      <p>
        <a href={BIBLIOGRAPHY}>Bibliography</a>
      </p>
      <h1 id="entry-heading">{shown.entry.key}</h1>
      <dl>
        <dt>Authors</dt>
        <dd>{authorsFull(csl)}</dd>
        <dt>Title</dt>
        <dd>{csl.title ?? ''}</dd>
        <dt>Year</dt>
        <dd>{yearOf(csl)}</dd>
        <dt>Type</dt>
        <dd>{TYPES.find((each) => each.value === csl.type)?.label ?? csl.type}</dd>
        {csl.DOI !== undefined && (
          <>
            <dt>DOI</dt>
            <dd>{csl.DOI}</dd>
          </>
        )}
        {shown.entry.obtained !== undefined && (
          <>
            <dt>Obtained</dt>
            <dd>
              {shown.entry.obtained.from},{' '}
              <time dateTime={shown.entry.obtained.at}>{shown.entry.obtained.at.slice(0, 10)}</time>
            </dd>
          </>
        )}
        {shown.entry.checkedAt !== undefined && (
          <>
            <dt>Last checked</dt>
            <dd>
              <time dateTime={shown.entry.checkedAt}>{shown.entry.checkedAt.slice(0, 10)}</time>
            </dd>
          </>
        )}
        <dt>Space</dt>
        <dd>{shown.space.name}</dd>
        <dt>Version</dt>
        <dd>{shown.version.number}</dd>
      </dl>
      {shown.archived && <p>This entry is archived.</p>}
      {uses !== null && (
        <section aria-label="Cited in">
          <h2>Cited in</h2>
          {!cited && <p>Nothing cites this entry.</p>}
          {uses.components.named.length > 0 && (
            <ul>
              {uses.components.named.map((each) => (
                <li key={each.id}>
                  <a href={`#/components/${each.id}`}>{each.title}</a>
                </li>
              ))}
            </ul>
          )}
          {uses.baselines.named.length > 0 && (
            <ul aria-label="Baselines">
              {uses.baselines.named.map((each) => (
                <li key={each.id}>Baseline {each.name}</li>
              ))}
            </ul>
          )}
          {(uses.components.unreadable || uses.baselines.unreadable) && (
            <p>Cited in more you may not read.</p>
          )}
        </section>
      )}
      {shown.mayRetire && (
        <p>
          {shown.archived ? (
            <button type="button" onClick={() => void archive(false)}>
              Unarchive
            </button>
          ) : (
            <button type="button" disabled={cited} onClick={() => void archive(true)}>
              Archive
            </button>
          )}
          {!shown.archived && cited && ' A cited entry is kept, so it cannot be archived.'}
        </p>
      )}
      {problem !== null && (
        <Notice tone="failed">
          <p>{problem}</p>
        </Notice>
      )}
    </article>
  );
}
