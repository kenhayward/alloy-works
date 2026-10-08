import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { renderContent } from '@alloy-works/editor';
import { useEffect, useState } from 'react';

import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { Icon } from './Icon.js';
import styles from './ComponentDetail.module.css';

type Client = ReturnType<typeof createApiClient>;
type Item = Page['items'][number];

interface Version {
  readonly number: string;
  readonly createdAt: string;
  readonly author: string | null;
  readonly note: string | null;
}

/** As many words of the text as the panel shows before it stops. */
const EXCERPT = 280;

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** The component's text as words, block by block, cut short where it runs long; null if unreadable. */
function excerptOf(content: unknown): string | null {
  const rendered = renderContent(content, document);
  if (rendered === null) return null;
  const words = [...rendered.childNodes]
    .map((block) => block.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((text) => text !== '')
    .join(' ');
  return words.length > EXCERPT ? `${words.slice(0, EXCERPT).trimEnd()}...` : words;
}

/**
 * The chosen component beside the list (the Ledger's components screen, ADR-0046): its facts as chips,
 * Open and Give access, the start of its text and its latest versions. Where it is used waits for a
 * route that can say (the LG plan, LG-H).
 */
export function ComponentDetail({
  client,
  item,
  onClose,
}: {
  client: Client;
  item: Item;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [versions, setVersions] = useState<readonly Version[] | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setText(undefined);
    setVersions(undefined);
    client
      .GET('/v1/components/{id}', { params: { path: { id: item.id } } })
      .then(({ data }) => {
        if (current) setText(data ? excerptOf(data.content) : null);
      })
      .catch(() => current && setText(null));
    client
      .GET('/v1/components/{id}/versions', {
        params: { path: { id: item.id }, query: { limit: '3' } },
      })
      .then(({ data }) => {
        if (!current) return;
        setVersions(
          data
            ? data.items.map((each) => ({
                number: each.number,
                createdAt: each.createdAt,
                author: each.author?.name ?? null,
                note: each.note,
              }))
            : null,
        );
      })
      .catch(() => current && setVersions(null));
    return () => {
      current = false;
    };
  }, [client, item.id]);

  const heading = `component-detail-${item.id}`;
  return (
    <aside className={styles['panel']} aria-labelledby={heading}>
      <div className={styles['head']}>
        <h2 id={heading} className={styles['title']}>
          {item.title}
        </h2>
        <IconButton label="Close" onClick={onClose}>
          <Icon name="Close" size={13} />
        </IconButton>
      </div>
      <div className={styles['chips']}>
        {item.type !== null && item.type !== undefined && <Chip>{item.type}</Chip>}
        <Chip className={styles['mono']}>{item.version}</Chip>
        <Chip>{item.space.name}</Chip>
        <Chip>{item.language}</Chip>
      </div>
      <div className={styles['acts']}>
        <a className={styles['open']} href={`#/components/${item.id}`}>
          Open
        </a>
        <a className={styles['access']} href={`#/components/${item.id}/access`}>
          Give access
        </a>
      </div>
      <section className={styles['section']} aria-labelledby={`${heading}-text`}>
        <h3 id={`${heading}-text`} className={styles['label']}>
          Text
        </h3>
        {text === null ? (
          <p className={styles['muted']}>The text could not be read.</p>
        ) : (
          text !== undefined && <p className={styles['text']}>{text}</p>
        )}
      </section>
      <section className={styles['section']} aria-labelledby={`${heading}-versions`}>
        <h3 id={`${heading}-versions`} className={styles['label']}>
          Versions
        </h3>
        {versions === null && <p className={styles['muted']}>The versions could not be read.</p>}
        {versions !== null && versions !== undefined && (
          <ul className={styles['versions']} aria-label="Versions">
            {versions.map((version) => (
              <li key={version.number} className={styles['version']}>
                <span className={styles['number']}>{version.number}</span>
                <span className={styles['who']}>
                  {`${version.author ?? 'Unknown'}, ${day.format(new Date(version.createdAt))}`}
                  {version.note !== null && <span className={styles['note']}>{version.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
