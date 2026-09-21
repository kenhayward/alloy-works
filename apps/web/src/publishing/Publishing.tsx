import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { failureWords, isProductsOwn, type Failure } from './failures.js';
import { Waiting } from '../states/Waiting.js';

type Client = ReturnType<typeof createApiClient>;

/** How long after asking for a publish it is first asked about. A publish takes a second or two. */
export const FOLLOW_MS = 1000;

/** The longest wait between two asks about one publish, however long it has waited. */
export const FOLLOW_CAP_MS = 30_000;

/**
 * The wait before the next ask, after an answer that it is still queued or an ask that failed: twice
 * the last, up to the cap - so a publish no worker takes is asked about less and less often, and never
 * stops being asked about while the page is open (a stop is the design's open question, not built).
 */
export function nextFollow(wait: number): number {
  return Math.min(wait * 2, FOLLOW_CAP_MS);
}

interface Listed {
  readonly id: string;
  readonly version: { readonly number: string };
  readonly publisher: { readonly displayName: string | null };
  readonly publishedAt: string;
}

type Publish =
  | { readonly state: 'idle' }
  | { readonly state: 'working' }
  | { readonly state: 'done'; readonly publication: string }
  | { readonly state: 'failed'; readonly failures: readonly Failure[] }
  | { readonly state: 'refused'; readonly words: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The client's bodies are `any`: each failure is checked member by member, never trusted. */
function failuresIn(value: unknown): Failure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) =>
    isRecord(each) && typeof each.code === 'string'
      ? [
          {
            stage: String(each.stage),
            code: each.code,
            node: typeof each.node === 'string' ? each.node : null,
            block: typeof each.block === 'string' ? each.block : null,
            detail: typeof each.detail === 'string' ? each.detail : null,
          },
        ]
      : [],
  );
}

