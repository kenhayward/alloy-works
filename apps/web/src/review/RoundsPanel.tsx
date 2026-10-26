import type { createApiClient } from '@alloy-works/api-client';
import { Outside } from '../parts/Outside.js';
import { useCallback, useEffect, useId, useState } from 'react';

import styles from './ThreadsPanel.module.css';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Person {
  readonly id: string;
  readonly name: string | null;
  /** From outside the organisation (IAM-045). */
  readonly external?: true | undefined;
}

/** A round as the service answers it (RR-D, RR-E). */
export interface Round {
  readonly id: string;
  readonly title: string;
  readonly scope: readonly string[];
  readonly dueAt: string;
  readonly baseline: string | null;
  readonly openedBy: Person;
  readonly closed: { readonly by: Person; readonly at: string } | null;
  readonly reviewers: readonly {
    readonly person: Person;
    readonly state: 'not_started' | 'in_progress' | 'complete';
    readonly outcome?: 'commented' | 'nothing_to_say';
    readonly mayReview: boolean;
    readonly threads: number;
    readonly suggestions: number;
  }[];
  readonly complete: number;
  readonly of: number;
  readonly everybody: boolean;
  readonly mayClose: boolean;
  readonly reviewing: boolean;
}

const STATE_WORDS = {
  get not_started() {
    return words('review.not-started');
  },
  get in_progress() {
    return words('review.in-progress');
  },
  get complete() {
    return words('review.done');
  },
} as const;

/** A round's moment, as the person's language writes it. */
const when = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const refusalOf = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;

/** A reviewer's state in words: how they finished, and what they said, counted (RR-D). */
function stateWords(reviewer: Round['reviewers'][number]): string {
  const state =
    reviewer.state === 'complete' && reviewer.outcome !== undefined
      ? words('review.done-2', { outcome: reviewer.outcome })
      : STATE_WORDS[reviewer.state];
  return formats().list(
    [
      state,
      ...(reviewer.threads > 0 ? [words('review.threads', { count: reviewer.threads })] : []),
      ...(reviewer.suggestions > 0
        ? [words('review.suggestions', { count: reviewer.suggestions })]
        : []),
      ...(reviewer.mayReview ? [] : [words('review.may-no-longer-review')]),
    ],
    { type: 'unit' },
  );
}

/**
 * **The Rounds panel in Review** (collaboration.md, Review rounds; the RR plan, Task 4): each round on
 * the document - who is reviewing, each one's state from what they said alone (COL-029, COL-058),
 * and whether everybody has reviewed (COL-030); the reader's own **Start**, **Done, with comments**,
 * **Done, nothing to say** and **Reopen** (COL-032, COL-057); **Close**; and, for an editor, a round
 * opened. Read when it opens and after each act of its own.
 */
