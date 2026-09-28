import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { FailureList } from './FailureList.js';
import { failuresIn, isProductsOwn, type Failure } from './failures.js';
import { FOLLOW_MS, refusedWords, useFollowing } from './following.js';
import { formatsWords } from './formats.js';
import { PreviewButton, PreviewSaid, type Previewing } from './Preview.js';
import styles from './Publishing.module.css';
import { Waiting } from '../states/Waiting.js';
import { everyPage } from '../paging.js';

export { FOLLOW_CAP_MS, FOLLOW_MS, nextFollow } from './following.js';

type Client = ReturnType<typeof createApiClient>;

interface Listed {
  readonly id: string;
  readonly version: { readonly number: string };
  readonly publisher: { readonly displayName: string | null };
  readonly publishedAt: string;
  readonly formats: readonly string[];
}

/**
 * What an author may ask a publish for where the layout makes Word (Word 1, ruling R14): the PDF,
 * which is chosen until they choose otherwise, Word, or both - each asked for PDF first.
 */
const CHOICES = [
  { formats: ['pdf'], words: 'PDF' },
  { formats: ['docx'], words: 'Word' },
  { formats: ['pdf', 'docx'], words: 'PDF and Word' },
] as const;

type Publish =
  | { readonly state: 'idle' }
  | { readonly state: 'working' }
  | { readonly state: 'done'; readonly publication: string }
  | { readonly state: 'failed'; readonly failures: readonly Failure[] }
  | { readonly state: 'refused'; readonly words: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
            formats: Array.isArray(item.formats)
              ? item.formats.filter((format): format is string => typeof format === 'string')
              : [],
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
 * A document's publications, and - for somebody who may publish it - **Publish as PDF**, or, where the
 * layout makes Word, a choice of PDF, Word or both before it (PDF until the author chooses otherwise,
 * native radio buttons, so the arrow keys move along them): the version on screen, asked for, then
 * followed through its request until it is made or every failure is known, each named by its place in
 * the outline (`placeOf`). Nothing is heard from the stream (issue #147,
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
  formats = ['pdf'],
  preview,
}: {
  readonly client: Client;
  readonly document: string;
  readonly version: string;
  readonly mayPublish: boolean;
  readonly placeOf: (node: string) => string;
  /** Given in tests, which need not wait a second. */
  readonly followMs?: number;
  /** The formats the layout a publish would be made under makes: the PDF alone unless it says Word. */
  readonly formats?: readonly string[];
  /**
   * A preview of the document, offered beside **Publish** to anybody who may read it, whether or not
   * they may publish (publishing.md, "Shown beside the text"; PV-B): its pane is the page's to place.
   */
  readonly preview?: Previewing;
}) {
  const offersWord = formats.includes('docx');
  const [chosen, setChosen] = useState<(typeof CHOICES)[number]>(CHOICES[0]);
  const choiceId = useId();
  const [listed, setListed] = useState<Listed[] | 'failed' | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [publish, setPublish] = useState<Publish>({ state: 'idle' });
  const { follow, mounted } = useFollowing(client);

  useEffect(() => {
    let current = true;
    everyPage((cursor) =>
      client.GET('/v1/documents/{id}/publications', {
        params: {
          path: { id: document },
          query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) },
        },
      }),
    )
      .then((all) => {
        if (current) setListed(('items' in all && listedIn({ items: all.items })) || 'failed');
      })
      .catch(() => {
        if (current) setListed('failed');
      });
    return () => {
      current = false;
    };
  }, [client, document, listAttempt]);

  /** One answer about the request: whether it has settled, and if so, what it came to. */
  const settle = (data: unknown): boolean => {
    if (!isRecord(data)) {
      setPublish({
        state: 'refused',
        words: 'The publish could not be followed. Look for it below later.',
      });
      return true;
    }
    if (data.state === 'done' && typeof data.publication === 'string') {
      setPublish({ state: 'done', publication: data.publication });
      setListAttempt((count) => count + 1);
      return true;
    }
    if (data.state === 'failed') {
      setPublish({ state: 'failed', failures: failuresIn(data.failures) });
      return true;
    }
    return false;
  };

  const start = async () => {
    setPublish({ state: 'working' });
    try {
      const { data, error, response } = await client.POST('/v1/documents/{id}/publications', {
        params: { path: { id: document } },
        // What the author chose, or the PDF where there was nothing to choose.
        body: { version, formats: offersWord ? [...chosen.formats] : ['pdf'] },
      });
      if (!mounted.current) return;
      if (isRecord(data) && typeof data.id === 'string') {
        follow(data.id, followMs, settle);
        return;
      }
      setPublish({ state: 'refused', words: refusedWords('publish', response.status, error) });
    } catch {
      if (mounted.current) {
        setPublish({ state: 'refused', words: refusedWords('publish', null, undefined) });
      }
    }
  };

  return (
    <section aria-labelledby="publications-title">
      <h3 id="publications-title">Publications</h3>
      {mayPublish && offersWord && (
        <div role="radiogroup" aria-labelledby={`${choiceId}-label`}>
          <span id={`${choiceId}-label`}>Publish as</span>
          {CHOICES.map((choice) => (
            <label key={choice.words}>
              {' '}
              <input
                type="radio"
                name={`${choiceId}-formats`}
                checked={chosen === choice}
                disabled={publish.state === 'working'}
                onChange={() => setChosen(choice)}
              />{' '}
              {choice.words}
            </label>
          ))}
        </div>
      )}
      {(mayPublish || preview !== undefined) && (
        // Preview beside Publish, as layout C draws them; Preview alone where Publish is not offered.
        <div className={styles['actions']}>
          {preview !== undefined && <PreviewButton preview={preview} />}
          {mayPublish && (
            <button
              className="primary"
              type="button"
              disabled={publish.state === 'working'}
              onClick={() => void start()}
            >
              Publish as {offersWord ? chosen.words : 'PDF'}
            </button>
          )}
        </div>
      )}
      {preview !== undefined && <PreviewSaid preview={preview} />}
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
              <FailureList
                label="Why it could not be published"
                failures={publish.failures}
                placeOf={placeOf}
                wordOffered={offersWord}
              />
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
              ({each.formats.length > 0 && `${formatsWords(each.formats)}, `}not approved)
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
