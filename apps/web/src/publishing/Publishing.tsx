import type { createApiClient } from '@alloy-works/api-client';
import {
  TranslatedTitles,
  type TitleToTranslate,
  type TitleTranslation,
} from '../translation/TranslatedTitles.js';
import type { StoredProfile } from '@alloy-works/domain';
import { useEffect, useId, useState } from 'react';

import { FailureList } from './FailureList.js';
import { failuresIn, isProductsOwn, type Failure } from './failures.js';
import { FOLLOW_MS, refusedWords, useFollowing } from './following.js';
import { formatsWords } from './formats.js';
import { PreviewButton, PreviewSaid, profileOnTheWire, type Previewing } from './Preview.js';
import { GeneratedContent } from './GeneratedContent.js';
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

/**
 * What a publish is warned of, which never stops it: the cited sources their source says are
 * retracted or corrected, counted (the XR plan, XR-G); and its terms printed as written, deprecated,
 * or in their base language, counted by uses (TMb). Null where there are none.
 */
function warnedWords(warnings: unknown): string | null {
  if (!Array.isArray(warnings)) return null;
  const counted = (prefix: string) => {
    const counts = new Map<string, number>();
    for (const each of warnings) {
      if (!isRecord(each) || typeof each.count !== 'number' || typeof each.code !== 'string') {
        continue;
      }
      if (!each.code.startsWith(prefix)) continue;
      const kind = each.code.slice(prefix.length);
      counts.set(kind, (counts.get(kind) ?? 0) + each.count);
    }
    return counts;
  };
  const sources = [...counted('source_')].map(([kind, n]) => `${n} ${kind}`);
  const terms = [...counted('term_')].map(([kind, n]) => `${n} ${TERM_WORDS[kind] ?? kind}`);
  // Publishing in a language (TRb): each by its node, counted here.
  const byNode = (code: string) =>
    warnings.filter((each) => isRecord(each) && each.code === code).length;
  const translation = (
    [
      [byNode('component_untranslated'), 'in {its} own language, marked untranslated'],
      [byNode('translation_out_of_date'), 'translated, but out of date with {its} source'],
      [byNode('override_skipped'), 'translated, {its} overrides not applied'],
    ] as const
  ).flatMap(([n, words]) =>
    n === 0
      ? []
      : [
          `${n} ${n === 1 ? 'component' : 'components'} ${words.replace('{its}', n === 1 ? 'its' : 'their')}`,
        ],
  );
  const said = [
    ...(sources.length === 0
      ? []
      : [`Cited sources flagged by their source: ${sources.join(', ')}. Review lists them.`]),
    ...(terms.length === 0 ? [] : [`Terms used: ${terms.join(', ')}.`]),
    ...(translation.length === 0 ? [] : [`Published with ${translation.join(', ')}.`]),
    // And each title with no words in the language (TR-L).
    ...(byNode('title_untranslated') === 0
      ? []
      : [
          `${byNode('title_untranslated')} ${byNode('title_untranslated') === 1 ? 'title' : 'titles'} in the document’s own language.`,
        ]),
  ];
  return said.length === 0 ? null : said.join(' ');
}

