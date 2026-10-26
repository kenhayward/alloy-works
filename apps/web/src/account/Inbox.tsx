import type { createApiClient } from '@alloy-works/api-client';
import { StateLozenge } from '../states/Lozenge.js';
import { useCallback, useEffect, useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Inbox.module.css';
import { moment, refusal } from './TokenTable.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Kind = 'mention' | 'reply' | 'resolution' | 'round';
type Cadence = 'at_once' | 'daily' | 'never';
type Part = { readonly text: string } | { readonly mention: string };

interface Place {
  readonly id: string;
  readonly title: string | null;
  /** Its workflow state now, to a reader of it alone (LIF-005); absent from a service before it. */
  readonly state?: { readonly key: string; readonly name: string } | null;
}

interface Notification {
  readonly id: string;
  readonly kind: Kind | 'digest' | 'budget' | 'webhook' | 'reference' | 'import';
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
  /** A model budget's alert (G6-D); absent from a service before it. */
  readonly budget?: {
    readonly threshold: number;
    readonly currency: string;
    readonly spent: string;
    readonly limit: string;
    readonly month: string;
  } | null;
  /** A source cited in the document `on` names, retracted or corrected (XR-G). */
  readonly reference?: {
    readonly entry: string;
    readonly outcome: 'retracted' | 'corrected';
  } | null;
  /** A proposal left alone, abandoned at `sweepsAt` (IM-F). */
  readonly import?: { readonly id: string; readonly sweepsAt: string } | null;
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
  {
    kind: 'mention',
    get name() {
      return words('account.when-a-comment-names-you');
    },
  },
  {
    kind: 'reply',
    get name() {
      return words('account.replies-on-threads-you-are');
    },
  },
  {
    kind: 'resolution',
    get name() {
      return words('account.threads-you-are-in-resolved');
    },
  },
  {
    kind: 'round',
    get name() {
      return words('account.when-you-are-named-a');
    },
  },
];
const CADENCES: Readonly<Record<Cadence, string>> = {
  get at_once() {
    return words('account.at-once');
  },
  get daily() {
    return words('account.in-a-daily-digest');
  },
  get never() {
    return words('account.never');
  },
};

/** What it is about, to its reader: the title where they may read it now, else not even that. */
const placeWords = (place: Place | null) =>
  place?.title ?? words('account.something-you-may-no-longer');

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What happened, in words (COL-063): who did what, and where. Never the comment's text (COL-036). */
function said(each: Notification): string {
  const who = each.actor?.name ?? words('account.somebody');
  switch (each.kind) {
    case 'mention':
      return words('account.mentioned-you-on', { who, value2: placeWords(each.on) });
    case 'reply':
      return words('account.replied-on', { who, value2: placeWords(each.on) });
    case 'resolution':
      return words('account.resolved-a-thread-on', { who, value2: placeWords(each.on) });
    case 'round':
      return words('account.asked-you-to-review', { who, value2: placeWords(each.on) });
    case 'digest': {
      const counts = each.counts!;
      const parts = [
        counts.mention > 0 ? plural(counts.mention, 'mention', 'mentions') : null,
        counts.reply > 0 ? plural(counts.reply, 'reply', 'replies') : null,
        counts.resolution > 0 ? plural(counts.resolution, 'resolution', 'resolutions') : null,
        (counts.round ?? 0) > 0
          ? plural(
              counts.round!,
              words('account.review-asked-of-you'),
              words('account.reviews-asked-of-you'),
            )
          : null,
      ].filter((part): part is string => part !== null);
      return words('account.your-daily-digest-on', {
        value1: parts.join(', '),
        value2: counts.places.map(placeWords).join(', '),
      });
    }
    case 'budget': {
      const budget = each.budget;
      if (!budget) return words('account.the-model-budget-crossed-a');
      const money = (text: string) => `${budget.currency} ${Number(text).toFixed(2)}`;
      return words('account.models-have-cost-this-month', {
        value1: money(budget.spent),
        threshold: budget.threshold,
        value3: money(budget.limit),
      });
    }
    case 'webhook':
      return words('account.a-webhook-you-made-was');
    case 'reference':
      return words('account.a-source-cited-in-was', {
        value1: placeWords(each.on),
        value2: each.reference?.outcome ?? 'flagged',
      });
    case 'import':
      return words('account.an-import-you-have-not');
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
      setStatus(words('account.the-thread-could-not-be'));
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
        ? words('account.deleted')
        : refusal(error, words('account.it-could-not-be-deleted')),
    );
    if (opened?.id === each.id) setOpened(null);
    await load();
  };

  const save = async () => {
    if (cadences === null) return;
    const { data, error } = await client.PUT('/v1/inbox/preferences', { body: cadences });
    if (data) setCadences(data);
    setStatus(
      data
        ? words('account.saved-how-often-you-are')
        : refusal(error, words('account.they-could-not-be-saved')),
    );
  };

  const notifications = read === null || read === 'failed' ? null : read;

  return (
    <Modal labelledBy={`${ids}-heading`} onClose={onClose}>
      <div className={styles['inbox']}>
        <h2 id={`${ids}-heading`}>{words('account.inbox')}</h2>
        <p className={styles['muted']}>
          {unread === 0 ? words('account.nothing-unread') : plural(unread, 'unread', 'unread')}
        </p>
        {read === null && <Waiting>{words('account.loading')}</Waiting>}
        {read === 'failed' && (
          <Notice tone="failed">
            <p>{words('account.your-inbox-could-not-be')}</p>
            <button type="button" onClick={() => void load()}>
              {words('account.try-again')}
            </button>
          </Notice>
        )}
        {notifications?.length === 0 && (
          <p className={styles['muted']}>{words('account.nothing-here-yet')}</p>
        )}
        {notifications !== null && notifications.length > 0 && (
          <ul className={styles['rows']} aria-label={words('account.notifications')}>
            {notifications.map((each) => (
              <li key={each.id} className={styles['row']} data-unread={!each.read}>
                <span className={styles['said']}>{said(each)}</span>
                {/* What it is on, in its state now, to a reader of it alone (LIF-005). */}
                {each.on?.state && <StateLozenge state={each.on.state} />}
                <span className={styles['muted']}>
                  {moment(each.at)}
                  {each.read ? '' : words('account.unread')}
                </span>
                <span className={styles['acts']}>
                  {each.thread !== null && (
                    <button type="button" onClick={() => void open(each)}>
                      {words('account.open')}
                    </button>
                  )}
                  {/* A round opens its document, in Review, where its rounds are listed (RR-E). */}
                  {each.kind === 'round' && each.round != null && each.on !== null && (
                    <a href={`#/documents/${each.on.id}`} onClick={() => void markRead(each)}>
                      {words('account.open-the-document')}
                    </a>
                  )}
                  {/* A flagged source opens its document, whose Review lists it (XR-G). */}
                  {each.kind === 'reference' && each.on?.title != null && (
                    <a href={`#/documents/${each.on.id}`} onClick={() => void markRead(each)}>
                      {words('account.open-the-document')}
                    </a>
                  )}
                  {each.kind === 'budget' && (
                    <a href="#/admin/spending" onClick={() => void markRead(each)}>
                      {words('account.open-model-spending')}
                    </a>
                  )}
                  {each.kind === 'import' && each.import && (
                    <a href={`#/imports/${each.import.id}`} onClick={() => void markRead(each)}>
                      {words('account.open-the-import')}
                    </a>
                  )}
                  {each.kind === 'webhook' && (
                    <a href="#/admin/webhooks" onClick={() => void markRead(each)}>
                      {words('account.open-webhooks')}
                    </a>
                  )}
                  {!each.read && (
                    <button type="button" onClick={() => void markRead(each)}>
                      {words('account.mark-read')}
                    </button>
                  )}
                  <button type="button" onClick={() => void remove(each)}>
                    {words('account.delete')}
                  </button>
                </span>
                {opened?.id === each.id &&
                  (opened.thread === 'gone' ? (
                    <p className={styles['muted']}>{words('account.you-may-no-longer-read')}</p>
                  ) : (
                    <div className={styles['thread']}>
                      <ol>
                        {opened.thread.comments.map((comment) => (
                          <li key={comment.id}>
                            <span className={styles['muted']}>
                              {`${comment.author.name ?? words('account.somebody')}, ${moment(comment.at)}`}
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
                        {words('account.go-to', { value1: placeWords(each.on) })}
                      </a>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {next !== null && (
          <button type="button" onClick={() => void more()}>
            {words('account.show-more')}
          </button>
        )}
        {cadences !== null && (
          <fieldset className={styles['preferences']}>
            <legend>{words('account.how-often-you-are-told')}</legend>
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
            <p className={styles['muted']}>{words('account.a-daily-digest-is-made')}</p>
            <button type="button" onClick={() => void save()}>
              {words('account.save')}
            </button>
          </fieldset>
        )}
        <p role="status">{status}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('account.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
