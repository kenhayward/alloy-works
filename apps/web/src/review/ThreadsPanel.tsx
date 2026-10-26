import type { createApiClient } from '@alloy-works/api-client';
import { Chip } from '../parts/Chip.js';
import { Outside } from '../parts/Outside.js';
import type { ThreadAnchor } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import styles from './ThreadsPanel.module.css';
import { formats, words as say, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Part = { readonly text: string } | { readonly mention: string };
interface Person {
  readonly id: string;
  readonly name: string | null;
  /** From outside the organisation (IAM-045). */
  readonly external?: true | undefined;
}

/** A thread as the document's list answers it (COL-018). */
export interface ThreadSummary {
  readonly id: string;
  readonly on: { readonly id: string; readonly kind: 'component' | 'document' };
  readonly anchor: ThreadAnchor;
  readonly startedBy: Person;
  readonly startedAt: string;
  /** Kept from everybody from outside the organisation (COL-038; the R13 plan, R13-C). */
  readonly internal?: boolean;
  readonly resolvedAt: string | null;
  readonly comments: number;
  readonly orphaned: boolean;
  readonly places?: readonly { readonly node: string; readonly orphaned: boolean }[];
}

interface Thread {
  readonly id: string;
  readonly on: { readonly id: string; readonly kind: 'component' | 'document' };
  readonly anchor: ThreadAnchor;
  readonly internal?: boolean;
  readonly resolution: { readonly by: Person; readonly at: string } | null;
  readonly comments: readonly {
    readonly id: string;
    readonly author: Person;
    readonly at: string;
    readonly texts: readonly { readonly parts: readonly Part[]; readonly at: string }[];
  }[];
}

/** Something a thread may be started on, as the page offers it. */
export interface ReviewTarget {
  readonly key: string;
  readonly label: string;
  readonly on: { readonly kind: 'component' | 'document'; readonly id: string };
  readonly version: string;
  readonly anchor: ThreadAnchor;
}

type Show = 'open' | 'resolved' | 'all';
const SHOWN: Record<Show, string> = {
  get open() {
    return say('review.open');
  },
  get resolved() {
    return say('review.resolved');
  },
  get all() {
    return say('review.all');
  },
};

/** A thread's moment, as the person's language writes it. */
const when = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Whose something is: `named` says whether there is a name to show as `who`. */
export const personValues = (person: Person) => ({
  named: person.name === null ? 'no' : 'yes',
  who: person.name ?? '',
});

/** What a refusal says, from the service's own words, or a sentence of ours where it sent none. */
const refusalOf = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;

/**
 * Where a thread stands, as a message's values: `anchor` its kind, for a `select`, and `quote` the
 * text it quotes, cut short, where it is on a span.
 */
export const anchorValues = (anchor: ThreadAnchor) => ({
  anchor: anchor.kind,
  quote:
    anchor.kind !== 'span'
      ? ''
      : anchor.quote.length > 60
        ? `${anchor.quote.slice(0, 60)}...`
        : anchor.quote,
});

/** Where a thread stands, in words. */
export const anchorWords = (anchor: ThreadAnchor): string =>
  say('review.anchor', anchorValues(anchor));

/** A comment's text: its words, and each person it names. */
function Said({ parts, nameOf }: { parts: readonly Part[]; nameOf: (id: string) => string }) {
  return (
    <p className={styles['said']} data-content>
      {parts.map((part, index) =>
        'text' in part ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span key={index} className={styles['mention']}>{`@${nameOf(part.mention)}`}</span>
        ),
      )}
    </p>
  );
}

