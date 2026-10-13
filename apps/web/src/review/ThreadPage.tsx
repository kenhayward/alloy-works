import type { createApiClient } from '@alloy-works/api-client';
import type { ThreadAnchor } from '@alloy-works/domain';
import { useEffect, useRef, useState } from 'react';

import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import type { ThreadOn } from '../search/links.js';
import { anchorWords } from './ThreadsPanel.js';
import styles from './ThreadPage.module.css';

type Client = ReturnType<typeof createApiClient>;
type Part = { readonly text: string } | { readonly mention: string };
interface Person {
  readonly id: string;
  readonly name: string | null;
}
interface Thread {
  readonly anchor: ThreadAnchor;
  readonly resolution: { readonly by: Person; readonly at: string } | null;
  readonly comments: readonly {
    readonly id: string;
    readonly author: Person;
    readonly at: string;
    readonly texts: readonly { readonly parts: readonly Part[] }[];
  }[];
}

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A thread at its own address, `#/{components|documents}/{id}/threads/{thread}[/comments/{comment}]`:
 * where a search result for it opens (the SV plan, SV-M; SCH-071), read only, each message at its
 * latest text and the one matched focused. Answered and resolved where it is listed, in Review.
 */
export function ThreadPage({
  client,
  on,
  thread,
  comment,
}: {
  client: Client;
  on: ThreadOn;
  thread: string;
  comment: string | null;
}) {
  const [shown, setShown] = useState<Thread | 'missing' | 'failed' | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const focused = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let current = true;
    setShown(null);
    client
      .GET('/v1/threads/{id}', { params: { path: { id: thread } } })
      .then(({ data, response }) => {
        if (!current) return;
        if (data) setShown(data as unknown as Thread);
        else setShown(response.status === 404 ? 'missing' : 'failed');
      })
      .catch(() => current && setShown('failed'));
    // The people a message names, by name; somebody where they cannot be read.
    void everyPage((cursor) =>
      client.GET('/v1/people', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((all) => {
        if (current && 'items' in all) {
          setNames(new Map(all.items.map((person) => [person.id, person.name ?? 'somebody'])));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, thread]);

  useEffect(() => {
    if (typeof shown !== 'object' || shown === null) return;
    focused.current?.scrollIntoView?.({ block: 'center' });
    focused.current?.focus();
  }, [shown]);

  const what = on.kind === 'component' ? 'component' : 'document';
  return (
    <section className={styles['threadPage']} aria-labelledby="thread-heading">
      <p>
        <a href={`#/${on.kind}s/${on.id}`}>{`Open the ${what}`}</a>
      </p>
      {shown === null && <p>Opening...</p>}
      {shown === 'missing' && <p>There is no such thread, or you may not read it.</p>}
      {shown === 'failed' && <p>The thread could not be read.</p>}
      {typeof shown === 'object' && shown !== null && (
        <>
          <h1 id="thread-heading" className={styles['threadHeading']}>
            {`A thread on ${
              shown.anchor.kind === 'span'
                ? anchorWords(shown.anchor)
                : anchorWords(shown.anchor).toLowerCase()
            }`}
          </h1>
          {shown.resolution && (
            <p>
              <Chip tone="ok">{`Resolved by ${shown.resolution.by.name ?? 'somebody'}, ${when.format(new Date(shown.resolution.at))}`}</Chip>
            </p>
          )}
          <ol className={styles['threadMessages']}>
            {shown.comments.map((each) => {
              const latest = each.texts[each.texts.length - 1]!;
              const matched = each.id === comment;
              return (
                <li
                  key={each.id}
                  ref={matched ? focused : undefined}
                  tabIndex={matched ? -1 : undefined}
                  data-matched={matched}
                  className={styles['threadMessage']}
                >
                  <p className={styles['threadWho']}>
                    {`${each.author.name ?? 'Somebody'}, ${when.format(new Date(each.at))}`}
                  </p>
                  <p>
                    {latest.parts.map((part, index) =>
                      'text' in part ? (
                        <span key={index}>{part.text}</span>
                      ) : (
                        <span key={index}>{`@${names.get(part.mention) ?? 'somebody'}`}</span>
                      ),
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
