import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { isRecord } from '../data/shapes.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from '../structure/DocumentList.module.css';
import { statusWords } from './Translations.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** Where the space translation report is (the TR plan, TR-M). */
export const TRANSLATIONS = '#/translations';

interface Space {
  readonly id: string;
  readonly name: string;
}

interface Reported {
  readonly items: readonly {
    readonly component: { readonly id: string; readonly title: string };
    readonly translations: readonly {
      readonly language: string;
      readonly status: { readonly status: string; readonly retranslate?: boolean };
    }[];
  }[];
  readonly capped: boolean;
}

/**
 * **Translations** (LOC-016; the TR plan, TR-M): each component of a space that has a translation,
 * by its title, with each language's status, out of date ones first said so; what the reader may read
 * alone, at most 500, and said when there are more.
 */
export function SpaceTranslations({ client }: { readonly client: Client }) {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [report, setReport] = useState<Reported | 'failed' | null>(null);

  useEffect(() => {
    let live = true;
    void everyPage<unknown>(async (cursor) =>
      client.GET('/v1/spaces', { params: { query: cursor === undefined ? {} : { cursor } } }),
    ).then((answer) => {
      if (!live) return;
      if (!('items' in answer)) {
        setReport('failed');
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

  useEffect(() => {
    if (space === null) return undefined;
    let live = true;
    setReport(null);
    void client
      .GET('/v1/spaces/{space}/translations', { params: { path: { space } } })
      .then(({ data }) => {
        if (live) setReport(data ? (data as Reported) : 'failed');
      })
      .catch(() => live && setReport('failed'));
    return () => {
      live = false;
    };
  }, [client, space]);

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
      {spaces !== null && spaces.length === 0 && (
        <Empty>
          <p>{words('translation.there-is-no-space-you')}</p>
        </Empty>
      )}
      {report === null && (spaces === null || space !== null) && (
        <Waiting>{words('translation.loading')}</Waiting>
      )}
      {report === 'failed' && (
        <Notice tone="failed">
          <p>{words('translation.the-translations-could-not-be')}</p>
        </Notice>
      )}
      {report !== null && report !== 'failed' && report.items.length === 0 && (
        <Empty>
          <p>{words('translation.no-component-of-this-space')}</p>
        </Empty>
      )}
      {report !== null && report !== 'failed' && report.items.length > 0 && (
        <table className={styles['table']}>
          <caption>
            {words('translation.translated-components', { capped: report.capped ? 'yes' : 'no' })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{words('translation.component')}</th>
              <th scope="col">{words('translation.translations')}</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={item.component.id}>
                <th scope="row">
                  <a href={`#/components/${item.component.id}`}>{item.component.title}</a>
                </th>
                <td>
                  {item.translations
                    .map((each) => `${each.language}: ${statusWords(each.status)}`)
                    .join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
