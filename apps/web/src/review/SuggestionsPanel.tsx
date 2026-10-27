import type { createApiClient } from '@alloy-works/api-client';
import { Outside } from '../parts/Outside.js';
import { compareContent, unitTexts, type ContentDocument } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useState } from 'react';

import { Redline } from '../compare/Redline.js';
import styles from './ThreadsPanel.module.css';
import { formats, words, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Person {
  readonly id: string;
  readonly name: string | null;
  /** From outside the organisation (IAM-045). */
  readonly external?: true | undefined;
}

interface StalePlace {
  readonly block: string | null;
  readonly member?: string;
  readonly why: 'changed' | 'gone' | 'anchor_gone' | 'invalid';
}

/** A suggestion as the document's list answers it (COL-022, COL-052). */
export interface SuggestionSummary {
  readonly id: string;
  readonly component: string;
  readonly madeBy: Person;
  readonly madeAt: string;
  readonly state: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  readonly stale: readonly StalePlace[] | null;
}

interface Opened extends SuggestionSummary {
  readonly drawnOver: { readonly content: unknown };
  readonly drawn: unknown;
}

type Show = 'pending' | 'resolved' | 'all';
const SHOWN: Record<Show, string> = {
  get pending() {
    return words('review.pending');
  },
  get resolved() {
    return words('review.resolved');
  },
  get all() {
    return words('review.all');
  },
};
const STATE_WORDS: Record<SuggestionSummary['state'], string> = {
  get pending() {
    return words('review.pending');
  },
  get accepted() {
    return words('review.accepted');
  },
  get rejected() {
    return words('review.rejected');
  },
  get withdrawn() {
    return words('review.withdrawn');
  },
};

/** A suggestion's moment, as the person's language writes it. */
const when = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Why a suggestion no longer fits, place by place, in words (COL-052). */
export function staleWords(stale: readonly StalePlace[]): string {
  const one = (place: StalePlace) => {
    // Where: a block, a member of the component by its name, or the whole of it.
    const where = {
      place: place.block !== null ? 'block' : place.member === undefined ? 'whole' : 'member',
      member: place.member ?? '',
    };
    switch (place.why) {
      case 'changed':
        return words('review.has-changed-since', where);
      case 'gone':
        return words('review.is-no-longer-there', where);
      case 'anchor_gone':
        return words('review.the-block-it-follows-is');
      case 'invalid':
        return words('review.the-result-would-not-be');
    }
  };
  return words('review.no-longer-fits', {
    reasons: formats().list(stale.map(one), { type: 'unit' }),
  });
}

/** Whose a suggestion is: `named` says whether it has a name to show as `who`. */
const madeBy = (person: Person) => ({
  named: person.name === null ? 'no' : 'yes',
  who: person.name ?? '',
});

/** What a refusal says, from the service's own words, or a sentence of ours where it sent none. */
const refusalOf = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;

/**
 * The suggestions panel in Review (CNT-157; the SG plan, Task 3): every suggestion on the components
 * the document places, filtered by state; one opened, drawn as a redline over what it is drawn over;
 * accepted, rejected or withdrawn; and every pending one accepted or rejected at once, by author.
 * Read when it opens and after each act of its own, never live (SG-K).
 */
export function SuggestionsPanel({
  client,
  document,
  principalId,
  mayResolve,
  placeOf,
  refresh = 0,
  onChanged,
}: {
  client: Client;
  document: string;
  principalId?: string | undefined;
  /** Whether the reader may accept and reject on a component: `edit` on it. */
  mayResolve: (component: string) => boolean;
  /** Where a component stands in the document, in words. */
  placeOf: (component: string) => string;
  /** Bumped by the page to read the list again, as after a suggestion is sent. */
  refresh?: number;
  /** Told after an act changes a component, so the page reads its text again. */
  onChanged?: () => void;
}) {
  const ids = useId();
  const [show, setShow] = useState<Show>('pending');
  const [listed, setListed] = useState<readonly SuggestionSummary[] | null | undefined>(undefined);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [author, setAuthor] = useState('');
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');

  const read = useCallback(async () => {
    const all: SuggestionSummary[] = [];
    let cursor: string | undefined;
    do {
      const answer = await client.GET('/v1/documents/{id}/suggestions', {
        params: {
          path: { id: document },
          query: {
            limit: '100',
            ...(show === 'all' ? {} : { state: show }),
            ...(cursor === undefined ? {} : { cursor }),
          },
        },
      });
      if (!answer.data) return setListed(null);
      all.push(...(answer.data.suggestions as unknown as SuggestionSummary[]));
      cursor = answer.data.next ?? undefined;
    } while (cursor !== undefined);
    setListed(all);
  }, [client, document, show]);

  useEffect(() => {
    void read().catch(() => setListed(null));
  }, [read, refresh]);

  const open = async (id: string) => {
    const answer = await client.GET('/v1/suggestions/{id}', { params: { path: { id } } });
    if (answer.data) setOpened(answer.data as unknown as Opened);
  };

  const act = async (id: string, what: 'acceptance' | 'rejection' | 'withdrawal') => {
    setSaid('');
    setRefused('');
    const path = { id };
    const answer =
      what === 'acceptance'
        ? await client.POST('/v1/suggestions/{id}/acceptance', { params: { path } })
        : what === 'rejection'
          ? await client.POST('/v1/suggestions/{id}/rejection', { params: { path } })
          : await client.POST('/v1/suggestions/{id}/withdrawal', { params: { path } });
    if (!answer.data) {
      const error = answer.error as { stale?: StalePlace[]; holder?: Person } | undefined;
      setRefused(
        error?.stale
          ? staleWords(error.stale)
          : refusalOf(answer.error, words('review.the-suggestion-could-not-be')),
      );
      return;
    }
    // Announced naming whose and where (CNT-137).
    const done = answer.data as unknown as Opened;
    setSaid(
      words('review.s-suggestion-on', {
        ...madeBy(done.madeBy),
        place: placeOf(done.component),
        act: what,
      }),
    );
    setOpened(done);
    if (what === 'acceptance') onChanged?.();
    await read();
  };

  const bulk = async (what: 'accept' | 'reject') => {
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/suggestions/resolutions', {
      body: {
        act: what,
        scope: `artifact:${document}`,
        ...(author === '' ? {} : { author }),
      },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, words('review.the-suggestions-could-not-be')));
      return;
    }
    const { resolved, left } = answer.data;
    // Many at once are counted, not named (CNT-137 names each one acted on alone).
    setSaid(
      left.length === 0
        ? words('review.bulk-resolved', { act: what, count: resolved.length })
        : words('review.bulk-resolved-some-left', {
            act: what,
            count: resolved.length,
            left: left.length,
          }),
    );
    if (what === 'accept' && resolved.length > 0) onChanged?.();
    await read();
  };

  const authors = [
    ...new Map((listed ?? []).map((each) => [each.madeBy.id, each.madeBy] as const)).values(),
  ];
  const pending = (listed ?? []).filter((each) => each.state === 'pending');

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
      {opened !== null ? (
        <section aria-labelledby={`${ids}-opened`} className={styles['thread']}>
          <button type="button" className={styles['back']} onClick={() => setOpened(null)}>
            {words('review.all-suggestions')}
          </button>
          <h3 id={`${ids}-opened`} className={styles['heading']}>
            {words('review.s-suggestion-on-2', {
              ...madeBy(opened.madeBy),
              place: placeOf(opened.component),
            })}
          </h3>
          <p className={styles['note']}>
            {words('review.made', { state: opened.state, at: when(opened.madeAt) })}
          </p>
          {opened.stale !== null && opened.stale.length > 0 && (
            <p className={styles['note']}>{staleWords(opened.stale)}</p>
          )}
          <Redline
            changes={
              compareContent(
                opened.drawnOver.content as ContentDocument,
                opened.drawn as ContentDocument,
              ).changes
            }
            texts={{
              older: unitTexts(opened.drawnOver.content as ContentDocument),
              newer: unitTexts(opened.drawn as ContentDocument),
            }}
            label={words('review.what-it-changes')}
            content={opened.drawn as ContentDocument}
          />
          {opened.state === 'pending' && (
            <div className={styles['actions']}>
              {mayResolve(opened.component) && (
                <>
                  <button type="button" onClick={() => void act(opened.id, 'acceptance')}>
                    {words('review.accept')}
                  </button>
                  <button type="button" onClick={() => void act(opened.id, 'rejection')}>
                    {words('review.reject')}
                  </button>
                </>
              )}
              {opened.madeBy.id === principalId && (
                <button type="button" onClick={() => void act(opened.id, 'withdrawal')}>
                  {words('review.withdraw')}
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
        <>
          <div className={styles['controls']}>
            <label htmlFor={`${ids}-show`}>{words('review.show')}</label>
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
          {pending.length > 0 && pending.some((each) => mayResolve(each.component)) && (
            <div className={styles['controls']}>
              <label htmlFor={`${ids}-author`}>{words('review.by')}</label>
              <select
                id={`${ids}-author`}
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              >
                <option value="">{words('review.everybody')}</option>
                {authors.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name ?? words('review.somebody')}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void bulk('accept')}>
                {words('review.accept-all')}
              </button>
              <button type="button" onClick={() => void bulk('reject')}>
                {words('review.reject-all')}
              </button>
            </div>
          )}
          {listed === null && (
            <p className={styles['note']}>{words('review.the-suggestions-could-not-be-2')}</p>
          )}
          {listed?.length === 0 && (
            <p className={styles['note']}>{words('review.no-suggestions-here')}</p>
          )}
          {listed && listed.length > 0 && (
            <ul className={styles['rows']}>
              {listed.map((each) => (
                <li key={each.id} className={styles['row']}>
                  <button
                    type="button"
                    className={styles['open']}
                    onClick={() => void open(each.id)}
                  >
                    {wordsWith(
                      'review.on',
                      { named: madeBy(each.madeBy).named, place: placeOf(each.component) },
                      {
                        who: <span data-content>{each.madeBy.name}</span>,
                        outside: <Outside person={each.madeBy} />,
                      },
                    )}
                  </button>
                  <span className={styles['note']}>{when(each.madeAt)}</span>
                  <span className={styles['state']}>{STATE_WORDS[each.state]}</span>
                  {each.stale !== null && each.stale.length > 0 && (
                    <span className={styles['state']}>{staleWords(each.stale)}</span>
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
