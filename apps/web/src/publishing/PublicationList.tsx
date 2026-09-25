import type { PublicationList as Listing, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Empty } from '../states/Empty.js';
import { Lozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { formatsWords } from './formats.js';

type Client = ReturnType<typeof createApiClient>;
type Item = Listing['items'][number];

/**
 * Every publication the signed-in person may read, of every document, newest first, in layout A. The
 * service answers them all at once, so the Document facet is counted and applied here, over rows it
 * has already filtered by what the reader may read.
 */
export function PublicationList({ client }: { client: Client }) {
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [problem, setProblem] = useState<'signedOut' | 'failed' | null>(null);
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<readonly string[]>([]);
  const request = useRef(0);

  const load = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true);
    setProblem(null);
    try {
      const { data, response } = await client.GET('/v1/publications');
      if (request.current !== generation) return;
      if (!data) {
        setProblem(response.status === 401 ? 'signedOut' : 'failed');
        return;
      }
      setItems(data.items);
    } catch {
      if (request.current === generation) setProblem('failed');
    } finally {
      if (request.current === generation) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  if (problem !== null) {
    return (
      <section aria-labelledby="publications-heading">
        <h1 id="publications-heading">Publications</h1>
        {problem === 'signedOut' ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your publications.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The publications could not be loaded.</p>
            <button type="button" disabled={loading} onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
      </section>
    );
  }
  if (items === null) return null;

  // Each document published, named by its latest publication's title, with how many there are.
  const byDocument = new Map<string, { title: string; count: number }>();
  for (const item of items) {
    const known = byDocument.get(item.document);
    byDocument.set(item.document, {
      title: known?.title ?? item.title,
      count: (known?.count ?? 0) + 1,
    });
  }
  const shown = items.filter((item) => documents.length === 0 || documents.includes(item.document));

  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>Filter</span>
        {documents.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setDocuments([])}>
            Clear
          </button>
        )}
      </div>
      <fieldset className={styles['facet']}>
        <legend className={styles['overline']}>Document</legend>
        {[...byDocument].map(([document, { title, count }]) => (
          <label key={document} className={styles['option']}>
            <input
              type="checkbox"
              checked={documents.includes(document)}
              onChange={() =>
                setDocuments((held) =>
                  held.includes(document)
                    ? held.filter((one) => one !== document)
                    : [...held, document],
                )
              }
            />
            <span className={styles['optionName']}>{title}</span>
            <span className={styles['count']}>{count}</span>
          </label>
        ))}
      </fieldset>
    </>
  );

  return (
    <ListLayout filter={filter}>
      <section aria-labelledby="publications-heading">
        <div className={styles['titleRow']}>
          <h1 id="publications-heading">Publications</h1>
        </div>
        <p className={styles['summary']}>
          <span>{`${items.length} ${items.length === 1 ? 'publication' : 'publications'} you may read.`}</span>
          {documents.length > 0 && <span>{`Showing ${shown.length} of ${items.length}.`}</span>}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>Nothing has been published that you may read.</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Version</th>
                  <th scope="col">Formats</th>
                  <th scope="col">Published</th>
                  <th scope="col">By</th>
                  <th scope="col">Approval</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a className={styles['title']} href={`#/publications/${item.id}`}>
                        {item.title}
                      </a>
                    </td>
                    <td>{item.version.number}</td>
                    <td>{formatsWords(item.formats)}</td>
                    <td className={styles['muted']}>
                      <time dateTime={item.publishedAt}>{whenChanged(item.publishedAt)}</time>
                    </td>
                    <td className={styles['muted']}>{item.publisher.displayName ?? ''}</td>
                    <td>
                      <Lozenge kind="notApproved">Not approved</Lozenge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ListLayout>
  );
}
