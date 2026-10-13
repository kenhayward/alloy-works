import type { createApiClient } from '@alloy-works/api-client';
import type { ThreadAnchor } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import styles from './ThreadsPanel.module.css';

type Client = ReturnType<typeof createApiClient>;

type Part = { readonly text: string } | { readonly mention: string };
interface Person {
  readonly id: string;
  readonly name: string | null;
}

/** A thread as the document's list answers it (COL-018). */
export interface ThreadSummary {
  readonly id: string;
  readonly on: { readonly id: string; readonly kind: 'component' | 'document' };
  readonly anchor: ThreadAnchor;
  readonly startedBy: Person;
  readonly startedAt: string;
  readonly resolvedAt: string | null;
  readonly comments: number;
  readonly orphaned: boolean;
  readonly places?: readonly { readonly node: string; readonly orphaned: boolean }[];
}

interface Thread {
  readonly id: string;
  readonly on: { readonly id: string; readonly kind: 'component' | 'document' };
  readonly anchor: ThreadAnchor;
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
const SHOWN: Record<Show, string> = { open: 'Open', resolved: 'Resolved', all: 'All' };

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** What a refusal says, from the service's own words, or a sentence of ours where it sent none. */
const refusalOf = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;

/** Where a thread stands, in words. */
export function anchorWords(anchor: ThreadAnchor): string {
  switch (anchor.kind) {
    case 'span':
      return `“${anchor.quote.length > 60 ? `${anchor.quote.slice(0, 60)}...` : anchor.quote}”`;
    case 'cell':
      return 'A table cell';
    case 'component':
      return 'The whole component';
    case 'node':
      return 'The section';
  }
}

/** Where a thread stands, as a sentence says it: a quote as it is, anything else lower-cased. */
const annotation = (anchor: ThreadAnchor) =>
  anchor.kind === 'span' ? anchorWords(anchor) : anchorWords(anchor).toLowerCase();

/** A comment's text: its words, and each person it names. */
function Said({ parts, nameOf }: { parts: readonly Part[]; nameOf: (id: string) => string }) {
  return (
    <p className={styles['said']}>
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
  const nameOf = (id: string) => people.find((each) => each.id === id)?.name ?? 'Somebody';
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
        <ul className={styles['named']} aria-label="Mentioned">
          {named.map((id) => (
            <li key={id}>
              {`@${nameOf(id)}`}
              <button
                type="button"
                aria-label={`Remove ${nameOf(id)}`}
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
            <label htmlFor={`${ids}-mention`}>Mention</label>
            <select
              id={`${ids}-mention`}
              value=""
              onChange={(event) => {
                const id = event.target.value;
                if (id !== '' && !named.includes(id) && named.length < 20) setNamed([...named, id]);
              }}
            >
              <option value="">Somebody...</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? 'Unnamed'}
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
            Cancel
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

  const nameOf = (id: string) => people.find((each) => each.id === id)?.name ?? 'Somebody';

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
    else setRefused(refusalOf(answer.error, 'The thread could not be opened.'));
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
        ? `Not told, as they may not read this: ${missed.map(nameOf).join(', ')}.`
        : '';
    if (done !== '' || notTold !== '') setSaid([done, notTold].filter(Boolean).join(' '));
  };

  const summaryOf = (id: string) => threads?.find((each) => each.id === id);
  /** Where a listed thread stands, as an announcement says it; nothing where it is not listed. */
  const where = (summary: ThreadSummary | undefined) =>
    summary === undefined ? '' : ` in ${placeOf(summary)}`;

  const chosen = targets.find((each) => each.key === target) ?? targets[0];

  const start = async (parts: Part[]) => {
    if (!chosen) return false;
    setSaid('');
    setRefused('');
    const body = { version: chosen.version, anchor: chosen.anchor, parts };
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
      setRefused(refusalOf(answer.error, 'The thread could not be started.'));
      return false;
    }
    setOpened(answer.data as unknown as Thread);
    const started = (answer.data as unknown as Thread).id;
    const listed = await read();
    // Announced naming which and where (CNT-137), in the region there from the start.
    untold(
      answer.data,
      `Thread started on ${annotation(chosen.anchor)}${where(listed?.find((each) => each.id === started))}.`,
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
      setRefused(refusalOf(answer.error, 'The reply could not be added.'));
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
      setRefused(refusalOf(answer.error, 'The comment could not be changed.'));
      return false;
    }
    untold(answer.data);
    setEditing(null);
    setOpened(answer.data as unknown as Thread);
    return true;
  };

  const resolve = async (thread: string) => {
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/threads/{id}/resolution', {
      params: { path: { id: thread } },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, 'The thread could not be resolved.'));
      return;
    }
    setSaid(
      `Thread on ${annotation((answer.data as unknown as Thread).anchor)}${where(summaryOf(thread))} resolved.`,
    );
    setOpened(answer.data as unknown as Thread);
    await read();
  };

  return (
    <div className={styles['panel']}>
      {targets.length > 0 && (
        <section aria-labelledby={`${ids}-new`} className={styles['new']}>
          <h3 id={`${ids}-new`} className={styles['heading']}>
            New thread
          </h3>
          <label htmlFor={`${ids}-on`}>On</label>
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
          <Composer label="Comment" action="Start thread" people={people} onSend={start} />
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
            All threads
          </button>
          <h3 id={`${ids}-opened`} className={styles['heading']}>
            {anchorWords(opened.anchor)}
          </h3>
          {summaryOf(opened.id) && (
            <p className={styles['note']}>{placeOf(summaryOf(opened.id)!)}</p>
          )}
          {opened.resolution && (
            <p className={styles['note']}>
              {`Resolved by ${opened.resolution.by.name ?? 'somebody'}, ${when.format(new Date(opened.resolution.at))}`}
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
                    {`${comment.author.name ?? 'Somebody'}, ${when.format(new Date(comment.at))}`}
                    {earlier.length > 0 && ' (edited)'}
                  </span>
                  {editing === comment.id ? (
                    <Composer
                      label="Your comment"
                      action="Save"
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
                      <summary>Earlier texts</summary>
                      {earlier.map((text, index) => (
                        <div key={index}>
                          <span className={styles['who']}>{when.format(new Date(text.at))}</span>
                          <Said parts={text.parts} nameOf={nameOf} />
                        </div>
                      ))}
                    </details>
                  )}
                  {mine && opened.resolution === null && editing !== comment.id && (
                    <button type="button" onClick={() => setEditing(comment.id)}>
                      Edit
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {opened.resolution === null && mayAnswer(opened.on) && (
            <>
              <Composer
                label="Reply"
                action="Reply"
                people={people}
                onSend={(parts) => reply(opened.id, parts)}
              />
              <button type="button" onClick={() => void resolve(opened.id)}>
                Resolve
              </button>
            </>
          )}
        </section>
      ) : (
        <>
          <div className={styles['controls']}>
            <label htmlFor={`${ids}-show`}>Show</label>
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
          {threads === null && <p className={styles['note']}>The threads could not be read.</p>}
          {threads?.length === 0 && <p className={styles['note']}>No threads here.</p>}
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
                    {`${thread.startedBy.name ?? 'Somebody'}, ${when.format(new Date(thread.startedAt))}; ${thread.comments} ${thread.comments === 1 ? 'comment' : 'comments'}`}
                  </span>
                  {thread.resolvedAt !== null && <span className={styles['state']}>Resolved</span>}
                  {thread.orphaned && (
                    <span className={styles['state']}>Its text is no longer there</span>
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
