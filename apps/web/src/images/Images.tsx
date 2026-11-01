import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { isRecord } from '../data/shapes.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import list from '../structure/DocumentList.module.css';
import { baselineLink, documentLink } from '../structure/links.js';
import { words, type WordKey } from '../words/words.js';
import styles from './Images.module.css';
import { thumbnailPath, type LibraryImage } from './library.js';

type Client = ReturnType<typeof createApiClient>;

interface Space {
  readonly id: string;
  readonly name: string;
}

interface Filters {
  readonly q: string;
  readonly format: '' | 'png' | 'jpeg';
  readonly rights: '' | 'undeclared' | 'expired';
  readonly orientation: '' | 'landscape' | 'portrait' | 'square';
  readonly licence: string;
  readonly unused: boolean;
}

const NO_FILTERS: Filters = {
  q: '',
  format: '',
  rights: '',
  orientation: '',
  licence: '',
  unused: false,
};

interface Named {
  readonly id: string;
  readonly title?: string;
  readonly name?: string;
  readonly document?: string;
}

interface Uses {
  readonly components: { readonly named: readonly Named[]; readonly unreadable: boolean };
  readonly documents: { readonly named: readonly Named[]; readonly unreadable: boolean };
  readonly baselines: { readonly named: readonly Named[]; readonly unreadable: boolean };
  readonly publications: { readonly named: readonly Named[]; readonly unreadable: boolean };
}

