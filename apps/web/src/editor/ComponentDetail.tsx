import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { renderContent } from '@alloy-works/editor';
import { useEffect, useState } from 'react';

import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { Icon } from './Icon.js';
import styles from './ComponentDetail.module.css';
import { VersionList } from './VersionList.js';

type Client = ReturnType<typeof createApiClient>;
type Item = Page['items'][number];

/** As many words of the text as the panel shows before it stops. */
const EXCERPT = 280;

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

  useEffect(() => {
    let current = true;
    setText(undefined);
    client
      .GET('/v1/components/{id}', { params: { path: { id: item.id } } })
      .then(({ data }) => {
        if (current) setText(data ? excerptOf(data.content) : null);
      })
      .catch(() => current && setText(null));
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
        <VersionList client={client} id={item.id} limit={3} />
      </section>
    </aside>
  );
}