function listedIn(value: unknown): Listed[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  return value.items.flatMap((item) =>
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.publishedAt === 'string' &&
    isRecord(item.version) &&
    typeof item.version.number === 'string' &&
    isRecord(item.publisher)
      ? [
          {
            id: item.id,
            version: { number: item.version.number },
            publisher: {
              displayName:
                typeof item.publisher.displayName === 'string' ? item.publisher.displayName : null,
            },
            publishedAt: item.publishedAt,
          },
        ]
      : [],
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

/**
 * What introduces a failed publish's list. A failure of the engine's or the store's is the product's,
 * not the author's - a face changed under the worker included - so it never asks them to put the
 * document right (pre-flight finding 9).
 */
function failedIntro(failures: readonly Failure[]): string {
  if (failures.length === 0) return 'The document could not be published. Publish again.';
  return isProductsOwn(failures)
    ? 'The publication could not be made, and nothing in the document caused it. Publish again later.'
    : 'The document could not be published. Put these right and publish again:';
}

/**
 * A document's publications, and - for somebody who may publish it - **Publish as PDF**: the version
 * on screen, asked for, then followed through its request until it is made or every failure is known,
 * each named by its place in the outline (`placeOf`). Nothing is heard from the stream (issue #147,
 * decision G): the request is asked about while this page is open - a second after it is made, then
 * twice as long after each answer that it is still waiting, up to half a minute - and only by the
 * person who asked. Its live region is polite and has no `status` role: the page around it has one already
 * (finding 10).
 *
 * **One ask at a time, and none once the page has closed.** Following starts from the click, never
 * from an effect, so StrictMode's simulated remount cannot start a second one; each ask is scheduled
 * only after the last has been answered; the button is disabled while a publish is followed; and
 * closing the page clears the waiting timer and drops an answer still on its way. A request no worker
 * ever takes is asked about, at the capped interval, for as long as the page stays open (named in the
 * design as an open question, not built for).
 */
export function Publishing({
  client,
  document,
  version,
  mayPublish,
  placeOf,
  followMs = FOLLOW_MS,
}: {
  readonly client: Client;
  readonly document: string;
  readonly version: string;
  readonly mayPublish: boolean;
  readonly placeOf: (node: string) => string;
  /** Given in tests, which need not wait a second. */
  readonly followMs?: number;
}) {
  const [listed, setListed] = useState<Listed[] | 'failed' | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [publish, setPublish] = useState<Publish>({ state: 'idle' });
  const following = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (following.current !== null) clearTimeout(following.current);
      following.current = null;
    };
  }, []);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/documents/{id}/publications', { params: { path: { id: document } } })
      .then(({ data }) => {
        if (current) setListed(listedIn(data) ?? 'failed');
      })
      .catch(() => {
        if (current) setListed('failed');
      });
    return () => {
      current = false;
    };
  }, [client, document, listAttempt]);

  const follow = useCallback(
    (request: string, wait: number) => {
      following.current = setTimeout(() => {
        following.current = null;
        client
          .GET('/v1/publication-requests/{id}', { params: { path: { id: request } } })
          .then(({ data }) => {
            if (!mounted.current) return;
            if (!isRecord(data)) {
              setPublish({
                state: 'refused',
                words: 'The publish could not be followed. Look for it below later.',
              });
            } else if (data.state === 'done' && typeof data.publication === 'string') {
              setPublish({ state: 'done', publication: data.publication });
              setListAttempt((count) => count + 1);
            } else if (data.state === 'failed') {
              setPublish({ state: 'failed', failures: failuresIn(data.failures) });
            } else {
              follow(request, nextFollow(wait));
            }
          })
          .catch(() => {
            if (mounted.current) follow(request, nextFollow(wait));
          });
      }, wait);
    },
    [client],
  );

  const start = async () => {
    setPublish({ state: 'working' });
    try {
      const { data, error, response } = await client.POST('/v1/documents/{id}/publications', {
        params: { path: { id: document } },
        body: { version, formats: ['pdf'] },
      });
      if (!mounted.current) return;
      if (isRecord(data) && typeof data.id === 'string') {
        follow(data.id, followMs);
        return;
      }
      // A refusal at the door (400) carries its own words - what format the layout does not make, or
      // what language it and the document are in - which say more than a fixed sentence could.
      const atTheDoor =
        response.status === 400 && isRecord(error) && typeof error.message === 'string'
          ? error.message
          : undefined;
      setPublish({
        state: 'refused',
        words:
          response.status === 409
            ? 'This document has changed since the page opened. Reload it and publish again.'
            : response.status === 403
              ? 'You may read this document but not publish it.'
              : (atTheDoor ?? 'The publish could not be asked for. Try again.'),
      });
    } catch {
      if (mounted.current) {
        setPublish({ state: 'refused', words: 'The publish could not be asked for. Try again.' });
      }
    }
  };

  return (
    <section aria-labelledby="publications-title">
      <h3 id="publications-title">Publications</h3>
      {mayPublish && (
        <p>
          <button
            className="primary"
            type="button"
            disabled={publish.state === 'working'}
            onClick={() => void start()}
          >
            Publish as PDF
          </button>
        </p>
      )}
      <div aria-live="polite">
        {publish.state === 'working' && <Waiting>Publishing...</Waiting>}
        {publish.state === 'done' && (
          <p>
            Published. <a href={`#/publications/${publish.publication}`}>Open the publication</a>
          </p>
        )}
        {publish.state === 'refused' && <p>{publish.words}</p>}
        {publish.state === 'failed' && (
          <>
            <p>{failedIntro(publish.failures)}</p>
            {publish.failures.length > 0 && (
              <ul aria-label="Why it could not be published">
                {publish.failures.map((failure, index) => (
                  <li key={`${failure.code}-${failure.node ?? ''}-${failure.block ?? ''}-${index}`}>
                    {failure.node === null ? '' : `${placeOf(failure.node)}: `}
                    {failureWords(failure)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {listed === null && <p>Reading the publications...</p>}
      {listed === 'failed' && (
        <p>
          The publications could not be read.{' '}
          <button type="button" onClick={() => setListAttempt((count) => count + 1)}>
            Try again
          </button>
        </p>
      )}
      {Array.isArray(listed) && listed.length === 0 && (
        <p>Nothing has been published from this document.</p>
      )}
      {Array.isArray(listed) && listed.length > 0 && (
        <ul>
          {listed.map((each) => (
            <li key={each.id}>
              <a href={`#/publications/${each.id}`}>
                Version {each.version.number}, published by{' '}
                {each.publisher.displayName ?? 'somebody'} on {when(each.publishedAt)}
              </a>{' '}
              (not approved)
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