/** Words and the people they name, written and sent as one comment (TH-B). */
function Composer({
  label,
  action,
  people,
  initial,
  onSend,
  onCancel,
}: {
  label: string;
  action: string;
  people: readonly Person[];
  initial?: readonly Part[];
  onSend: (parts: Part[]) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const ids = useId();
  const [words, setWords] = useState(
    initial?.flatMap((part) => ('text' in part ? [part.text] : [])).join('') ?? '',
  );
  const [named, setNamed] = useState<readonly string[]>(
    initial?.flatMap((part) => ('mention' in part ? [part.mention] : [])) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const parts: Part[] = [
      ...(words.trim() === '' ? [] : [{ text: words }]),
      ...named.map((mention) => ({ mention })),
    ];
    if (parts.length === 0) return;
    setBusy(true);
    const sent = await onSend(parts);
    setBusy(false);
    if (sent && initial === undefined) {
      setWords('');
      setNamed([]);
    }
  };
  const nameOf = (id: string) =>
    people.find((each) => each.id === id)?.name ?? say('review.somebody');
  return (
    <form className={styles['composer']} onSubmit={(event) => void send(event)}>
      <label htmlFor={`${ids}-words`}>{label}</label>
      <textarea
        id={`${ids}-words`}
        value={words}
        rows={3}
        maxLength={4000}
        onChange={(event) => setWords(event.target.value)}
      />
      {named.length > 0 && (
        <ul className={styles['named']} aria-label={say('review.mentioned')}>
          {named.map((id) => (
            <li key={id}>
              <span data-content>{`@${nameOf(id)}`}</span>
              <button
                type="button"
                aria-label={say('review.remove', { name: nameOf(id) })}
                onClick={() => setNamed(named.filter((each) => each !== id))}
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles['actions']}>
        {people.length > 0 && (
          <>
            <label htmlFor={`${ids}-mention`}>{say('review.mention')}</label>
            <select
              id={`${ids}-mention`}
              value=""
              onChange={(event) => {
                const id = event.target.value;
                if (id !== '' && !named.includes(id) && named.length < 20) setNamed([...named, id]);
              }}
            >
              <option value="">{say('review.somebody-2')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? say('review.unnamed')}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="submit" disabled={busy || (words.trim() === '' && named.length === 0)}>
          {action}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {say('review.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * The threads panel in Review (CNT-155, CNT-157; the TH plan, Task 3): the document's threads and its
 * components', filtered by state; one opened to read, answer, edit one's own comment with its earlier
 * texts kept, and resolve; and a thread started on what the page offers - the selected text, a cell, a
 * component or a section. Read when it opens and after each act of its own, never live (TH-L).
 */
export function ThreadsPanel({
  client,
  document,
  targets,
  people,
  principalId,
  mayAnswer,
  placeOf,
  onThreads,
  onGoTo,
  baseline,
  opening = null,
}: {
  client: Client;
  document: string;
  /**
   * A baseline whose pinned text the threads are read against (the RR plan, RR-G; COL-031), in place
   * of the document as it is now.
   */
  baseline?: string | undefined;
  targets: readonly ReviewTarget[];
  people: readonly Person[];
  principalId?: string | undefined;
  /** Whether the reader may comment on what a thread is on. */
  mayAnswer: (on: ThreadSummary['on']) => boolean;
  /** Where a thread stands in the outline, in words. */
  placeOf: (thread: ThreadSummary) => string;
  onThreads?: (threads: readonly ThreadSummary[]) => void;
  onGoTo?: (thread: ThreadSummary) => void;
  /** A thread to open, once for each arrival of the address naming it (the SV plan, SV-M). */
  opening?: { readonly thread: string; readonly arrival: number } | null;
}) {
  // Whether the reader is from outside the organisation (IAM-045), who neither starts an internal
  // thread nor makes one so (COL-038; the R13 plan, R13-C).
  const outside = people.some((each) => each.id === principalId && each.external === true);
  const [internal, setInternal] = useState(false);
  const ids = useId();
  const [show, setShow] = useState<Show>('open');
  const [threads, setThreads] = useState<readonly ThreadSummary[] | null | undefined>(undefined);
  const [opened, setOpened] = useState<Thread | null>(null);
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');
  const onThreadsNow = useCallback(
    (each: readonly ThreadSummary[]) => onThreads?.(each),
    [onThreads],
  );

  const nameOf = (id: string) =>
    people.find((each) => each.id === id)?.name ?? say('review.somebody');

  // Every page of them, so every thread is listed and marked, however many (the TH final review).
  const read = useCallback(async (): Promise<readonly ThreadSummary[] | null> => {
    const listed: ThreadSummary[] = [];
    let cursor: string | undefined;
    do {
      const query = {
        limit: '100',
        ...(show === 'all' ? {} : { state: show }),
        ...(cursor === undefined ? {} : { cursor }),
      };
      const answer =
        baseline === undefined
          ? await client.GET('/v1/documents/{id}/threads', {
              params: { path: { id: document }, query },
            })
          : await client.GET('/v1/baselines/{id}/threads', {
              params: { path: { id: baseline }, query },
            });
      if (!answer.data) {
        setThreads(null);
        return null;
      }
      listed.push(...(answer.data.threads as unknown as ThreadSummary[]));
      cursor = answer.data.next ?? undefined;
    } while (cursor !== undefined);
    setThreads(listed);
    onThreadsNow(listed);
    return listed;
  }, [client, document, baseline, show, onThreadsNow]);

  useEffect(() => {
    void read().catch(() => setThreads(null));
  }, [read]);

  const open = async (id: string) => {
    setRefused('');
    const answer = await client.GET('/v1/threads/{id}', { params: { path: { id } } });
    if (answer.data) setOpened(answer.data as unknown as Thread);
    // A thread on a component since deleted is listed and does not open (COL-067): say why.
    else setRefused(refusalOf(answer.error, say('review.the-thread-could-not-be-2')));
  };

  const openedFor = useRef<number | null>(null);
  useEffect(() => {
    if (opening === null || openedFor.current === opening.arrival) return;
    openedFor.current = opening.arrival;
    void open(opening.thread);
    // `open` is made afresh each render; the arrival is what asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening?.thread, opening?.arrival]);

  /**
   * Says whom a comment named who may not read what it is on, and so were told nothing (COL-015),
   * after what was done.
   */
  const untold = (answer: unknown, done = '') => {
    const missed = (answer as { untold?: string[] }).untold ?? [];
    const notTold =
      missed.length > 0
        ? say('review.not-told-as-they-may', { names: formats().list(missed.map(nameOf)) })
        : '';
    if (done !== '' || notTold !== '') setSaid([done, notTold].filter(Boolean).join(' '));
  };

  const summaryOf = (id: string) => threads?.find((each) => each.id === id);
  /**
   * Which thread and where it stands, as an announcement's values: `placed` says whether it is listed
   * and so has a `place` in the outline.
   */
  const which = (anchor: ThreadAnchor, summary: ThreadSummary | undefined) => ({
    ...anchorValues(anchor),
    placed: summary === undefined ? 'no' : 'yes',
    place: summary === undefined ? '' : placeOf(summary),
  });

  const chosen = targets.find((each) => each.key === target) ?? targets[0];

  const start = async (parts: Part[]) => {
    if (!chosen) return false;
    setSaid('');
    setRefused('');
    const body = {
      version: chosen.version,
      anchor: chosen.anchor,
      parts,
      ...(internal ? { internal: true } : {}),
    };
    const answer =
      chosen.on.kind === 'component'
        ? await client.POST('/v1/components/{id}/threads', {
            params: { path: { id: chosen.on.id } },
            body: body as never,
          })
        : await client.POST('/v1/documents/{id}/threads', {
            params: { path: { id: chosen.on.id } },
            body: body as never,
          });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, say('review.the-thread-could-not-be-3')));
      return false;
    }
    setOpened(answer.data as unknown as Thread);
    setInternal(false);
    const started = (answer.data as unknown as Thread).id;
    const listed = await read();
    // Announced naming which and where (CNT-137), in the region there from the start.
    untold(
      answer.data,
      say(
        'review.thread-started-on',
        which(
          chosen.anchor,
          listed?.find((each) => each.id === started),
        ),
      ),
    );
    return true;
  };

  const reply = async (thread: string, parts: Part[]) => {
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/threads/{id}/comments', {
      params: { path: { id: thread } },
      body: { parts } as never,
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, say('review.the-reply-could-not-be')));
      return false;
    }
    untold(answer.data);
    setOpened(answer.data as unknown as Thread);
    await read();
    return true;
  };

  const edit = async (thread: string, comment: string, parts: Part[]) => {
    setSaid('');
    setRefused('');
    const answer = await client.PUT('/v1/threads/{id}/comments/{comment}', {
      params: { path: { id: thread, comment } },
      body: { parts } as never,
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, say('review.the-comment-could-not-be')));
      return false;
    }
    untold(answer.data);
    setEditing(null);
    setOpened(answer.data as unknown as Thread);
    return true;
  };

  /** Kept from outside from now on (COL-038; R13-C): once, and never public again. */
  const makeInternal = async (thread: string) => {
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/threads/{id}/internal', {
      params: { path: { id: thread } },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, say('review.the-thread-could-not-be-4')));
      return;
    }
    setSaid(
      say(
        'review.thread-on-made-internal-nobody',
        which((answer.data as unknown as Thread).anchor, summaryOf(thread)),
      ),
    );
    setOpened(answer.data as unknown as Thread);
    await read();
  };

  const resolve = async (thread: string) => {
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/threads/{id}/resolution', {
      params: { path: { id: thread } },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, say('review.the-thread-could-not-be-5')));
      return;
    }
    setSaid(
      say(
        'review.thread-on-resolved',
        which((answer.data as unknown as Thread).anchor, summaryOf(thread)),
      ),
    );
    setOpened(answer.data as unknown as Thread);
    await read();
  };

  return (
    <div className={styles['panel']}>
      {targets.length > 0 && (
        <section aria-labelledby={`${ids}-new`} className={styles['new']}>
          <h3 id={`${ids}-new`} className={styles['heading']}>
            {say('review.new-thread')}
          </h3>
          <label htmlFor={`${ids}-on`}>{say('review.on-2')}</label>
          <select
            id={`${ids}-on`}
            value={chosen?.key ?? ''}
            onChange={(event) => setTarget(event.target.value)}
          >
            {targets.map((each) => (
              <option key={each.key} value={each.key}>
                {each.label}
              </option>
            ))}
          </select>
          {!outside && (
            <label>
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />{' '}
              {say('review.internal-nobody-from-outside-the')}
            </label>
          )}
          <Composer
            label={say('review.comment')}
            action={say('review.start-thread')}
            people={people}
            onSend={start}
          />
        </section>
      )}
      <p role="status" className={styles['note']}>
        {said}
      </p>
      {refused !== '' && (
        <p role="alert" className={styles['refused']}>
          {refused}
        </p>
      )}
      {opened !== null ? (
        <section aria-labelledby={`${ids}-opened`} className={styles['thread']}>
          <button type="button" className={styles['back']} onClick={() => setOpened(null)}>
            {say('review.all-threads')}
          </button>
          <h3 id={`${ids}-opened`} className={styles['heading']}>
            {anchorWords(opened.anchor)}
          </h3>
          {summaryOf(opened.id) && (
            <p className={styles['note']}>{placeOf(summaryOf(opened.id)!)}</p>
          )}
          {opened.internal === true && (
            <p className={styles['note']}>
              <Chip>{say('review.internal')}</Chip>{' '}
              {say('review.nobody-from-outside-the-organisation')}
            </p>
          )}
          {opened.resolution && (
            <p className={styles['note']}>
              {say('review.resolved-by', {
                ...personValues(opened.resolution.by),
                at: when(opened.resolution.at),
              })}
            </p>
          )}
          <ol className={styles['comments']}>
            {opened.comments.map((comment) => {
              const latest = comment.texts[comment.texts.length - 1]!;
              const earlier = comment.texts.slice(0, -1);
              const mine = principalId !== undefined && comment.author.id === principalId;
              return (
                <li key={comment.id} className={styles['comment']}>
                  <span className={styles['who']}>
                    {wordsWith(
                      'review.comment-by',
                      {
                        named: personValues(comment.author).named,
                        at: when(comment.at),
                        edited: earlier.length > 0 ? 'yes' : 'no',
                      },
                      {
                        who: <span data-content>{comment.author.name}</span>,
                        outside: <Outside person={comment.author} />,
                      },
                    )}
                  </span>
                  {editing === comment.id ? (
                    <Composer
                      label={say('review.your-comment')}
                      action={say('review.save')}
                      people={people}
                      initial={latest.parts}
                      onSend={(parts) => edit(opened.id, comment.id, parts)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <Said parts={latest.parts} nameOf={nameOf} />
                  )}
                  {earlier.length > 0 && (
                    <details>
                      <summary>{say('review.earlier-texts')}</summary>
                      {earlier.map((text, index) => (
                        <div key={index}>
                          <span className={styles['who']}>{when(text.at)}</span>
                          <Said parts={text.parts} nameOf={nameOf} />
                        </div>
                      ))}
                    </details>
                  )}
                  {mine && opened.resolution === null && editing !== comment.id && (
                    <button type="button" onClick={() => setEditing(comment.id)}>
                      {say('review.edit')}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {opened.resolution === null && mayAnswer(opened.on) && (
            <>
              <Composer
                label={say('review.reply')}
                action={say('review.reply')}
                people={people}
                onSend={(parts) => reply(opened.id, parts)}
              />
              <button type="button" onClick={() => void resolve(opened.id)}>
                {say('review.resolve')}
              </button>
              {opened.internal !== true && !outside && (
                <button type="button" onClick={() => void makeInternal(opened.id)}>
                  {say('review.make-internal')}
                </button>
              )}
            </>
          )}
        </section>
      ) : (
        <>
          <div className={styles['controls']}>
            <label htmlFor={`${ids}-show`}>{say('review.show')}</label>
            <select
              id={`${ids}-show`}
              value={show}
              onChange={(event) => setShow(event.target.value as Show)}
            >
              {(Object.keys(SHOWN) as Show[]).map((each) => (
                <option key={each} value={each}>
                  {SHOWN[each]}
                </option>
              ))}
            </select>
          </div>
          {threads === null && (
            <p className={styles['note']}>{say('review.the-threads-could-not-be')}</p>
          )}
          {threads?.length === 0 && (
            <p className={styles['note']}>{say('review.no-threads-here')}</p>
          )}
          {threads && threads.length > 0 && (
            <ul className={styles['rows']}>
              {threads.map((thread) => (
                <li key={thread.id} className={styles['row']}>
                  <button
                    type="button"
                    className={styles['open']}
                    onClick={() => {
                      onGoTo?.(thread);
                      void open(thread.id);
                    }}
                  >
                    {anchorWords(thread.anchor)}
                  </button>
                  <span className={styles['note']}>{placeOf(thread)}</span>
                  <span className={styles['note']}>
                    {wordsWith(
                      'review.started-by',
                      {
                        named: personValues(thread.startedBy).named,
                        at: when(thread.startedAt),
                        count: thread.comments,
                      },
                      {
                        who: <span data-content>{thread.startedBy.name}</span>,
                        outside: <Outside person={thread.startedBy} />,
                      },
                    )}
                  </span>
                  {thread.internal === true && <Chip>{say('review.internal')}</Chip>}
                  {thread.resolvedAt !== null && (
                    <span className={styles['state']}>{say('review.resolved')}</span>
                  )}
                  {thread.orphaned && (
                    <span className={styles['state']}>{say('review.its-text-is-no-longer')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
