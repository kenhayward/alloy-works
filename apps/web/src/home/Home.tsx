import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { ModuleIcon } from '../shell/ModuleIcon.js';
import { MODULE_GROUPS, type Module } from '../shell/modules.js';
import styles from './Home.module.css';

type Client = ReturnType<typeof createApiClient>;

/** The modules whose list says how many there are, and how a total is said of each. */
const COUNTED = {
  Components: { one: 'component you may read', many: 'components you may read' },
  Documents: { one: 'document you may read', many: 'documents you may read' },
  Publications: { one: 'publication you may read', many: 'publications you may read' },
} as const satisfies Partial<Record<Module['name'], { one: string; many: string }>>;

type Counted = keyof typeof COUNTED;

const isCounted = (name: Module['name']): name is Counted => name in COUNTED;

/** How many a list answers, or null where it could not be read: a total is left off, not guessed. */
async function totals(client: Client): Promise<Record<Counted, number | null>> {
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
      const { data } = await client.GET('/v1/documents', { params: { query: { limit: '1' } } });
      return data ? data.total : null;
    }),
    read(async () => {
      const { data } = await client.GET('/v1/publications', { params: { query: { limit: '1' } } });
      return data ? data.total : null;
    }),
  ]);
  return { Components: components, Documents: documents, Publications: publications };
}

/**
 * Home, `#/`: a greeting, then every module in its group - Author, Publish, Data - each a link with
 * what it is for and, where its list says, how many there are to read (ADR-0046). Needs your attention
 * and Where you left off wait for their requirements (SCH-068, SCH-069).
 */
export function Home({ client }: { client: Client }) {
  const [name, setName] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<Counted, number | null> | null>(null);

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
    <div className={styles['home']}>
      <h1 id="home-heading" className={styles['greeting']}>
        {name === null ? 'Welcome back' : `Welcome back, ${name}`}
      </h1>
      {environment !== null && <p className={styles['environment']}>{environment}</p>}
      <div className={styles['groups']}>
        {MODULE_GROUPS.map(({ group, modules }) => (
          <section key={group} className={styles['group']} aria-labelledby={`home-${group}`}>
            <h2 id={`home-${group}`} className={styles['groupName']}>
              {group}
            </h2>
            <ul className={styles['modules']}>
              {modules.map((each) => {
                const count = isCounted(each.name) ? (counts?.[each.name] ?? null) : null;
                const said = isCounted(each.name) ? COUNTED[each.name] : null;
                return (
                  <li key={each.name}>
                    <a className={styles['module']} href={each.href}>
                      <span className={styles['icon']}>
                        <ModuleIcon name={each.name} />
                      </span>
                      <span className={styles['words']}>
                        <span className={styles['name']}>{each.name}</span>
                        <span className={styles['about']}>{each.about}</span>
                      </span>
                      {count !== null && said !== null && (
                        <span className={styles['total']}>
                          <span className={styles['number']}>{count}</span>{' '}
                          <span className={styles['unit']}>
                            {count === 1 ? said.one : said.many}
                          </span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