export function RoundsPanel({
  client,
  document,
  principalId,
  mayOpen,
  people,
  sections,
  onOpenBaseline,
}: {
  client: Client;
  document: string;
  principalId?: string | undefined;
  /** Whether the reader may open a round: `edit` on the document. */
  mayOpen: boolean;
  people: readonly {
    readonly id: string;
    readonly name: string;
    readonly external?: true | undefined;
  }[];
  /** The document's sections a round's scope may name, in order. */
  sections: readonly { readonly id: string; readonly label: string }[];
  /** Opens a baseline's page, where a round on it is reviewed (RR-G). */
  onOpenBaseline?: (baseline: string) => void;
}) {
  const ids = useId();
  const [rounds, setRounds] = useState<readonly Round[] | null | undefined>(undefined);
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');
  const [opening, setOpening] = useState(false);

  const read = useCallback(async () => {
    const answer = await client.GET('/v1/documents/{id}/rounds', {
      params: { path: { id: document } },
    });
    setRounds(answer.data ? (answer.data.rounds as unknown as Round[]) : null);
  }, [client, document]);

  useEffect(() => {
    void read().catch(() => setRounds(null));
  }, [read]);

  const act = async (
    round: string,
    what: 'start' | 'completion' | 'reopening' | 'closure',
    outcome?: 'commented' | 'nothing_to_say',
  ) => {
    setSaid('');
    setRefused('');
    const path = { id: round };
    const answer =
      what === 'start'
        ? await client.POST('/v1/rounds/{id}/start', { params: { path } })
        : what === 'completion'
          ? await client.POST('/v1/rounds/{id}/completion', {
              params: { path },
              body: { outcome: outcome ?? 'commented' },
            })
          : what === 'reopening'
            ? await client.POST('/v1/rounds/{id}/reopening', { params: { path } })
            : await client.POST('/v1/rounds/{id}/closure', { params: { path } });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, words('review.that-could-not-be-done')));
      // What changed meanwhile - a round closed, a completion made elsewhere - is shown as it is.
      await read();
      return;
    }
    setSaid(
      what === 'start'
        ? words('review.started')
        : what === 'completion'
          ? words('review.done-3')
          : what === 'reopening'
            ? words('review.reopened')
            : words('review.closed'),
    );
    await read();
  };

  return (
    <div className={styles['panel']}>
      <p role="status" className={styles['note']}>
        {said}
      </p>
      {refused !== '' && (
        <p role="alert" className={styles['refused']}>
          {refused}
        </p>
      )}
      {mayOpen && !opening && (
        <button type="button" onClick={() => setOpening(true)}>
          {words('review.open-a-round')}
        </button>
      )}
      {opening && (
        <OpenRound
          client={client}
          document={document}
          people={people}
          sections={sections}
          onCancel={() => setOpening(false)}
          onOpened={async () => {
            setOpening(false);
            setSaid(words('review.opened-and-each-reviewer-told'));
            await read();
          }}
        />
      )}
      {rounds === null && (
        <p className={styles['note']}>{words('review.the-rounds-could-not-be')}</p>
      )}
      {rounds?.length === 0 && (
        <p className={styles['note']}>{words('review.no-review-rounds-here')}</p>
      )}
      {(rounds ?? []).map((round) => {
        const mine = round.reviewers.find((each) => each.person.id === principalId);
        const heading = `${ids}-${round.id}`;
        return (
          <section key={round.id} aria-labelledby={heading} className={styles['thread']}>
            <h3 id={heading} className={styles['heading']} data-content>
              {round.title}
            </h3>
            <p className={styles['note']}>
              {round.closed !== null
                ? round.scope.length > 0
                  ? words('review.closed-on-sections', {
                      at: when(round.closed.at),
                      count: round.scope.length,
                    })
                  : words('review.closed-2', { at: when(round.closed.at) })
                : round.scope.length > 0
                  ? words('review.due-on-sections', {
                      at: when(round.dueAt),
                      count: round.scope.length,
                    })
                  : words('review.due', { at: when(round.dueAt) })}
            </p>
            <p className={styles['state']}>
              {round.everybody
                ? words('review.everybody-has-reviewed-it')
                : words('review.of-done', { complete: round.complete, of: round.of })}
            </p>
            {round.baseline !== null && (
              <p className={styles['note']}>
                {words('review.reviewed-as-a-baseline-holds')}{' '}
                {onOpenBaseline && (
                  <button type="button" onClick={() => onOpenBaseline(round.baseline!)}>
                    {words('review.open-the-baseline')}
                  </button>
                )}
              </p>
            )}
            <ul
              className={styles['rows']}
              aria-label={words('review.reviewers-of', { title: round.title })}
            >
              {round.reviewers.map((each) => (
                <li key={each.person.id} className={styles['row']}>
                  <span>
                    {each.person.name === null ? (
                      words('review.somebody')
                    ) : (
                      <span data-content>{each.person.name}</span>
                    )}
                    <Outside person={each.person} />
                  </span>
                  <span className={styles['state']}>{stateWords(each)}</span>
                </li>
              ))}
            </ul>
            <div className={styles['actions']}>
              {round.reviewing && mine?.state === 'not_started' && (
                <button
                  type="button"
                  aria-describedby={heading}
                  onClick={() => void act(round.id, 'start')}
                >
                  {words('review.start')}
                </button>
              )}
              {round.reviewing && mine !== undefined && mine.state !== 'complete' && (
                <>
                  <button
                    type="button"
                    aria-describedby={heading}
                    onClick={() => void act(round.id, 'completion', 'commented')}
                  >
                    {words('review.done-with-comments')}
                  </button>
                  <button
                    type="button"
                    aria-describedby={heading}
                    onClick={() => void act(round.id, 'completion', 'nothing_to_say')}
                  >
                    {words('review.done-nothing-to-say')}
                  </button>
                </>
              )}
              {round.reviewing && mine?.state === 'complete' && (
                <button
                  type="button"
                  aria-describedby={heading}
                  onClick={() => void act(round.id, 'reopening')}
                >
                  {words('review.reopen')}
                </button>
              )}
              {round.mayClose && (
                <button
                  type="button"
                  aria-describedby={heading}
                  onClick={() => void act(round.id, 'closure')}
                >
                  {words('review.close-the-round')}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Opening a round (COL-028): its title, reviewers, scope, due date and any baseline. */
function OpenRound({
  client,
  document,
  people,
  sections,
  onCancel,
  onOpened,
}: {
  client: Client;
  document: string;
  people: readonly {
    readonly id: string;
    readonly name: string;
    readonly external?: true | undefined;
  }[];
  sections: readonly { readonly id: string; readonly label: string }[];
  onCancel: () => void;
  onOpened: () => Promise<void>;
}) {
  const ids = useId();
  const [title, setTitle] = useState('');
  const [reviewers, setReviewers] = useState<readonly string[]>([]);
  const [scope, setScope] = useState<readonly string[]>([]);
  const [due, setDue] = useState('');
  const [baseline, setBaseline] = useState('');
  const [baselines, setBaselines] = useState<readonly { id: string; name: string }[]>([]);
  const [refused, setRefused] = useState('');

  useEffect(() => {
    void client
      .GET('/v1/documents/{id}/baselines', { params: { path: { id: document }, query: {} } })
      .then(({ data }) =>
        setBaselines(
          (
            (data as { baselines?: { id: string; name: string }[] } | undefined)?.baselines ?? []
          ).map((each) => ({ id: each.id, name: each.name })),
        ),
      )
      .catch(() => setBaselines([]));
  }, [client, document]);

  const toggle = (list: readonly string[], id: string) =>
    list.includes(id) ? list.filter((each) => each !== id) : [...list, id];

  const open = async () => {
    setRefused('');
    const dueAt = new Date(due);
    if (title.trim() === '' || reviewers.length === 0 || Number.isNaN(dueAt.getTime())) {
      setRefused(words('review.give-the-round-a-title'));
      return;
    }
    const answer = await client.POST('/v1/documents/{id}/rounds', {
      params: { path: { id: document } },
      body: {
        title: title.trim(),
        reviewers: [...reviewers],
        dueAt: dueAt.toISOString(),
        ...(scope.length === 0 ? {} : { scope: [...scope] }),
        ...(baseline === '' ? {} : { baseline }),
      },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, words('review.the-round-could-not-be')));
      return;
    }
    await onOpened();
  };

  return (
    <form
      aria-labelledby={`${ids}-heading`}
      className={styles['new']}
      onSubmit={(event) => {
        event.preventDefault();
        void open();
      }}
    >
      <h3 id={`${ids}-heading`} className={styles['heading']}>
        {words('review.a-new-round')}
      </h3>
      <label htmlFor={`${ids}-title`}>{words('review.title')}</label>
      <input
        id={`${ids}-title`}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
      <fieldset>
        <legend>{words('review.reviewers')}</legend>
        {people.map((person) => (
          <label key={person.id}>
            <input
              type="checkbox"
              checked={reviewers.includes(person.id)}
              onChange={() => setReviewers(toggle(reviewers, person.id))}
            />{' '}
            <span data-content>{person.name}</span>
            <Outside person={person} />
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{words('review.sections-or-none-for-the')}</legend>
        {sections.map((section) => (
          <label key={section.id}>
            <input
              type="checkbox"
              checked={scope.includes(section.id)}
              onChange={() => setScope(toggle(scope, section.id))}
            />{' '}
            <span data-content>{section.label}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${ids}-due`}>{words('review.due-2')}</label>
      <input
        id={`${ids}-due`}
        type="datetime-local"
        value={due}
        min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 16)}
        aria-describedby={`${ids}-due-note`}
        onChange={(event) => setDue(event.target.value)}
      />
      <p id={`${ids}-due-note`} className={styles['note']}>
        {words('review.in-your-own-time-zone')}
      </p>
      <label htmlFor={`${ids}-baseline`}>{words('review.review')}</label>
      <select
        id={`${ids}-baseline`}
        value={baseline}
        onChange={(event) => setBaseline(event.target.value)}
      >
        <option value="">{words('review.the-document-as-it-is')}</option>
        {baselines.map((each) => (
          <option key={each.id} value={each.id}>
            {words('review.the-baseline', { name: each.name })}
          </option>
        ))}
      </select>
      {refused !== '' && (
        <p role="alert" className={styles['refused']}>
          {refused}
        </p>
      )}
      <div className={styles['actions']}>
        <button type="button" onClick={onCancel}>
          {words('review.cancel')}
        </button>
        <button type="submit" className="primary">
          {words('review.open-the-round')}
        </button>
      </div>
    </form>
  );
}
