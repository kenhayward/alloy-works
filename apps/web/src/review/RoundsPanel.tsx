import type { createApiClient } from '@alloy-works/api-client';
import { Outside } from '../parts/Outside.js';
import { useCallback, useEffect, useId, useState } from 'react';

import styles from './ThreadsPanel.module.css';

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
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Done',
} as const;
const OUTCOME_WORDS = { commented: 'with comments', nothing_to_say: 'nothing to say' } as const;

const when = new Intl.DateTimeFormat('en-GB', {
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
      ? `Done, ${OUTCOME_WORDS[reviewer.outcome]}`
      : STATE_WORDS[reviewer.state];
  const said = [
    reviewer.threads > 0
      ? `${reviewer.threads} ${reviewer.threads === 1 ? 'thread' : 'threads'}`
      : '',
    reviewer.suggestions > 0
      ? `${reviewer.suggestions} ${reviewer.suggestions === 1 ? 'suggestion' : 'suggestions'}`
      : '',
  ].filter((each) => each !== '');
  return [state, ...said, ...(reviewer.mayReview ? [] : ['may no longer review'])].join(', ');
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
      setRefused(refusalOf(answer.error, 'That could not be done.'));
      // What changed meanwhile - a round closed, a completion made elsewhere - is shown as it is.
      await read();
      return;
    }
    setSaid(
      what === 'start'
        ? 'Started.'
        : what === 'completion'
          ? 'Done.'
          : what === 'reopening'
            ? 'Reopened.'
            : 'Closed.',
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
          Open a round
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
            setSaid('Opened, and each reviewer told.');
            await read();
          }}
        />
      )}
      {rounds === null && <p className={styles['note']}>The rounds could not be read.</p>}
      {rounds?.length === 0 && <p className={styles['note']}>No review rounds here.</p>}
      {(rounds ?? []).map((round) => {
        const mine = round.reviewers.find((each) => each.person.id === principalId);
        const heading = `${ids}-${round.id}`;
        return (
          <section key={round.id} aria-labelledby={heading} className={styles['thread']}>
            <h3 id={heading} className={styles['heading']}>
              {round.title}
            </h3>
            <p className={styles['note']}>
              {round.closed !== null
                ? `Closed ${when.format(new Date(round.closed.at))}`
                : `Due ${when.format(new Date(round.dueAt))}`}
              {round.scope.length > 0 ? `, on ${round.scope.length} of its sections` : ''}
            </p>
            <p className={styles['state']}>
              {round.everybody
                ? 'Everybody has reviewed it.'
                : `${round.complete} of ${round.of} done.`}
            </p>
            {round.baseline !== null && (
              <p className={styles['note']}>
                Reviewed as a baseline holds it.{' '}
                {onOpenBaseline && (
                  <button type="button" onClick={() => onOpenBaseline(round.baseline!)}>
                    Open the baseline
                  </button>
                )}
              </p>
            )}
            <ul className={styles['rows']} aria-label={`Reviewers of ${round.title}`}>
              {round.reviewers.map((each) => (
                <li key={each.person.id} className={styles['row']}>
                  <span>
                    {each.person.name ?? 'Somebody'}
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
                  Start
                </button>
              )}
              {round.reviewing && mine !== undefined && mine.state !== 'complete' && (
                <>
                  <button
                    type="button"
                    aria-describedby={heading}
                    onClick={() => void act(round.id, 'completion', 'commented')}
                  >
                    Done, with comments
                  </button>
                  <button
                    type="button"
                    aria-describedby={heading}
                    onClick={() => void act(round.id, 'completion', 'nothing_to_say')}
                  >
                    Done, nothing to say
                  </button>
                </>
              )}
              {round.reviewing && mine?.state === 'complete' && (
                <button
                  type="button"
                  aria-describedby={heading}
                  onClick={() => void act(round.id, 'reopening')}
                >
                  Reopen
                </button>
              )}
              {round.mayClose && (
                <button
                  type="button"
                  aria-describedby={heading}
                  onClick={() => void act(round.id, 'closure')}
                >
                  Close the round
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
      setRefused('Give the round a title, at least one reviewer and a due date.');
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
      setRefused(refusalOf(answer.error, 'The round could not be opened.'));
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
        A new round
      </h3>
      <label htmlFor={`${ids}-title`}>Title</label>
      <input
        id={`${ids}-title`}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
      <fieldset>
        <legend>Reviewers</legend>
        {people.map((person) => (
          <label key={person.id}>
            <input
              type="checkbox"
              checked={reviewers.includes(person.id)}
              onChange={() => setReviewers(toggle(reviewers, person.id))}
            />{' '}
            {person.name}
            <Outside person={person} />
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Sections, or none for the whole document</legend>
        {sections.map((section) => (
          <label key={section.id}>
            <input
              type="checkbox"
              checked={scope.includes(section.id)}
              onChange={() => setScope(toggle(scope, section.id))}
            />{' '}
            {section.label}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${ids}-due`}>Due</label>
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
        In your own time zone.
      </p>
      <label htmlFor={`${ids}-baseline`}>Review</label>
      <select
        id={`${ids}-baseline`}
        value={baseline}
        onChange={(event) => setBaseline(event.target.value)}
      >
        <option value="">The document as it is</option>
        {baselines.map((each) => (
          <option key={each.id} value={each.id}>
            {`The baseline ${each.name}`}
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
          Cancel
        </button>
        <button type="submit" className="primary">
          Open the round
        </button>
      </div>
    </form>
  );
}
