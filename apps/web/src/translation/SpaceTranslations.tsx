import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { isRecord } from '../data/shapes.js';
import { More } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from '../structure/DocumentList.module.css';
import { TranslationChips, type TranslationSaid } from './Translations.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** Where the space translation report is (the TR plan, TR-M). */
export const TRANSLATIONS = '#/translations';

interface Space {
  readonly id: string;
  readonly name: string;
}

interface Reported {
  readonly component: { readonly id: string; readonly title: string };
  readonly translations: readonly {
    readonly language: string;
    readonly status: { readonly status: string; readonly retranslate?: boolean };
  }[];
}

type Status = 'outOfDate' | 'untranslated' | 'inTranslation' | 'machineDrafted' | 'translated';

const STATUSES: readonly Status[] = [
  'outOfDate',
  'untranslated',
  'inTranslation',
  'machineDrafted',
  'translated',
];

/** A status a person may filter by, in words: out of date whether or not it needs retranslating. */
function filterWords(status: Status): string {
  switch (status) {
    case 'outOfDate':
      return words('translation.out-of-date');
    case 'untranslated':
      return words('translation.untranslated');
    case 'inTranslation':
      return words('translation.in-translation');
    case 'machineDrafted':
      return words('translation.machine-drafted');
    default:
      return words('translation.translated');
  }
}

const said = (item: Reported): TranslationSaid[] =>
  item.translations.map((each) => ({ language: each.language, ...each.status }));

/**
 * **Translations** (LOC-016; the TR plan, TR-M; the TE plan, TE-C): each component of a space with a
 * translation, by its title, with each language's status, out of date ones first; a page at a time,
 * narrowed to a language or a status, of what the reader may read alone.
 */
export function SpaceTranslations({ client }: { readonly client: Client }) {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [spacesFailed, setSpacesFailed] = useState(false);
  // The filters as typed, and as last shown: a language applies when Show is pressed.
  const [typed, setTyped] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const languageId = useId();
  const statusId = useId();

  useEffect(() => {
    let live = true;
    void everyPage<unknown>(async (cursor) =>
      client.GET('/v1/spaces', { params: { query: cursor === undefined ? {} : { cursor } } }),
    ).then((answer) => {
      if (!live) return;
      if (!('items' in answer)) {
        setSpacesFailed(true);
        return;
      }
      const found = answer.items.flatMap((each) =>
        isRecord(each) && typeof each.id === 'string' && typeof each.name === 'string'
          ? [{ id: each.id, name: each.name }]
          : [],
      );
      setSpaces(found);
      setSpace((held) => held ?? found[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, [client]);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (space === null) {
        return {
          data: { items: [], next: null, total: 0, facets: null },
          response: new Response(),
        };
      }
      const { data, response } = await client.GET('/v1/spaces/{space}/translations', {
        params: {
          path: { space },
          query: {
            ...(cursor === null ? {} : { cursor }),
            ...(language === '' ? {} : { language }),
            ...(status === '' ? {} : { status }),
          },
        },
      });
      return {
        ...(data === undefined
          ? {}
          : {
              data: {
                items: data.items as readonly Reported[],
                next: data.next,
                total: 0,
                facets: null,
              },
            }),
        response,
      };
    },
    [client, space, language, status],
  );
  const listing = usePagedListing<Reported, null>(fetchPage);
  const report = listing.items;
  const filtered = language !== '' || status !== '';

  const show = (event: FormEvent) => {
    event.preventDefault();
    setLanguage(typed.trim());
  };

  return (
    <section aria-labelledby="translations-heading">
      <div className={styles['titleRow']}>
        <h1 id="translations-heading">{words('translation.translations')}</h1>
      </div>
      {spaces !== null && spaces.length > 1 && (
        <label>
          {words('translation.space')}{' '}
          <select value={space ?? ''} onChange={(event) => setSpace(event.target.value)}>
            {spaces.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {space !== null && (
        <form onSubmit={show}>
          <label htmlFor={languageId}>{words('translation.language')}</label>{' '}
          <input id={languageId} value={typed} onChange={(event) => setTyped(event.target.value)} />{' '}
          <label htmlFor={statusId}>{words('translation.status')}</label>{' '}
          <select
            id={statusId}
            value={status}
            onChange={(event) => setStatus(event.target.value as Status | '')}
          >
            <option value="">{words('translation.any-status')}</option>
            {STATUSES.map((each) => (
              <option key={each} value={each}>
                {filterWords(each)}
              </option>
            ))}
          </select>{' '}
          <button type="submit">{words('translation.show')}</button>
        </form>
      )}
      {spaces !== null && spaces.length === 0 && (
        <Empty>
          <p>{words('translation.there-is-no-space-you')}</p>
        </Empty>
      )}
      {space !== null && report === null && listing.failed === undefined && (
        <Waiting>{words('translation.loading')}</Waiting>
      )}
      {spaces === null && !spacesFailed && <Waiting>{words('translation.loading')}</Waiting>}
      {(spacesFailed || (report === null && listing.failed !== undefined)) && (
        <Notice tone="failed">
          <p>{words('translation.the-translations-could-not-be')}</p>
        </Notice>
      )}
      {space !== null && report !== null && report.length === 0 && (
        <Empty>
          <p>
            {filtered
              ? words('translation.no-translation-of-this-space-matches')
              : words('translation.no-component-of-this-space')}
          </p>
        </Empty>
      )}
      {space !== null && report !== null && report.length > 0 && (
        <>
          <table className={styles['table']}>
            <caption>{words('translation.translated-components')}</caption>
            <thead>
              <tr>
                <th scope="col">{words('translation.component')}</th>
                <th scope="col">{words('translation.translations')}</th>
              </tr>
            </thead>
            <tbody>
              {report.map((item) => (
                <tr key={item.component.id}>
                  <th scope="row">
                    <a href={`#/components/${item.component.id}`}>{item.component.title}</a>
                  </th>
                  <td>
                    <TranslationChips translations={said(item)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <More listing={listing} failed={words('translation.more-translations-failed')} />
        </>
      )}
    </section>
  );
}
