import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import styles from './Home.module.css';

type Client = ReturnType<typeof createApiClient>;

type Module = 'components' | 'documents' | 'publications';

/**
 * Each module as its Home card says it: what it is for, and what can be done there today - the
 * drawing's words, less those for what is not built yet (interface slice 11), and naming Word beside
 * the PDF since Word 1, which the drawing, made before it, does not.
 */
const CARDS: readonly {
  readonly module: Module;
  readonly name: string;
  readonly href: string;
  readonly about: string;
  readonly can: readonly string[];
  readonly one: string;
  readonly many: string;
}[] = [
  {
    module: 'components',
    name: 'Components',
    href: '#/components',
    about: 'Write and version the typed pieces documents are assembled from.',
    can: ['Edit text, lists and marks', 'Cut a version on a positive act'],
    one: 'component you may read',
    many: 'components you may read',
  },
  {
    module: 'documents',
    name: 'Documents',
    href: '#/documents',
    about: 'Build an outline of sections and component references, and publish it.',
    can: [
      'Restructure the outline, a version at a time',
      'Publish as a tagged PDF, a Word document or both',
    ],
    one: 'document you may read',
    many: 'documents you may read',
  },
  {
    module: 'publications',
    name: 'Publications',
    href: '#/publications',
    about: 'Read what has been published. Kept exactly as it was made, never changed.',
    can: [
      'Read a publication in the browser',
      'Download the PDF or the Word document',
      'See the version it was made from',
    ],
    one: 'publication you may read',
    many: 'publications you may read',
  },
];

/** How many a list answers, or null where it could not be read: a total is left off, not guessed. */
async function totals(client: Client): Promise<Record<Module, number | null>> {
  const read = async (ask: () => Promise<number | null>) => {
    try {
      return await ask();
    } catch {
      return null;
    }
  };
  const [components, documents, publications] = await Promise.all([
    read(async () => {
      const { data } = await client.GET('/v1/components', { params: { query: { limit: '1' } } });
      return data ? data.total : null;
    }),
    read(async () => {
      const { data } = await client.GET('/v1/documents');
      return data ? data.items.length : null;
    }),
    read(async () => {
      const { data } = await client.GET('/v1/publications');
      return data ? data.items.length : null;
    }),
  ]);
  return { components, documents, publications };
}

/**
 * Home, `#/`: a greeting, then a card for each module, each a link to its list with how many there
 * are there to read. Where you left off waits for a route that can say it.
 */
export function Home({ client }: { client: Client }) {
  const [name, setName] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<Module, number | null> | null>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me')
      .then(({ data }) => {
        if (current && data) setName(data.displayName?.trim().split(/\s+/)[0] || null);
      })
      .catch(() => undefined);
    client
      .GET('/v1/tenant')
      .then(({ data }) => {
        if (current && data) setEnvironment(data.name);
      })
      .catch(() => undefined);
    void totals(client).then((read) => {
      if (current) setCounts(read);
    });
    return () => {
      current = false;
    };
  }, [client]);

  return (
    <div className={styles['backdrop']}>
      <section className={styles['panel']} aria-labelledby="home-heading">
        <h1 id="home-heading" className={styles['greeting']}>
          {name === null ? 'Welcome back' : `Welcome back, ${name}`}
        </h1>
        {environment !== null && <p className={styles['environment']}>{environment}</p>}
        <div className={styles['cards']}>
          {CARDS.map((card) => {
            const count = counts?.[card.module] ?? null;
            return (
              <a
                key={card.module}
                className={styles['card']}
                data-module={card.module}
                href={card.href}
              >
                <span className={styles['name']}>{card.name}</span>
                <span className={styles['about']}>{card.about}</span>
                <ul className={styles['can']}>
                  {card.can.map((each) => (
                    <li key={each}>{each}</li>
                  ))}
                </ul>
                <span className={styles['total']}>
                  {count !== null && (
                    <>
                      <span className={styles['number']}>{count}</span>{' '}
                      <span className={styles['unit']}>{count === 1 ? card.one : card.many}</span>
                    </>
                  )}
                </span>
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
