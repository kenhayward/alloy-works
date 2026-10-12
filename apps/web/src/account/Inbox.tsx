import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Inbox.module.css';
import { moment, refusal } from './TokenTable.js';

type Client = ReturnType<typeof createApiClient>;
type Kind = 'mention' | 'reply' | 'resolution' | 'round';
type Cadence = 'at_once' | 'daily' | 'never';
type Part = { readonly text: string } | { readonly mention: string };

interface Place {
  readonly id: string;
  readonly title: string | null;
}

interface Notification {
  readonly id: string;
  readonly kind: Kind | 'digest';
  readonly actor: { readonly id: string; readonly name: string | null } | null;
  readonly thread: string | null;
  /** A round a person was named a reviewer on (RR-H). */
  readonly round?: string | null;
  readonly on: Place | null;
  readonly counts: {
    readonly mention: number;
    readonly reply: number;
    readonly resolution: number;
    readonly round?: number;
    readonly places: readonly Place[];
  } | null;
  readonly at: string;
  readonly read: boolean;
}

interface Thread {
  readonly on: { readonly id: string; readonly kind: 'component' | 'document' };
  readonly resolution: unknown;
  readonly comments: readonly {
    readonly id: string;
    readonly author: { readonly name: string | null };
    readonly at: string;
    readonly texts: readonly { readonly parts: readonly Part[] }[];
  }[];
}

const KINDS: readonly { readonly kind: Kind; readonly name: string }[] = [
  { kind: 'mention', name: 'When a comment names you' },
  { kind: 'reply', name: 'Replies on threads you are in' },
  { kind: 'resolution', name: 'Threads you are in resolved' },
  { kind: 'round', name: 'When you are named a reviewer' },
];
const CADENCES: Readonly<Record<Cadence, string>> = {
  at_once: 'At once',
  daily: 'In a daily digest',
  never: 'Never',
};

/** What it is about, to its reader: the title where they may read it now, else not even that. */
const placeWords = (place: Place | null) => place?.title ?? 'something you may no longer read';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What happened, in words (COL-063): who did what, and where. Never the comment's text (COL-036). */
function said(each: Notification): string {
  const who = each.actor?.name ?? 'Somebody';
  switch (each.kind) {
    case 'mention':
      return `${who} mentioned you on ${placeWords(each.on)}`;
    case 'reply':
      return `${who} replied on ${placeWords(each.on)}`;
    case 'resolution':
      return `${who} resolved a thread on ${placeWords(each.on)}`;
    case 'round':
      return `${who} asked you to review ${placeWords(each.on)}`;
    case 'digest': {
      const counts = each.counts!;
      const parts = [
        counts.mention > 0 ? plural(counts.mention, 'mention', 'mentions') : null,
        counts.reply > 0 ? plural(counts.reply, 'reply', 'replies') : null,
        counts.resolution > 0 ? plural(counts.resolution, 'resolution', 'resolutions') : null,
        (counts.round ?? 0) > 0
          ? plural(counts.round!, 'review asked of you', 'reviews asked of you')
          : null,
      ].filter((part): part is string => part !== null);
      return `Your daily digest: ${parts.join(', ')}, on ${counts.places.map(placeWords).join(', ')}`;
    }
  }
}

/** Where a thread's artifact opens. */
const hrefOf = (on: Thread['on']) =>
  on.kind === 'component' ? `#/components/${on.id}` : `#/documents/${on.id}`;

/**
 * **The inbox, from the account chip** (COL-063; the TH plan, Task 4): a modal, as Sessions is.
 * Your notifications newest first, each opened to read its thread as you may read it now, marked
 * read, or deleted; and how often you are told of each kind (COL-034).
 */
