import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { connectionLink } from '../data/links.js';
import { failureWords } from '../publishing/failures.js';
import { ModuleIcon } from '../shell/ModuleIcon.js';
import { MODULE_GROUPS, type Module } from '../shell/modules.js';
import { publishingLink } from '../structure/links.js';
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

/** One thing waiting on the reader, as `GET /v1/me/attention` answers it. */
interface Waiting {
  readonly kind:
    'publish_failed' | 'changes_not_in_version' | 'published_earlier' | 'connection_untested';
  readonly artifact: {
    readonly id: string;
    readonly kind: 'document' | 'component' | 'connection';
    readonly title: string | null;
  };
  readonly reason?: string;
}

type Attending =
  | { readonly state: 'reading' }
  | { readonly state: 'unread' }
  | { readonly state: 'read'; readonly items: readonly Waiting[]; readonly total: number };

const UNTITLED = { document: 'A document', component: 'A component', connection: 'A connection' };

/**
 * What each kind says and where its one link goes (home.md, Needs your attention): a failed publish's
 * reason in the words the Publishing panel says it in.
 */
function wordsFor(item: Waiting) {
  const title = item.artifact.title ?? UNTITLED[item.artifact.kind];
  const { id } = item.artifact;
  switch (item.kind) {
    case 'publish_failed':
      return {
        headline: `${title} cannot publish`,
        detail:
          item.reason === undefined
            ? 'Its latest publish failed. Publish again.'
            : failureWords({ stage: '', code: item.reason, node: null, block: null, detail: null }),
        action: 'Open publishing',
        href: publishingLink(id),
      };
    case 'changes_not_in_version':
      return {
        headline: `${title} holds changes of yours not in a version`,
        detail: 'Open it to recover them, or to discard them.',
        action: 'Open',
        href: `#/components/${id}`,
      };
    case 'published_earlier':
      return {
        headline: `${title} was published from an earlier version`,
        detail: 'Its latest publication is of an older version than the document is now.',
        action: 'Open publishing',
        href: publishingLink(id),
      };
    case 'connection_untested':
      return {
        headline: `${title} has not been tested since its credential was set`,
        detail: 'Test it with the credential it has now.',
        action: 'Open',
        href: connectionLink(id),
      };
  }
}

/** Each kind's mark, on a 16px grid: a warning, changes held, an earlier version, a connection. */
const MARKS: Readonly<Record<Waiting['kind'], readonly string[]>> = {
  publish_failed: ['M8 2.5 1.8 13.5h12.4z', 'M8 6.5v3.2', 'M8 11.6v.2'],
  changes_not_in_version: ['M8 6.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 1 0 0-2.8z'],
  published_earlier: ['M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2z', 'M8 4.8V8l2.2 1.4'],
  connection_untested: ['M6 2v3.5M10 2v3.5', 'M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z', 'M8 11.5V14'],
};

/** One item: its mark, what waits and why, and its one link, described by both. */
function WaitingItem({ item }: { item: Waiting }) {
  const id = useId();
  const words = wordsFor(item);
  return (
    <li className={styles['attentionItem']}>
      <span className={styles['attentionMark']} data-kind={item.kind}>
        <svg
          aria-hidden="true"
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MARKS[item.kind].map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
      <span className={styles['attentionWords']}>
        <strong id={`${id}headline`} className={styles['attentionHeadline']}>
          {words.headline}
        </strong>
        <span id={`${id}detail`} className={styles['attentionDetail']}>
          {words.detail}
        </span>
      </span>
      <a
        className={styles['attentionAction']}
        href={words.href}
        aria-describedby={`${id}headline ${id}detail`}
      >
        {words.action}
      </a>
    </li>
  );
}

/**
 * Needs your attention (home.md; the HM plan, HM-G): what waits on the reader that they may resolve,
 * each with its reason and one link. None, it says so; unread, it says that, and the rest of Home
 * stands.
 */
function Attention({ client }: { client: Client }) {
  const [attending, setAttending] = useState<Attending>({ state: 'reading' });
  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me/attention')
      .then(({ data }) => {
        if (!current) return;
        setAttending(
          data ? { state: 'read', items: data.items, total: data.total } : { state: 'unread' },
        );
      })
      .catch(() => {
        if (current) setAttending({ state: 'unread' });
      });
    return () => {
      current = false;
    };
  }, [client]);

  const more = attending.state === 'read' ? attending.total - attending.items.length : 0;
  return (
    <section className={styles['attention']} aria-labelledby="home-attention">
      <div className={styles['attentionHead']}>
        <h2 id="home-attention" className={styles['attentionHeading']}>
          Needs your attention
        </h2>
        {attending.state === 'read' && attending.total > 0 && (
          <span className={styles['attentionCount']}>
            {attending.total === 1 ? '1 item' : `${attending.total} items`}
          </span>
        )}
      </div>
      {attending.state === 'unread' && (
        <p className={styles['attentionSaid']}>What needs your attention could not be read.</p>
      )}
      {attending.state === 'read' && attending.items.length === 0 && (
        <p className={styles['attentionSaid']}>Nothing needs your attention.</p>
      )}
      {attending.state === 'read' && attending.items.length > 0 && (
        <ul className={styles['attentionItems']}>
          {attending.items.map((item) => (
            <WaitingItem key={item.artifact.id} item={item} />
          ))}
        </ul>
      )}
      {more > 0 && <p className={styles['attentionMore']}>{more} more</p>}
    </section>
  );
}

/**
 * Home, `#/`: a greeting, then what needs the reader's attention beside every module in its group -
 * Author, Publish, Data - each a link with what it is for and, where its list says, how many there are
 * to read (ADR-0046). Where you left off waits for its requirement (SCH-069).
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
      <div className={styles['columns']}>
        <Attention client={client} />
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
    </div>
  );
}
