import type { createApiClient } from '@alloy-works/api-client';
import { BLOCK_ATTRIBUTE, renderContent, TEXT_CLASS } from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Chip } from '../parts/Chip.js';
import { documentLink, nodeLink } from '../structure/links.js';
import styles from './VersionPages.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Heading {
  readonly id: string;
  readonly number: string;
  readonly createdAt: string;
  readonly author: { readonly id: string; readonly name: string | null } | null;
}

type Read<T> = T | 'missing' | 'deleted' | 'failed' | null;

/** "An earlier version, 1.3, by Ada on 2 October 2026. The latest is 1.7." */
function versionSentence(version: Heading, latest: { readonly number: string }): string {
  const when = new Date(version.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const by =
    version.author === null
      ? ''
      : words('versions.by', { value1: version.author.name ?? 'somebody' });
  return words('versions.an-earlier-version-on-the', {
    number: version.number,
    by,
    when,
    number4: latest.number,
  });
}

/** One version read once, and what its answer says when it is not one. */
function useVersion<T>(read: () => Promise<{ data?: T; response: Response }>, key: string) {
  const [shown, setShown] = useState<Read<T>>(null);
  useEffect(() => {
    let current = true;
    setShown(null);
    read()
      .then(({ data, response }) => {
        if (!current) return;
        if (response.status === 404) setShown('missing');
        else if (response.status === 410) setShown('deleted');
        else setShown(data ?? 'failed');
      })
      .catch(() => current && setShown('failed'));
    return () => {
      current = false;
    };
    // `read` is made afresh each render; the version it reads is `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shown;
}

function Unread({ shown, kind }: { shown: 'missing' | 'deleted' | 'failed' | null; kind: string }) {
  const said =
    shown === null
      ? words('versions.opening')
      : shown === 'missing'
        ? words('versions.there-is-no-such-version')
        : shown === 'deleted'
          ? words('versions.this-has-been-deleted', { kind })
          : words('versions.the-version-could-not-be');
  return <p className={styles['versionNote']}>{said}</p>;
}

function Head({
  title,
  version,
  latest,
  archived,
  latestLink,
}: {
  title: string;
  version: Heading;
  latest: { readonly number: string };
  archived: boolean;
  latestLink: string;
}): ReactNode {
  return (
    <header className={styles['versionHead']}>
      <p>
        <a href={latestLink}>{words('versions.open-the-latest')}</a>
      </p>
      <h1 id="version-heading" className={styles['versionTitle']}>
        {title}
      </h1>
      <div className={styles['versionFacts']}>
        <Chip tone="info">{words('versions.version', { number: version.number })}</Chip>
        {archived && <Chip tone="warn">{words('versions.archived')}</Chip>}
      </div>
      <p className={styles['versionNote']}>{versionSentence(version, latest)}</p>
    </header>
  );
}

/**
 * One earlier version of a component, read only (the SV plan, SV-H; SCH-058), at
 * `#/components/{id}/versions/{version}` and at a block in it: where a search result from that
 * version opens. The latest version's address opens the live page instead.
 */
export function ComponentVersionPage({
  client,
  component,
  version,
  block,
}: {
  client: Client;
  component: string;
  version: string;
  block: string | null;
}) {
  const shown = useVersion(
    () =>
      client.GET('/v1/components/{id}/versions/{version}', {
        params: { path: { id: component, version } },
      }),
    `${component}:${version}`,
  );
  const text = useRef<HTMLDivElement>(null);
  const read = typeof shown === 'object' && shown !== null ? shown : null;
  const isLatest = read !== null && read.version.id === read.latest.id;

  useEffect(() => {
    if (!isLatest) return;
    window.location.hash = `#/components/${component}${
      block === null ? '' : `/blocks/${encodeURIComponent(block)}`
    }`;
  }, [isLatest, component, block]);

  useEffect(() => {
    const host = text.current;
    if (!host || read === null || isLatest) return;
    const rendered = renderContent(read.content, window.document);
    if (rendered === null) {
      host.replaceChildren(
        window.document.createTextNode(words('versions.this-version-cannot-be-shown')),
      );
      return;
    }
    host.replaceChildren(rendered);
    if (block === null) return;
    const at = [...host.querySelectorAll<HTMLElement>(`[${BLOCK_ATTRIBUTE}]`)].find(
      (each) => each.getAttribute(BLOCK_ATTRIBUTE) === block,
    );
    at?.setAttribute('data-marked', 'true');
    at?.scrollIntoView?.({ block: 'center' });
  }, [read, isLatest, block]);

  if (read === null || isLatest) {
    return (
      <Unread
        shown={read === null ? (shown as Exclude<typeof shown, object>) : null}
        kind="component"
      />
    );
  }
  return (
    <article className={styles['versionPage']} aria-labelledby="version-heading">
      <Head
        title={read.title}
        version={read.version}
        latest={read.latest}
        archived={read.archived}
        latestLink={`#/components/${component}`}
      />
      <div ref={text} className={`${TEXT_CLASS} ${styles['versionText']}`} />
    </article>
  );
}

interface OutlineNodeShown {
  readonly id: string;
  readonly type: string;
  readonly title?: readonly { readonly type: string; readonly value?: string }[];
  readonly component?: string | null;
  readonly children?: readonly OutlineNodeShown[];
}

/** A section's title as words. */
const titleWords = (title: OutlineNodeShown['title']) =>
  (title ?? []).map((each) => (each.type === 'text' ? (each.value ?? '') : '')).join('');

/**
 * One earlier version of a document, read only (SV-H): its outline at that version, each section by
 * its title and each component by the title of the version it places, one the reader may not read
 * withheld. Its components' text is not shown: a document matches only its own words.
 */
export function DocumentVersionPage({
  client,
  document,
  version,
  node,
}: {
  client: Client;
  document: string;
  version: string;
  node: string | null;
}) {
  const shown = useVersion(
    () =>
      client.GET('/v1/documents/{id}/versions/{version}', {
        params: { path: { id: document, version } },
      }),
    `${document}:${version}`,
  );
  const read = typeof shown === 'object' && shown !== null ? shown : null;
  const isLatest = read !== null && read.version.id === read.latest.id;

  useEffect(() => {
    if (isLatest)
      window.location.hash = node === null ? documentLink(document) : nodeLink(document, node);
  }, [isLatest, document, node]);

  useEffect(() => {
    if (node === null || read === null) return;
    window.document.querySelector(`[data-node="${node}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [node, read]);

  if (read === null || isLatest) {
    return (
      <Unread
        shown={read === null ? (shown as Exclude<typeof shown, object>) : null}
        kind="document"
      />
    );
  }
  const titles = new Map(read.titles.map((each) => [each.node, each.title]));
  const nodes = ((read.outline as { nodes?: unknown }).nodes ?? []) as readonly OutlineNodeShown[];
  const list = (each: readonly OutlineNodeShown[]): ReactNode =>
    each.length === 0 ? null : (
      <ul className={styles['versionOutline']}>
        {each.map((item) => (
          <li
            key={item.id}
            data-node={item.id}
            {...(item.id === node ? { 'data-marked': 'true' } : {})}
          >
            <span className={item.type === 'reference' ? styles['versionReference'] : undefined}>
              {item.type === 'reference'
                ? item.component === null
                  ? words('versions.a-component-you-cannot-open')
                  : (titles.get(item.id) ?? words('versions.a-component'))
                : titleWords(item.title)}
            </span>
            {list(item.children ?? [])}
          </li>
        ))}
      </ul>
    );
  return (
    <article className={styles['versionPage']} aria-labelledby="version-heading">
      <Head
        title={read.title}
        version={read.version}
        latest={read.latest}
        archived={read.archived}
        latestLink={documentLink(document)}
      />
      {list(nodes)}
    </article>
  );
}
