import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { More } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from './Deleted.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Kind = 'component' | 'document';

/** A deleted one as the Deleted listing answers it (the DL plan, DL-H). */
interface Row {
  readonly id: string;
  readonly kind: Kind;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly deletedBy: { readonly id: string; readonly name: string | null };
  readonly deletedAt: string;
  readonly mayUndelete: boolean;
}

const PLURAL: Readonly<Record<Kind, string>> = { component: 'components', document: 'documents' };
const LINK: Readonly<Record<Kind, (id: string) => string>> = {
  component: (id) => `#/components/${id}`,
  document: (id) => `#/documents/${id}`,
};

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The deleted components or documents the reader may read, the latest deleted first, a page at a
 * time, with who deleted each and when, and **Undelete** where the service says the reader may
 * (`retire`). Undeleting is never refused, by a hold or a keep.
 */
export function DeletedList({ client, kind }: { client: Client; kind: Kind }) {
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const { data, response } = await client.GET('/v1/deleted', {
        params: { query: { kind, ...(cursor === null ? {} : { cursor }) } },
      });
      return { response, ...(data ? { data: { ...data, facets: null } } : {}) };
    },
    [client, kind],
  );
  const listing = usePagedListing<Row, null>(fetchPage);
  const [undone, setUndone] = useState<readonly Row[]>([]);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const plural = PLURAL[kind];

  const undelete = async (row: Row) => {
    setBusy(true);
    const path = { params: { path: { id: row.id } } };
    const answer = await (
      kind === 'component'
        ? client.POST('/v1/components/{id}/undelete', path)
        : client.POST('/v1/documents/{id}/undelete', path)
    ).catch(() => undefined);
    setBusy(false);
    if (answer?.data) {
      setUndone((held) => [...held, row]);
      setSaid(words('lifecycle.undeleted', { title: row.title }));
    } else setSaid(words('lifecycle.could-not-be-undeleted-try', { title: row.title }));
  };

  const heading = <h1 id="deleted-heading">{words('lifecycle.deleted', { plural })}</h1>;
  if (listing.items === null) {
    if (listing.failed === undefined) return null;
    return (
      <section aria-labelledby="deleted-heading">
        {heading}
        <Notice tone="failed">
          <p>{words('lifecycle.the-deleted-could-not-be', { plural })}</p>
          <button type="button" disabled={listing.loading} onClick={() => void listing.load(null)}>
            {words('lifecycle.try-again')}
          </button>
        </Notice>
      </section>
    );
  }
  const gone = new Set(undone.map((each) => each.id));
  const rows = listing.items.filter((each) => !gone.has(each.id));
  const total = listing.total - undone.length;
  const back = undone.at(-1);
  return (
    <section aria-labelledby="deleted-heading">
      {heading}
      <p className={styles['summary']}>
        {words('lifecycle.deleted-you-may-read', { total, value2: total === 1 ? kind : plural })}
      </p>
      <p role="status" className={styles['said']}>
        {said}
      </p>
      {back !== undefined && said === `Undeleted ${back.title}.` && (
        <p>
          <a href={LINK[kind](back.id)}>{words('lifecycle.open', { title: back.title })}</a>
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>
          <p>{words('lifecycle.there-are-no-deleted-you', { plural })}</p>
        </Empty>
      ) : (
        <div className={styles['deletedTable']}>
          <table aria-label={words('lifecycle.deleted', { plural })}>
            <thead>
              <tr>
                <th scope="col">{words('lifecycle.title')}</th>
                <th scope="col">{words('lifecycle.space')}</th>
                <th scope="col">{words('lifecycle.deleted-by')}</th>
                <th scope="col">{words('lifecycle.deleted-2')}</th>
                <td aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles['deletedTitle']}>{row.title}</td>
                  <td className={styles['quiet']}>{row.space.name}</td>
                  <td className={styles['quiet']}>
                    {row.deletedBy.name ?? words('lifecycle.somebody')}
                  </td>
                  <td className={styles['quiet']}>
                    <time dateTime={row.deletedAt}>{when.format(new Date(row.deletedAt))}</time>
                  </td>
                  <td className={styles['undo']}>
                    {row.mayUndelete && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={words('lifecycle.undelete', { title: row.title })}
                        onClick={() => void undelete(row)}
                      >
                        {words('lifecycle.undelete-2')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <More listing={listing} what={words('lifecycle.deleted-3', { plural })} />
    </section>
  );
}