export function Inbox({ client, onClose }: { client: Client; onClose: () => void }) {
  const ids = useId();
  const [read, setRead] = useState<readonly Notification[] | 'failed' | null>(null);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; thread: Thread | 'gone' } | null>(null);
  const [cadences, setCadences] = useState<Record<Kind, Cadence> | null>(null);
  const [status, setStatus] = useState('');
  // Who a comment names, by name: read once, when a thread is first opened.
  const [names, setNames] = useState<ReadonlyMap<string, string> | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.GET('/v1/inbox', { params: { query: {} } });
      if (!data) return setRead('failed');
      setRead(data.notifications as unknown as Notification[]);
      setUnread(data.unread);
      setNext(data.next);
    } catch {
      setRead('failed');
    }
  }, [client]);

  useEffect(() => {
    void load();
    void client
      .GET('/v1/inbox/preferences')
      .then(({ data }) => data && setCadences(data))
      .catch(() => undefined);
  }, [client, load]);

  const more = async () => {
    if (next === null || read === null || read === 'failed') return;
    const { data } = await client.GET('/v1/inbox', { params: { query: { cursor: next } } });
    if (!data) return;
    setRead([...read, ...(data.notifications as unknown as Notification[])]);
    setNext(data.next);
  };

  // Marked where it stands, so the pages already shown stay shown (the TH final review).
  const markRead = async (each: Notification) => {
    if (each.read) return;
    const { response } = await client.POST('/v1/inbox/{id}/read', {
      params: { path: { id: each.id } },
    });
    if (!response.ok) return;
    setRead((was) =>
      was === null || was === 'failed'
        ? was
        : was.map((one) => (one.id === each.id ? { ...one, read: true } : one)),
    );
    setUnread((count) => Math.max(count - 1, 0));
  };

  // Read as the reader, now: a thread they may no longer read is gone to them (COL-036).
  const open = async (each: Notification) => {
    if (each.thread === null) return;
    if (names === null) {
      void everyPage((cursor) =>
        client.GET('/v1/people', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      )
        .then((all) => {
          if ('items' in all)
            setNames(new Map(all.items.map((person) => [person.id, person.name])));
        })
        .catch(() => setNames(new Map()));
    }
    const { data, response } = await client.GET('/v1/threads/{id}', {
      params: { path: { id: each.thread } },
    });
    if (!data && response.status !== 404) {
      setStatus('The thread could not be read. Try again.');
      return;
    }
    setOpened({ id: each.id, thread: data ? (data as unknown as Thread) : 'gone' });
    await markRead(each);
  };

  const remove = async (each: Notification) => {
    const { response, error } = await client.DELETE('/v1/inbox/{id}', {
      params: { path: { id: each.id } },
    });
    setStatus(
      response.ok || response.status === 404
        ? 'Deleted.'
        : refusal(error, 'It could not be deleted.'),
    );
    if (opened?.id === each.id) setOpened(null);
    await load();
  };

  const save = async () => {
    if (cadences === null) return;
    const { data, error } = await client.PUT('/v1/inbox/preferences', { body: cadences });
    if (data) setCadences(data);
    setStatus(data ? 'Saved how often you are told.' : refusal(error, 'They could not be saved.'));
  };

  const notifications = read === null || read === 'failed' ? null : read;

  return (
    <Modal labelledBy={`${ids}-heading`} onClose={onClose}>
      <div className={styles['inbox']}>
        <h2 id={`${ids}-heading`}>Inbox</h2>
        <p className={styles['muted']}>
          {unread === 0 ? 'Nothing unread.' : plural(unread, 'unread', 'unread')}
        </p>
        {read === null && <Waiting>Loading...</Waiting>}
        {read === 'failed' && (
          <Notice tone="failed">
            <p>Your inbox could not be loaded.</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
        {notifications?.length === 0 && <p className={styles['muted']}>Nothing here yet.</p>}
        {notifications !== null && notifications.length > 0 && (
          <ul className={styles['rows']} aria-label="Notifications">
            {notifications.map((each) => (
              <li key={each.id} className={styles['row']} data-unread={!each.read}>
                <span className={styles['said']}>{said(each)}</span>
                <span className={styles['muted']}>
                  {moment(each.at)}
                  {each.read ? '' : ', unread'}
                </span>
                <span className={styles['acts']}>
                  {each.thread !== null && (
                    <button type="button" onClick={() => void open(each)}>
                      Open
                    </button>
                  )}
                  {/* A round opens its document, in Review, where its rounds are listed (RR-E). */}
                  {each.kind === 'round' && each.round != null && each.on !== null && (
                    <a href={`#/documents/${each.on.id}`} onClick={() => void markRead(each)}>
                      Open the document
                    </a>
                  )}
                  {!each.read && (
                    <button type="button" onClick={() => void markRead(each)}>
                      Mark read
                    </button>
                  )}
                  <button type="button" onClick={() => void remove(each)}>
                    Delete
                  </button>
                </span>
                {opened?.id === each.id &&
                  (opened.thread === 'gone' ? (
                    <p className={styles['muted']}>You may no longer read this thread.</p>
                  ) : (
                    <div className={styles['thread']}>
                      <ol>
                        {opened.thread.comments.map((comment) => (
                          <li key={comment.id}>
                            <span className={styles['muted']}>
                              {`${comment.author.name ?? 'Somebody'}, ${moment(comment.at)}`}
                            </span>
                            <p>
                              {comment.texts[comment.texts.length - 1]!.parts.map((part, index) =>
                                'text' in part ? (
                                  <span key={index}>{part.text}</span>
                                ) : (
                                  <span key={index} className={styles['mention']}>
                                    {`@${names?.get(part.mention) ?? 'somebody'}`}
                                  </span>
                                ),
                              )}
                            </p>
                          </li>
                        ))}
                      </ol>
                      <a href={hrefOf(opened.thread.on)} onClick={onClose}>
                        {`Go to ${placeWords(each.on)}`}
                      </a>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {next !== null && (
          <button type="button" onClick={() => void more()}>
            Show more
          </button>
        )}
        {cadences !== null && (
          <fieldset className={styles['preferences']}>
            <legend>How often you are told</legend>
            {KINDS.map(({ kind, name }) => (
              <span key={kind} className={styles['preference']}>
                <label htmlFor={`${ids}-${kind}`}>{name}</label>
                <select
                  id={`${ids}-${kind}`}
                  value={cadences[kind]}
                  onChange={(event) =>
                    setCadences({ ...cadences, [kind]: event.target.value as Cadence })
                  }
                >
                  {(Object.keys(CADENCES) as Cadence[]).map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {CADENCES[cadence]}
                    </option>
                  ))}
                </select>
              </span>
            ))}
            <p className={styles['muted']}>A daily digest is made after 07:00 UTC.</p>
            <button type="button" onClick={() => void save()}>
              Save
            </button>
          </fieldset>
        )}
        <p role="status">{status}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
