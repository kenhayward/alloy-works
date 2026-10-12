import type { createApiClient } from '@alloy-works/api-client';
import { compareContent, unitTexts, type ContentDocument } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useState } from 'react';

import { Redline } from '../compare/Redline.js';
import styles from './ThreadsPanel.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Person {
  readonly id: string;
  readonly name: string | null;
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
const SHOWN: Record<Show, string> = { pending: 'Pending', resolved: 'Resolved', all: 'All' };
const STATE_WORDS: Record<SuggestionSummary['state'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Why a suggestion no longer fits, place by place, in words (COL-052). */
export function staleWords(stale: readonly StalePlace[]): string {
  const one = (place: StalePlace) => {
    const where = place.block === null ? `its ${place.member ?? 'whole'}` : 'a block it changes';
    switch (place.why) {
      case 'changed':
        return `${where} has changed since`;
      case 'gone':
        return `${where} is no longer there`;
      case 'anchor_gone':
        return 'the block it follows is no longer there';
      case 'invalid':
        return 'the result would not be a document this product can store';
    }
  };
  return `No longer fits: ${stale.map(one).join('; ')}.`;
}

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
          : refusalOf(answer.error, 'The suggestion could not be resolved.'),
      );
      return;
    }
    setSaid(
      what === 'acceptance' ? 'Accepted.' : what === 'rejection' ? 'Rejected.' : 'Withdrawn.',
    );
    setOpened(answer.data as unknown as Opened);
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
      setRefused(refusalOf(answer.error, 'The suggestions could not be resolved.'));
      return;
    }
    const { resolved, left } = answer.data;
    const done = what === 'accept' ? 'Accepted' : 'Rejected';
    setSaid(
      `${done} ${resolved.length}.` +
        (left.length === 0 ? '' : ` Left ${left.length} pending, which could not be.`),
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
            All suggestions
          </button>
          <h3 id={`${ids}-opened`} className={styles['heading']}>
            {`${opened.madeBy.name ?? 'Somebody'}'s suggestion on ${placeOf(opened.component)}`}
          </h3>
          <p className={styles['note']}>
            {`${STATE_WORDS[opened.state]}, made ${when.format(new Date(opened.madeAt))}`}
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
            label="What it changes"
          />
          {opened.state === 'pending' && (
            <div className={styles['actions']}>
              {mayResolve(opened.component) && (
                <>
                  <button type="button" onClick={() => void act(opened.id, 'acceptance')}>
                    Accept
                  </button>
                  <button type="button" onClick={() => void act(opened.id, 'rejection')}>
                    Reject
                  </button>
                </>
              )}
              {opened.madeBy.id === principalId && (
                <button type="button" onClick={() => void act(opened.id, 'withdrawal')}>
                  Withdraw
                </button>
              )}
            </div>
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
          {pending.length > 0 && pending.some((each) => mayResolve(each.component)) && (
            <div className={styles['controls']}>
              <label htmlFor={`${ids}-author`}>By</label>
              <select
                id={`${ids}-author`}
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              >
                <option value="">Everybody</option>
                {authors.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name ?? 'Somebody'}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void bulk('accept')}>
                Accept all
              </button>
              <button type="button" onClick={() => void bulk('reject')}>
                Reject all
              </button>
            </div>
          )}
          {listed === null && <p className={styles['note']}>The suggestions could not be read.</p>}
          {listed?.length === 0 && <p className={styles['note']}>No suggestions here.</p>}
          {listed && listed.length > 0 && (
            <ul className={styles['rows']}>
              {listed.map((each) => (
                <li key={each.id} className={styles['row']}>
                  <button
                    type="button"
                    className={styles['open']}
                    onClick={() => void open(each.id)}
                  >
                    {`${each.madeBy.name ?? 'Somebody'} on ${placeOf(each.component)}`}
                  </button>
                  <span className={styles['note']}>{when.format(new Date(each.madeAt))}</span>
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
