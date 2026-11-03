import type { createApiClient } from '@alloy-works/api-client';
import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { MenuButton } from '../parts/MenuButton.js';
import { Outside } from '../parts/Outside.js';
import type { ThreadAnchor } from '@alloy-works/domain';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { Icon } from '../editor/Icon.js';
import { reviewThreadLink } from '../structure/links.js';
import styles from './ThreadsPanel.module.css';
import { formats, words as say, wordsWith } from '../words/words.js';
import {
  AiTag,
  AssistantAvatar,
  Avatar,
  AvatarStack,
  firstName,
  type Person,
} from './ThreadFaces.js';
import { nameMatches, ThreadComposer } from './ThreadComposer.js';
import {
  countsOf,
  inState,
  peopleIn,
  shownThreads,
  SHOWS,
  THE_ASSISTANT,
  type InThreads,
  type Reading,
  type Show,
} from './threadFilters.js';

type Client = ReturnType<typeof createApiClient>;

type Part = { readonly text: string } | { readonly mention: string };

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
  /** Its first comment as it reads now. */
  readonly said: readonly Part[];
  /** Whoever has commented, in the order each first did. */
  readonly participants: readonly Person[];
  /** The people its comments name as they read now. */
  readonly mentioned: readonly string[];
  /** The words of every comment as it reads now, for the list's search. */
  readonly words: string;
  /** Whether the assistant drafted a comment on it (GEN-063). */
  readonly drafted: boolean;
  /** Whether somebody else has commented since the reader read it (COL-070). */
  readonly new: boolean;
  readonly orphaned: boolean;
  readonly places?: readonly { readonly node: string; readonly orphaned: boolean }[];
}