/** The query a set of filters asks: only what is set, so an unfiltered page asks for nothing. */
function queryOf(filters: Filters, cursor: string | undefined) {
  return {
    ...(filters.q.trim() === '' ? {} : { q: filters.q.trim() }),
    ...(filters.format === '' ? {} : { format: filters.format }),
    ...(filters.rights === '' ? {} : { rights: filters.rights }),
    ...(filters.orientation === '' ? {} : { orientation: filters.orientation }),
    ...(filters.licence === '' ? {} : { licence: filters.licence }),
    ...(filters.unused ? { unused: 'true' as const } : {}),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/**
 * **The Images page** (AST-028; the AL plan, AL-J): a space's images as thumbnails (AST-009), searched
 * and filtered by format, rights, orientation, licence and whether anything uses them (AST-050), and
 * where each is used (AST-018).
 */
export function Images({ client }: { readonly client: Client }) {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [licences, setLicences] = useState<readonly { id: string; name: string }[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [typed, setTyped] = useState('');
  const [images, setImages] = useState<readonly LibraryImage[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [showing, setShowing] = useState<LibraryImage | null>(null);

  useEffect(() => {
    let live = true;
    void everyPage<unknown>(async (cursor) =>
      client.GET('/v1/spaces', { params: { query: cursor === undefined ? {} : { cursor } } }),
    ).then((answer) => {
      if (!live) return;
      if (!('items' in answer)) {
        setFailed(true);
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
    void client.GET('/v1/licences').then(
      ({ data }) =>
        live &&
        setLicences((data?.items ?? []).map((each) => ({ id: each.id, name: each.licence.name }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client]);

  const load = useCallback(
    async (cursor?: string) => {
      if (space === null) return;
      const { data } = await client.GET('/v1/spaces/{space}/assets', {
        params: { path: { space }, query: queryOf(filters, cursor) },
      });
      if (!data) {
        setFailed(true);
        return;
      }
      setFailed(false);
      const page = data.items as readonly LibraryImage[];
      setImages((held) => (cursor === undefined || held === null ? page : [...held, ...page]));
      setNext(data.next);
      setTotal(data.total);
    },
    [client, space, filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const choose = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((held) => ({ ...held, [key]: value }));

  const search = (event: FormEvent) => {
    event.preventDefault();
    choose('q', typed);
  };

  if (spaces === null && !failed) return null;

  return (
    <section aria-labelledby="images-heading">
      <div className={list['titleRow']}>
        <h1 id="images-heading">{words('images.images')}</h1>
      </div>
      {spaces !== null && spaces.length > 1 && (
        <label>
          {words('images.space')}{' '}
          <select
            value={space ?? ''}
            onChange={(event) => {
              setSpace(event.target.value);
              setShowing(null);
            }}
          >
            {spaces.map((each) => (
              <option key={each.id} value={each.id} data-content>
                {each.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={styles['filters']}>
        <form role="search" className={styles['search']} onSubmit={search}>
          <label>
            {words('images.search-images')}
            <input type="search" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </label>
          <button type="submit">{words('images.search')}</button>
        </form>
        <label>
          {words('images.format')}
          <select
            value={filters.format}
            onChange={(event) => choose('format', event.target.value as Filters['format'])}
          >
            <option value="">{words('images.any')}</option>
            <option value="png">{words('images.png')}</option>
            <option value="jpeg">{words('images.jpeg')}</option>
          </select>
        </label>
        <label>
          {words('images.rights')}
          <select
            value={filters.rights}
            onChange={(event) => choose('rights', event.target.value as Filters['rights'])}
          >
            <option value="">{words('images.any')}</option>
            <option value="undeclared">{words('images.not-declared')}</option>
            <option value="expired">{words('images.licence-expired')}</option>
          </select>
        </label>
        <label>
          {words('images.orientation')}
          <select
            value={filters.orientation}
            onChange={(event) =>
              choose('orientation', event.target.value as Filters['orientation'])
            }
          >
            <option value="">{words('images.any')}</option>
            <option value="landscape">{words('images.landscape')}</option>
            <option value="portrait">{words('images.portrait')}</option>
            <option value="square">{words('images.square')}</option>
          </select>
        </label>
        <label>
          {words('images.licence')}
          <select value={filters.licence} onChange={(event) => choose('licence', event.target.value)}>
            <option value="">{words('images.any')}</option>
            {licences.map((each) => (
              <option key={each.id} value={each.id} data-content>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['inline']}>
          <input
            type="checkbox"
            checked={filters.unused}
            onChange={(event) => choose('unused', event.target.checked)}
          />
          {words('images.only-unused')}
        </label>
      </div>
      {failed ? (
        <Notice tone="failed">
          <p>{words('images.the-images-could-not-be')}</p>
        </Notice>
      ) : images === null ? null : images.length === 0 ? (
        <Empty>
          <p>{words('images.no-images-here-match')}</p>
        </Empty>
      ) : (
        <>
          <p className={list['summary']}>
            <span>{words('images.you-may-read', { total })}</span>
            {images.length < total && (
              <span>{words('images.showing-1-to', { length: images.length })}</span>
            )}
          </p>
          <ul className={styles['grid']} aria-label={words('images.images')}>
            {images.map((each) => (
              <li key={each.id} className={styles['card']}>
                <span className={styles['thumbnail']}>
                  {/* The description is the image's own, so it is content; none leaves it to the
                      name beside it. */}
                  <img
                    src={thumbnailPath(each.version.id)}
                    alt={each.alternative?.text ?? ''}
                    loading="lazy"
                    data-content
                  />
                </span>
                <span className={styles['name']} data-content>
                  {each.name ?? words('images.unnamed-image')}
                </span>
                <span className={styles['detail']}>
                  {words('images.size', {
                    format: words(each.format === 'png' ? 'images.png' : 'images.jpeg'),
                    width: each.width,
                    height: each.height,
                  })}
                </span>
                {each.licence !== null ? (
                  <span className={styles['detail']} data-content>
                    {each.licence.name}
                  </span>
                ) : (
                  <span className={styles['detail']}>{words('images.not-declared')}</span>
                )}
                {each.expired && (
                  <span className={styles['flag']}>{words('images.licence-expired')}</span>
                )}
                {!each.used && <span className={styles['detail']}>{words('images.unused')}</span>}
                <button type="button" onClick={() => setShowing(each)}>
                  {words('images.where-used')}
                </button>
              </li>
            ))}
          </ul>
          {next !== null && (
            <button type="button" onClick={() => void load(next)}>
              {words('images.show-more')}
            </button>
          )}
        </>
      )}
      {showing !== null && <WhereUsed client={client} image={showing} />}
    </section>
  );
}

const KINDS = ['components', 'documents', 'baselines', 'publications'] as const;

const linkOf = (kind: (typeof KINDS)[number], each: Named): string =>
  kind === 'components'
    ? `#/components/${each.id}`
    : kind === 'documents'
      ? documentLink(each.id)
      : kind === 'baselines'
        ? baselineLink(each.document ?? '', each.id)
        : `#/publications/${each.id}`;

/**
 * **Where an image is used** (AST-018; the AL plan, AL-K): what the reader may read, named; what they
 * may not, only said to be there.
 */
function WhereUsed({ client, image }: { readonly client: Client; readonly image: LibraryImage }) {
  const id = useId();
  const [uses, setUses] = useState<Uses | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setUses(null);
    setFailed(false);
    void client
      .GET('/v1/assets/{id}/uses', { params: { path: { id: image.id } } })
      .then(({ data }) => {
        if (!live) return;
        if (data) setUses(data);
        else setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [client, image.id]);

  return (
    <section className={styles['uses']} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        {words('images.where-is-used', { name: image.name ?? words('images.unnamed-image') })}
      </h2>
      {failed && (
        <Notice tone="failed">
          <p>{words('images.where-it-is-used-could')}</p>
        </Notice>
      )}
      {uses !== null &&
        KINDS.map((kind) => {
          const { named, unreadable } = uses[kind];
          return (
            <div key={kind}>
              <h3>{words(`images.${kind}` as WordKey)}</h3>
              {named.length === 0 && !unreadable ? (
                <p>{words(`images.no-${kind}` as WordKey)}</p>
              ) : (
                <>
                  {named.length > 0 && (
                    <ul>
                      {named.map((each) => (
                        <li key={each.id}>
                          <a href={linkOf(kind, each)} data-content>
                            {each.title ?? each.name ?? each.id}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {unreadable && <p>{words(`images.unreadable-${kind}` as WordKey)}</p>}
                </>
              )}
            </div>
          );
        })}
    </section>
  );
}