/** What each kind of term warning says of its uses. */
const TERM_WORDS: Readonly<Record<string, string>> = {
  unresolved: 'printed as written',
  deprecated: 'deprecated',
  fallback: 'in their base language',
};

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
  shown = null,
  profile,
  language,
  languages = [],
  fallback,
  titles,
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
  /**
   * A request of the reader's that the page's address names (Home's link to a failed publish; the HM
   * plan, HM-G): read once, and shown as a publish followed here is, if it failed and nothing has
   * been asked for since.
   */
  readonly shown?: string | null;
  /**
   * A profile to publish under in place of the document's, chosen in its Profile panel (REU-027; the
   * R12 plan): what it is, in words, and how to go back to the document's.
   */
  readonly profile?: {
    readonly chosen: StoredProfile;
    readonly said: string;
    readonly onClear: () => void;
  };
  /** The document's own language, which a publish is made in unless another is chosen (TRb). */
  readonly language?: string;
  /** The languages its layout gives its words in, its own first: what else it may be made in. */
  readonly languages?: readonly string[];
  /**
   * The document's own fallback where a component has no translation (LOC-037; TR-J): null for the
   * environment's policy. Offered where a publish may be made in another language.
   */
  readonly fallback?: {
    readonly own: 'source' | 'refuse' | null;
    readonly mayChange: boolean;
    readonly onChange: (next: 'source' | 'refuse' | null) => void;
  };
  /** The document's titles in the language chosen, and a way to give them (the TR plan, TR-L). */
  readonly titles?: {
    readonly in: (language: string) => readonly TitleToTranslate[];
    readonly mayEdit: boolean;
    readonly onSave: (change: TitleTranslation) => Promise<boolean>;
  };
}) {
  const offersWord = formats.includes('docx');
  const [chosen, setChosen] = useState<(typeof CHOICES)[number]>(CHOICES[0]);
  const choiceId = useId();
  const [listed, setListed] = useState<Listed[] | 'failed' | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [publish, setPublish] = useState<Publish>({ state: 'idle' });
  // A publish's warnings: flagged sources it cites and its terms' reports, which never stop it.
  const [warned, setWarned] = useState<string | null>(null);
  const { follow, mounted } = useFollowing(client);
  // A language its layout gives its words in, besides the one serving the document's own (TRb).
  const others = languages.filter(
    (each) =>
      language === undefined ||
      !(
        language.toLowerCase() === each.toLowerCase() ||
        language.toLowerCase().startsWith(`${each.toLowerCase()}-`)
      ),
  );
  const [publishIn, setPublishIn] = useState('');
  const languageId = useId();
  const fallbackId = useId();

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

  useEffect(() => {
    if (shown === null) return;
    let current = true;
    client
      .GET('/v1/publication-requests/{id}', { params: { path: { id: shown } } })
      .then(({ data }) => {
        if (current && isRecord(data) && data.state === 'failed') {
          const failures = failuresIn(data.failures);
          setPublish((now) => (now.state === 'idle' ? { state: 'failed', failures } : now));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, shown]);

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
    setWarned(null);
    try {
      const { data, error, response } = await client.POST('/v1/documents/{id}/publications', {
        params: { path: { id: document } },
        // What the author chose, or the PDF where there was nothing to choose.
        body: {
          version,
          formats: offersWord ? [...chosen.formats] : ['pdf'],
          ...(profile === undefined ? {} : { profile: profileOnTheWire(profile.chosen) }),
          ...(publishIn === '' ? {} : { language: publishIn }),
        },
      });
      if (!mounted.current) return;
      if (isRecord(data) && typeof data.id === 'string') {
        setWarned(warnedWords(data.warnings));
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
      {mayPublish && others.length > 0 && (
        <p>
          <label htmlFor={languageId}>Publish in</label>{' '}
          <select
            id={languageId}
            value={publishIn}
            disabled={publish.state === 'working'}
            onChange={(event) => setPublishIn(event.target.value)}
          >
            <option value="">{`Its own language${language === undefined ? '' : `, ${language}`}`}</option>
            {others.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </p>
      )}
      {mayPublish && publishIn !== '' && titles !== undefined && (
        <TranslatedTitles
          language={publishIn}
          titles={titles.in(publishIn)}
          mayEdit={titles.mayEdit}
          onSave={titles.onSave}
        />
      )}
      {others.length > 0 && fallback !== undefined && (
        <p>
          <label htmlFor={fallbackId}>Where a component has no translation</label>{' '}
          <select
            id={fallbackId}
            value={fallback.own ?? ''}
            disabled={!fallback.mayChange}
            onChange={(event) =>
              fallback.onChange(
                event.target.value === '' ? null : (event.target.value as 'source' | 'refuse'),
              )
            }
          >
            <option value="">As the environment says</option>
            <option value="source">Publish it in its own language, marked</option>
            <option value="refuse">Refuse the publish</option>
          </select>
        </p>
      )}
      {mayPublish && profile !== undefined && (
        <p>
          Publishing under a profile chosen in place of the document’s: {profile.said}.{' '}
          {/* The request already sent keeps its profile: only the next publish is the document's. */}
          <button type="button" onClick={profile.onClear}>
            Use the document’s profile
          </button>
        </p>
      )}
      {(mayPublish || preview !== undefined) && (
        // Preview beside Publish, as layout C draws them; Preview alone where Publish is not offered.
        <div className={styles['actions']}>
          {preview !== undefined && (
            <PreviewButton preview={preview} language={publishIn === '' ? undefined : publishIn} />
          )}
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
        {warned !== null && publish.state !== 'refused' && <p>{warned}</p>}
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
      <GeneratedContent client={client} of={{ document }} placeOf={placeOf} />
    </section>
  );
}