interface Thread {
  readonly id: string;
  readonly on: { readonly id: string; readonly kind: 'component' | 'document' };
  readonly anchor: ThreadAnchor;
  readonly startedBy: Person;
  readonly internal?: boolean;
  readonly resolution: { readonly by: Person; readonly at: string } | null;
  readonly comments: readonly {
    readonly id: string;
    readonly author: Person;
    readonly at: string;
    /** Drafted by the assistant, accepted by its author (GEN-063). */
    readonly drafted?: { readonly model: string | null };
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

const SHOW_WORDS: Record<Show, () => string> = {
  all: () => say('review.all-threads'),
  open: () => say('review.open'),
  new: () => say('review.new-to-me'),
  mentioning: () => say('review.mentioning-me'),
  mine: () => say('review.raised-by-me'),
  assistant: () => say('review.from-the-assistant'),
  internal: () => say('review.internal-only'),
  resolved: () => say('review.resolved'),
};
const SHOW_ICONS: Record<Show, string> = {
  all: 'Lists',
  open: 'Open state',
  new: 'Open state',
  mentioning: 'Mention',
  mine: 'Raised by me',
  assistant: 'Assistant',
  internal: 'Internal',
  resolved: 'Resolve',
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
function Said({
  parts,
  nameOf,
  short = false,
}: {
  parts: readonly Part[];
  nameOf: (id: string) => string;
  /** On a card: `@First`, the whole name standing in the comment itself. */
  short?: boolean;
}) {
  return (
    <>
      {parts.map((part, index) =>
        'text' in part ? (
          <span key={index}>{part.text}</span>
        ) : short ? (
          <span key={index} className={styles['shortMention']}>
            {`@${firstName(nameOf(part.mention))}`}
          </span>
        ) : (
          <span key={index} className={styles['mention']}>{`@${nameOf(part.mention)}`}</span>
        ),
      )}
    </>
  );
}

/** The people strip: everybody in the threads, one chosen at a time. One filter with the search's chip. */
function PeopleStrip({
  found,
  person,
  principalId,
  onChoose,
}: {
  found: readonly InThreads[];
  person: string | null;
  principalId: string | undefined;
  onChoose: (person: string | null) => void;
}) {
  return (
    <div className={styles['strip']} role="group" aria-label={say('review.filter-by-person')}>
      <button
        type="button"
        className={styles['stripItem']}
        aria-pressed={person === null}
        onClick={() => onChoose(null)}
      >
        <span className={styles['stripAll']} aria-hidden="true">
          *
        </span>
        <span className={styles['stripName']}>{say('review.all')}</span>
      </button>
      {found.map((each) => {
        const label =
          each.id === THE_ASSISTANT
            ? say('review.ai')
            : each.id === principalId
              ? say('review.you')
              : firstName(each.name ?? say('review.somebody'));
        return (
          <button
            key={each.id}
            type="button"
            className={styles['stripItem']}
            aria-pressed={person === each.id}
            aria-label={say('review.person-open', { name: label, count: each.open })}
            onClick={() => onChoose(person === each.id ? null : each.id)}
          >
            <span className={styles['stripFace']}>
              {each.id === THE_ASSISTANT ? (
                <AssistantAvatar size={32} />
              ) : (
                <Avatar person={each} size={32} />
              )}
              {each.open > 0 && (
                <span className={styles['stripBadge']} aria-hidden="true">
                  {formats().number(each.open)}
                </span>
              )}
            </span>
            <span className={styles['stripName']} data-content>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Words to look for, and `@` to choose somebody to filter by: the strip's filter, as a chip here. */
function ThreadSearch({
  text,
  onText,
  person,
  found,
  principalId,
  onChoose,
}: {
  text: string;
  onText: (text: string) => void;
  person: string | null;
  found: readonly InThreads[];
  principalId: string | undefined;
  onChoose: (person: string | null) => void;
}) {
  const ids = useId();
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const at = text.lastIndexOf('@');
  const typed =
    !closed && at >= 0 && (at === 0 || text[at - 1] === ' ') ? text.slice(at + 1) : null;
  const nameFor = (each: InThreads) =>
    each.id === THE_ASSISTANT ? say('review.assistant') : (each.name ?? say('review.somebody'));
  const offered =
    typed === null
      ? []
      : found.filter((each) => each.id !== person && nameMatches(nameFor(each), typed));
  const shownActive = Math.min(active, Math.max(offered.length - 1, 0));
  const choose = (each: InThreads) => {
    onChoose(each.id);
    onText(text.slice(0, at).trimEnd());
    setActive(0);
    box.current?.focus();
  };
  const chosen = found.find((each) => each.id === person);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (offered.length > 0) {
      const keys: Record<string, () => void> = {
        ArrowDown: () => setActive((shownActive + 1) % offered.length),
        ArrowUp: () => setActive((shownActive - 1 + offered.length) % offered.length),
        Enter: () => choose(offered[shownActive]!),
        Escape: () => setClosed(true),
      };
      const act = keys[event.key];
      if (act !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        act();
        return;
      }
    }
    if (event.key === 'Backspace' && text === '' && person !== null) onChoose(null);
  };
  return (
    <div className={styles['search']}>
      <div className={styles['searchBox']}>
        <Icon name="Search" size={16} />
        {chosen && (
          <span className={styles['personChip']}>
            {chosen.id === THE_ASSISTANT ? (
              <AssistantAvatar size={16} />
            ) : (
              <Avatar person={chosen} size={16} />
            )}
            <span data-content>{`@${firstName(nameFor(chosen))}`}</span>
            <button
              type="button"
              aria-label={say('review.remove', { name: nameFor(chosen) })}
              title={say('review.remove', { name: nameFor(chosen) })}
              onClick={() => onChoose(null)}
            >
              <Icon name="Close" size={12} />
            </button>
          </span>
        )}
        <input
          ref={box}
          type="text"
          role="combobox"
          value={text}
          aria-label={say('review.search-or-at')}
          placeholder={chosen ? say('review.search') : say('review.search-or-at')}
          aria-expanded={offered.length > 0}
          aria-autocomplete="list"
          aria-controls={offered.length > 0 ? `${ids}-list` : undefined}
          aria-activedescendant={offered.length > 0 ? `${ids}-option-${shownActive}` : undefined}
          onChange={(event) => {
            onText(event.target.value);
            setClosed(false);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {offered.length > 0 && (
        <div className={styles['suggestions']}>
          <p id={`${ids}-heading`} className={styles['suggestHeading']}>
            {say('review.filter-by-person')}
          </p>
          <ul id={`${ids}-list`} role="listbox" aria-labelledby={`${ids}-heading`}>
            {offered.map((each, index) => (
              <li
                key={each.id}
                id={`${ids}-option-${index}`}
                role="option"
                aria-selected={index === shownActive}
                className={styles['suggestion']}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(each)}
              >
                {each.id === THE_ASSISTANT ? (
                  <AssistantAvatar size={28} />
                ) : (
                  <Avatar person={each} size={28} />
                )}
                <span className={styles['suggestName']} data-content>
                  {each.id === principalId
                    ? say('review.name-you', { name: nameFor(each) })
                    : nameFor(each)}
                </span>
                <span className={styles['suggestAside']}>
                  {say('review.n-threads', { count: each.threads })}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles['suggestFoot']}>{say('review.enter-to-add')}</p>
        </div>
      )}
    </div>
  );
}

/** Who said a comment and what, every earlier text kept (COL-014, COL-051). */
function Comments({
  thread,
  size,
  people,
  principalId,
  nameOf,
  editing,
  onEditing,
  onEdit,
}: {
  thread: Thread;
  size: 22 | 28;
  people: readonly Person[];
  principalId: string | undefined;
  nameOf: (id: string) => string;
  editing: string | null;
  onEditing: ((comment: string | null) => void) | null;
  onEdit: (comment: string, parts: Part[]) => Promise<boolean>;
}) {
  return (
    <ol className={styles['comments']} data-size={size}>
      {thread.comments.map((comment) => {
        const latest = comment.texts[comment.texts.length - 1]!;
        const earlier = comment.texts.slice(0, -1);
        const mine = principalId !== undefined && comment.author.id === principalId;
        return (
          <li key={comment.id} className={styles['comment']}>
            <Avatar person={comment.author} size={size} />
            <div className={styles['commentBody']}>
              <div className={styles['commentHead']}>
                <span className={styles['who']}>
                  {wordsWith(
                    'review.comment-by',
                    {
                      named: personValues(comment.author).named,
                      at: when(comment.at),
                      edited: earlier.length > 0 ? 'yes' : 'no',
                    },
                    {
                      who: (
                        <strong className={styles['name']} data-content>
                          {comment.author.name}
                        </strong>
                      ),
                      outside: <Outside person={comment.author} />,
                    },
                  )}
                </span>
                {comment.drafted !== undefined && <AiTag />}
                {onEditing !== null &&
                  mine &&
                  thread.resolution === null &&
                  editing !== comment.id && (
                    <IconButton
                      className={styles['icon']}
                      label={say('review.edit')}
                      onClick={() => onEditing(comment.id)}
                    >
                      <Icon name="Edit" size={14} />
                    </IconButton>
                  )}
              </div>
              {comment.drafted !== undefined && (
                <p className={styles['provenance']}>
                  <Icon name="Drafted" size={12} />
                  <span>
                    {comment.drafted.model === null
                      ? say('review.assistant-drafted')
                      : say('review.assistant-drafted-by', { model: comment.drafted.model })}
                  </span>
                </p>
              )}
              {editing === comment.id ? (
                <ThreadComposer
                  label={say('review.your-comment')}
                  placeholder=""
                  action={say('review.save')}
                  people={people}
                  initial={latest.parts}
                  onSend={(parts) => onEdit(comment.id, parts)}
                  onCancel={() => onEditing?.(null)}
                />
              ) : (
                <p className={styles['said']} data-content>
                  <Said parts={latest.parts} nameOf={nameOf} />
                </p>
              )}
              {earlier.length > 0 && (
                <details>
                  <summary>{say('review.earlier-texts')}</summary>
                  {earlier.map((text, index) => (
                    <div key={index}>
                      <span className={styles['who']}>{when(text.at)}</span>
                      <p className={styles['said']} data-content>
                        <Said parts={text.parts} nameOf={nameOf} />
                      </p>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Whether a key press is the thread's to take: not a box's, a list's or a menu's own. */
const OWN_KEYS = 'input, textarea, select, [role="menu"], [role="listbox"], [role="combobox"]';

/**
 * The threads panel (CNT-155, CNT-157; the TH and TP plans): the document's threads and its components'
 * as cards under a search and a people strip, found by state, person and words in the browser; one
 * opened in place, or across the panel to read it, answer, edit one's own comment with its earlier texts
 * kept, and resolve; and a thread started on what the page offers. Read when it opens and after each act
 * of its own, never live (TH-L).
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
  readAgain,
  baseline,
  opening = null,
  startWhen = 0,
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
  /** Every thread, and those Show's state leaves: what the text marks. */
  onThreads?: (threads: readonly ThreadSummary[], marked: readonly ThreadSummary[]) => void;
  onGoTo?: (thread: ThreadSummary) => void;
  /** A thread to open, once for each arrival of the address naming it (the SV plan, SV-M). */
  opening?: { readonly thread: string; readonly arrival: number } | null;
  /** Counted up for what started a thread elsewhere, such as the assistant's comment accepted. */
  readAgain?: number;
  /** Counted up for what asks to start a thread: its form opened, its words taking the keys. */
  startWhen?: number;
}) {
  // Whether the reader is from outside the organisation (IAM-045), who neither starts an internal
  // thread nor makes one so (COL-038; the R13 plan, R13-C).
  const outside = people.some((each) => each.id === principalId && each.external === true);
  const [internal, setInternal] = useState(false);
  const ids = useId();
  const [show, setShow] = useState<Show>('open');
  const [person, setPerson] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [threads, setThreads] = useState<readonly ThreadSummary[] | null | undefined>(undefined);
  const [opened, setOpened] = useState<Thread | null>(null);
  // In the list, where a card opens; or across the panel.
  const [across, setAcross] = useState(false);
  const [starting, setStarting] = useState(false);
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');
  const whole = useRef<HTMLElement>(null);
  const cardToFocus = useRef<string | null>(null);
  const takeFocus = useRef(false);
  const onThreadsNow = useCallback(
    (each: readonly ThreadSummary[], marked: readonly ThreadSummary[]) => onThreads?.(each, marked),
    [onThreads],
  );

  const nameOf = (id: string) =>
    people.find((each) => each.id === id)?.name ?? say('review.somebody');

  // Every page of every state, so each is listed and marked and Show can count them (the TP plan).
  const read = useCallback(async (): Promise<readonly ThreadSummary[] | null> => {
    const listed: ThreadSummary[] = [];
    let cursor: string | undefined;
    do {
      const query = { limit: '100', ...(cursor === undefined ? {} : { cursor }) };
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
    return listed;
  }, [client, document, baseline]);

  useEffect(() => {
    void read().catch(() => setThreads(null));
  }, [read, readAgain]);

  useEffect(() => {
    if (threads) onThreadsNow(threads, inState(threads, show));
  }, [threads, show, onThreadsNow]);

  /** The reader has read these: marked, and no longer new here, without reading the list again. */
  const markRead = (these: readonly string[]) => {
    if (these.length === 0) return;
    setThreads(
      (was) =>
        was?.map((each) => (these.includes(each.id) ? { ...each, new: false } : each)) ?? was,
    );
    for (let at = 0; at < these.length; at += 1000) {
      void client
        .POST('/v1/threads/read', { body: { threads: [...these.slice(at, at + 1000)] } })
        .catch(() => {});
    }
  };

  const open = async (id: string, wholePanel: boolean) => {
    setRefused('');
    setEditing(null);
    const answer = await client.GET('/v1/threads/{id}', { params: { path: { id } } });
    if (answer.data) {
      setOpened(answer.data as unknown as Thread);
      setAcross(wholePanel);
      setStarting(false);
      if (summaryOf(id)?.new === true) markRead([id]);
    }
    // A thread on a component since deleted is listed and does not open (COL-067): say why.
    else setRefused(refusalOf(answer.error, say('review.the-thread-could-not-be-2')));
  };

  const openedFor = useRef<number | null>(null);
  useEffect(() => {
    if (opening === null || openedFor.current === opening.arrival) return;
    openedFor.current = opening.arrival;
    // A click somewhere else on the page (each one's arrival below zero) brings the keys along; an
    // address arriving does not take them from where the page put them.
    takeFocus.current = opening.arrival < 0;
    void open(opening.thread, true);
    // `open` is made afresh each render; the arrival is what asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening?.thread, opening?.arrival]);

  const startedFor = useRef(startWhen);
  const [startFocus, setStartFocus] = useState(0);
  useEffect(() => {
    if (startedFor.current === startWhen) return;
    startedFor.current = startWhen;
    setOpened(null);
    setStarting(true);
    setStartFocus((count) => count + 1);
  }, [startWhen]);

  // Words selected in the text offer a thread on them, as they come, unless a thread is being read.
  const selection = targets.find((each) => each.key === 'selection')?.label;
  const noneOpened = useRef(true);
  noneOpened.current = opened === null;
  useEffect(() => {
    if (selection === undefined || !noneOpened.current) return;
    setTarget('');
    setStarting(true);
  }, [selection]);
  useLayoutEffect(() => {
    if (takeFocus.current && across && opened !== null) {
      takeFocus.current = false;
      whole.current?.focus();
    }
    if (cardToFocus.current !== null && !across) {
      window.document.getElementById(`${ids}-card-${cardToFocus.current}`)?.focus();
      cardToFocus.current = null;
    }
  });

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
    setAcross(true);
    setStarting(false);
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
    await read();
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

  const copyLink = async (thread: string) => {
    const { origin, pathname } = window.location;
    try {
      await navigator.clipboard.writeText(
        `${origin}${pathname}${reviewThreadLink(document, thread)}`,
      );
      setSaid(say('review.link-copied'));
    } catch {
      setRefused(say('review.the-link-could-not-be-copied'));
    }
  };

  const reading: Reading = useMemo(
    () => ({
      principalId,
      nameOf: (id) => people.find((each) => each.id === id)?.name ?? '',
      placeOf,
      anchorOf: (thread) => anchorWords(thread.anchor),
    }),
    [principalId, people, placeOf],
  );
  const all = threads ?? [];
  const found = peopleIn(all, people, principalId);
  const shown = shownThreads(all, { show, person, text: textOf(text) }, reading);
  const counts = countsOf(all, principalId);
  const openCount = all.filter((each) => each.resolvedAt === null).length;
  const newOnes = all.filter((each) => each.new);

  const leave = () => {
    if (opened !== null) cardToFocus.current = opened.id;
    setOpened(null);
    setAcross(false);
  };

  const at = opened === null ? -1 : shown.findIndex((each) => each.id === opened.id);
  const step = (by: 1 | -1) => {
    const next = shown[at + by];
    if (next === undefined) return;
    onGoTo?.(next);
    void open(next.id, true);
  };

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const from = event.target as Element;
    if (event.key === 'Escape') {
      event.preventDefault();
      leave();
      return;
    }
    if (from.closest(OWN_KEYS)) return;
    const key = event.key.toLowerCase();
    if (key === 'j' || key === 'k') {
      // Taken here, so a `G` waiting for its letter stops waiting (`useGoToKeys`).
      event.preventDefault();
      step(key === 'j' ? 1 : -1);
    }
  };

  const inThreadOf = (thread: Thread) => [
    ...new Set(thread.comments.map((each) => each.author.id)),
  ];
  const mayAct = (thread: Thread) => thread.resolution === null && mayAnswer(thread.on);

  const resolveButton = (thread: Thread) => (
    <IconButton
      className={styles['resolve']}
      label={say('review.resolve')}
      onClick={() => void resolve(thread.id)}
    >
      <Icon name="Resolve" size={16} />
    </IconButton>
  );
  /** Nobody from outside is offered it; once internal it stays so (COL-038), pressed and at rest. */
  const internalButton = (thread: Thread) =>
    outside ? null : thread.internal === true ? (
      <IconButton className={styles['icon']} label={say('review.internal')} pressed disabled>
        <Icon name="Internal" size={16} />
      </IconButton>
    ) : (
      <IconButton
        className={styles['icon']}
        label={say('review.make-internal')}
        onClick={() => void makeInternal(thread.id)}
      >
        <Icon name="Internal" size={16} />
      </IconButton>
    );

  /** What a thread says of itself beyond its comments, wherever it is opened. */
  const notes = (thread: Thread) => (
    <>
      {thread.internal === true && (
        <p className={styles['note']}>
          <Chip>{say('review.internal')}</Chip> {say('review.nobody-from-outside-the-organisation')}
        </p>
      )}
      {thread.resolution && (
        <p className={styles['note']}>
          {say('review.resolved-by', {
            ...personValues(thread.resolution.by),
            at: when(thread.resolution.at),
          })}
        </p>
      )}
    </>
  );

  const announce = (
    <>
      <p role="status" className={styles['announce']}>
        {said}
      </p>
      {refused !== '' && (
        <p role="alert" className={styles['refused']}>
          {refused}
        </p>
      )}
    </>
  );

  if (opened !== null && across) {
    const summary = summaryOf(opened.id);
    const goTo = summary !== undefined && onGoTo !== undefined ? () => onGoTo(summary) : undefined;
    return (
      <section
        ref={whole}
        tabIndex={-1}
        aria-labelledby={`${ids}-opened`}
        className={styles['wholePanel']}
        onKeyDown={onPanelKey}
      >
        <header className={styles['head']}>
          <IconButton className={styles['icon']} label={say('review.all-threads')} onClick={leave}>
            <Icon name="Back" size={16} />
          </IconButton>
          {at >= 0 && (
            <span className={styles['position']}>
              {say('review.i-of-n-threads', { index: at + 1, count: shown.length })}
            </span>
          )}
          <span className={styles['headSpace']} />
          {at >= 0 && (
            <>
              <IconButton
                className={styles['icon']}
                label={say('review.previous-thread')}
                shortcut="K"
                disabled={at === 0}
                onClick={() => step(-1)}
              >
                <Icon name="Move up" size={16} />
              </IconButton>
              <IconButton
                className={styles['icon']}
                label={say('review.next-thread')}
                shortcut="J"
                disabled={at === shown.length - 1}
                onClick={() => step(1)}
              >
                <Icon name="Move down" size={16} />
              </IconButton>
              <span className={styles['headRule']} />
            </>
          )}
          {mayAct(opened) && resolveButton(opened)}
          {mayAct(opened) && internalButton(opened)}
          <IconButton
            className={styles['icon']}
            label={say('review.copy-link')}
            onClick={() => void copyLink(opened.id)}
          >
            <Icon name="Copy link" size={16} />
          </IconButton>
        </header>
        {announce}
        <div className={styles['wholeScroll']}>
          <div className={styles['quote']}>
            {summary && (
              <p className={styles['anchor']}>
                <span aria-hidden="true">§</span> <span>{placeOf(summary)}</span>
              </p>
            )}
            <h3 id={`${ids}-opened`} className={styles['quoted']} data-content>
              {goTo ? (
                <button type="button" title={say('review.go-to-the-text')} onClick={goTo}>
                  {anchorWords(opened.anchor)}
                  <Icon name="Go to text" size={14} />
                </button>
              ) : (
                anchorWords(opened.anchor)
              )}
            </h3>
          </div>
          <p className={styles['raised']}>
            <AvatarStack people={summary?.participants ?? [opened.startedBy]} />
            <span>
              {say('review.raised-this', {
                ...personValues(opened.startedBy),
                count: opened.comments.length,
              })}
            </span>
          </p>
          {notes(opened)}
          <Comments
            thread={opened}
            size={28}
            people={people}
            principalId={principalId}
            nameOf={nameOf}
            editing={editing}
            onEditing={setEditing}
            onEdit={(comment, parts) => edit(opened.id, comment, parts)}
          />
        </div>
        {mayAct(opened) && (
          <div className={styles['wholeReply']}>
            <ThreadComposer
              label={say('review.reply')}
              placeholder={say('review.reply-or-type-at')}
              action={say('review.reply')}
              people={people}
              inThread={inThreadOf(opened)}
              roomy
              onSend={(parts) => reply(opened.id, parts)}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={styles['panel']}>
      <header className={styles['head']}>
        <h2 className={styles['title']}>{say('review.threads')}</h2>
        <Chip>{say('review.n-open', { count: openCount })}</Chip>
        {newOnes.length > 0 && (
          <Chip tone="accent">{say('review.n-new', { count: newOnes.length })}</Chip>
        )}
        <span className={styles['headSpace']} />
        {targets.length > 0 && (
          <IconButton
            className={styles['icon']}
            label={say('review.new-thread')}
            pressed={starting}
            onClick={() => setStarting(!starting)}
          >
            <Icon name="Add" size={16} />
          </IconButton>
        )}
        <IconButton
          className={styles['icon']}
          label={say('review.mark-all-as-read')}
          disabled={newOnes.length === 0}
          onClick={() => markRead(newOnes.map((each) => each.id))}
        >
          <Icon name="Mark all read" size={16} />
        </IconButton>
      </header>
      {announce}
      {starting && targets.length > 0 && (
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
          <ThreadComposer
            label={say('review.comment')}
            placeholder={say('review.reply-or-type-at-comment')}
            action={say('review.start-thread')}
            people={people}
            roomy
            focusWhen={startFocus}
            onSend={start}
          />
        </section>
      )}
      <div className={styles['controls']}>
        <ThreadSearch
          text={text}
          onText={setText}
          person={person}
          found={found}
          principalId={principalId}
          onChoose={setPerson}
        />
        <MenuButton
          label={say('review.show-choice', { choice: SHOW_WORDS[show]() })}
          title={say('review.show')}
          className={styles['showButton']}
          align="end"
          face={
            <>
              <Icon name="Show" size={16} />
              <span>{show === 'all' ? say('review.all') : SHOW_WORDS[show]()}</span>
              <Icon name="Chevron down" size={14} />
            </>
          }
          items={SHOWS.map((each) => ({
            key: each,
            label: SHOW_WORDS[each](),
            icon: <Icon name={SHOW_ICONS[each]} size={16} />,
            count: formats().number(counts[each]),
            checked: show === each,
            onSelect: () => setShow(each),
          }))}
        />
      </div>
      {found.length > 0 && (
        <PeopleStrip found={found} person={person} principalId={principalId} onChoose={setPerson} />
      )}
      <div className={styles['listScroll']}>
        {threads === null && (
          <p className={styles['note']}>{say('review.the-threads-could-not-be')}</p>
        )}
        {threads && shown.length === 0 && (
          <p className={styles['note']}>{say('review.no-threads-here')}</p>
        )}
        {shown.length > 0 && (
          <ul className={styles['rows']}>
            {shown.map((thread) => {
              const isOpen = opened?.id === thread.id;
              return (
                <li key={thread.id} className={styles['card']} data-open={isOpen || undefined}>
                  <button
                    id={`${ids}-card-${thread.id}`}
                    type="button"
                    className={styles['cardHead']}
                    aria-expanded={isOpen}
                    aria-label={say('review.card-name', {
                      who: thread.startedBy.name ?? say('review.somebody'),
                      anchor: anchorWords(thread.anchor),
                      place: placeOf(thread),
                      count: thread.comments,
                      isNew: thread.new ? 'yes' : 'no',
                      resolved: thread.resolvedAt !== null ? 'yes' : 'no',
                      internal: thread.internal === true ? 'yes' : 'no',
                      orphaned: thread.orphaned ? 'yes' : 'no',
                    })}
                    aria-describedby={`${ids}-said-${thread.id}`}
                    data-resolved={thread.resolvedAt !== null || undefined}
                    onClick={() => {
                      if (isOpen) {
                        setOpened(null);
                        return;
                      }
                      onGoTo?.(thread);
                      void open(thread.id, false);
                    }}
                  >
                    <span className={styles['cardTop']}>
                      <Avatar person={thread.startedBy} size={28} />
                      <span className={styles['cardWho']}>
                        <span className={styles['cardName']}>
                          <strong className={styles['name']} data-content>
                            {thread.startedBy.name ?? say('review.somebody')}
                          </strong>
                          <Outside person={thread.startedBy} />
                          {thread.drafted && <AiTag />}
                        </span>
                        <span className={styles['who']}>{when(thread.startedAt)}</span>
                      </span>
                      {thread.internal === true && (
                        <Chip>
                          <Icon name="Internal" size={12} />
                          {say('review.internal')}
                        </Chip>
                      )}
                      {thread.resolvedAt !== null && <Chip>{say('review.resolved')}</Chip>}
                      {thread.new && <span className={styles['newDot']} aria-hidden="true" />}
                    </span>
                    <span className={styles['anchor']} data-orphaned={thread.orphaned || undefined}>
                      <span aria-hidden="true">§</span>{' '}
                      <span>
                        {thread.orphaned ? say('review.its-text-is-no-longer') : placeOf(thread)}
                      </span>
                    </span>
                    <span
                      id={`${ids}-said-${thread.id}`}
                      className={styles['cardSaid']}
                      data-content
                    >
                      <Said parts={thread.said} nameOf={nameOf} short />
                    </span>
                    <span className={styles['cardFoot']}>
                      <AvatarStack people={thread.participants} />
                      <span className={styles['who']}>
                        {say('review.n-comments', { count: thread.comments })}
                      </span>
                      <span className={styles['headSpace']} />
                      <span className={styles['chevron']} data-open={isOpen || undefined}>
                        <Icon name="Chevron down" size={14} />
                      </span>
                    </span>
                  </button>
                  {isOpen && opened !== null && (
                    <div className={styles['inPlace']}>
                      {notes(opened)}
                      <Comments
                        thread={opened}
                        size={22}
                        people={people}
                        principalId={principalId}
                        nameOf={nameOf}
                        editing={null}
                        onEditing={null}
                        onEdit={async () => false}
                      />
                      {mayAct(opened) && (
                        <ThreadComposer
                          label={say('review.reply')}
                          placeholder={say('review.reply-or-at')}
                          action={say('review.reply')}
                          people={people}
                          inThread={inThreadOf(opened)}
                          onSend={(parts) => reply(opened.id, parts)}
                        />
                      )}
                      <div className={styles['inPlaceActions']}>
                        {mayAct(opened) && resolveButton(opened)}
                        {mayAct(opened) && internalButton(opened)}
                        <span className={styles['headSpace']} />
                        <button
                          type="button"
                          className={styles['openThread']}
                          onClick={() => {
                            takeFocus.current = true;
                            setAcross(true);
                          }}
                        >
                          {say('review.open-thread')}
                          <Icon name="Open thread" size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The search's words, the person being typed after an `@` left out until they are chosen. */
const textOf = (typed: string) => {
  const at = typed.lastIndexOf('@');
  return at >= 0 && (at === 0 || typed[at - 1] === ' ') ? typed.slice(0, at) : typed;
};
