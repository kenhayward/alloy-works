import type { createApiClient } from '@alloy-works/api-client';
import { Outside } from '../parts/Outside.js';
import type { ThreadAnchor } from '@alloy-works/domain';
import { useEffect, useRef, useState } from 'react';

import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import type { ThreadOn } from '../search/links.js';
import { reviewThreadLink } from '../structure/links.js';
import { anchorWords } from './ThreadsPanel.js';
import styles from './ThreadPage.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Part = { readonly text: string } | { readonly mention: string };
interface Person {
  readonly id: string;
  readonly name: string | null;
  /** From outside the organisation (IAM-045). */
  readonly external?: true | undefined;
}
interface Thread {
  readonly on: ThreadOn;
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
 * latest text and the one matched focused, and said to be orphaned as its listing says (COL-017).
 * Answered and resolved in Review: a document's thread offers Open in Review.
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
  const [orphaned, setOrphaned] = useState(false);
  const focused = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let current = true;
    setShown(null);
    client
      .GET('/v1/threads/{id}', { params: { path: { id: thread } } })
      .then(({ data, response }) => {
        if (!current) return;
        const read = data as unknown as Thread | undefined;
        // What it is on is the thread's: an address naming something else names no thread.
        if (read) setShown(read.on.kind === on.kind && read.on.id === on.id ? read : 'missing');
        else setShown(response.status === 404 ? 'missing' : 'failed');
      })
      .catch(() => current && setShown('failed'));
    // Orphaned as the list of threads on it says (COL-017), page by page until it is found.
    void (async () => {
      let cursor: string | undefined;
      do {
        const query = { limit: '100', ...(cursor === undefined ? {} : { cursor }) };
        const { data } =
          on.kind === 'component'
            ? await client.GET('/v1/components/{id}/threads', {
                params: { path: { id: on.id }, query },
              })
            : await client.GET('/v1/documents/{id}/threads', {
                params: { path: { id: on.id }, query },
              });
        if (!data || !current) return;
        const listed = data.threads.find((each) => each.id === thread);
        if (listed) {
          setOrphaned(listed.orphaned);
          return;
        }
        cursor = data.next ?? undefined;
      } while (cursor !== undefined);
    })().catch(() => undefined);
    // The people a message names, by name; somebody where they cannot be read.
    void everyPage((cursor) =>
      client.GET('/v1/people', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((all) => {
        if (current && 'items' in all) {
          setNames(
            new Map(
              all.items.map((person) => [person.id, person.name ?? words('review.somebody')]),
            ),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, thread, on.kind, on.id]);

  useEffect(() => {
    if (typeof shown !== 'object' || shown === null) return;
    focused.current?.scrollIntoView?.({ block: 'center' });
    focused.current?.focus();
  }, [shown]);

  const read = typeof shown === 'object' && shown !== null ? shown : null;
  return (
    <section
      className={styles['threadPage']}
      {...(read === null ? {} : { 'aria-labelledby': 'thread-heading' })}
    >
      {read !== null && (
        <p className={styles['threadLinks']}>
          <a href={`#/${read.on.kind}s/${read.on.id}`}>
            {words('review.open-the', { kind: read.on.kind })}
          </a>
          {read.on.kind === 'document' && (
            <a href={reviewThreadLink(read.on.id, thread)}>{words('review.open-in-review')}</a>
          )}
        </p>
      )}
      {shown === null && <p>{words('review.opening')}</p>}
      {shown === 'missing' && <p>{words('review.there-is-no-such-thread')}</p>}
      {shown === 'failed' && <p>{words('review.the-thread-could-not-be')}</p>}
      {typeof shown === 'object' && shown !== null && (
        <>
          <h1 id="thread-heading" className={styles['threadHeading']}>
            {words('review.a-thread-on', {
              value1:
                shown.anchor.kind === 'span'
                  ? anchorWords(shown.anchor)
                  : anchorWords(shown.anchor).toLowerCase(),
            })}
          </h1>
          {orphaned && (
            <p>
              <Chip tone="warn">{words('review.its-text-is-no-longer')}</Chip>
            </p>
          )}
          {shown.resolution && (
            <p>
              <Chip tone="ok">
                {words('review.resolved-by', {
                  value1: shown.resolution.by.name ?? 'somebody',
                  value2: when.format(new Date(shown.resolution.at)),
                })}
              </Chip>
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
                    {each.author.name ?? words('review.somebody')}
                    <Outside person={each.author} />
                    {`, ${when.format(new Date(each.at))}`}
                  </p>
                  <p>
                    {latest.parts.map((part, index) =>
                      'text' in part ? (
                        <span key={index}>{part.text}</span>
                      ) : (
                        <span
                          key={index}
                        >{`@${names.get(part.mention) ?? words('review.somebody')}`}</span>
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
