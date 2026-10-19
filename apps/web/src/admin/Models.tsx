import type { createApiClient } from '@alloy-works/api-client';
import { useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Chip } from '../parts/Chip.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

/** A model endpoint as Models lists it (GEN-027; the G1 plan, G1-K). */
interface Endpoint {
  readonly id: string;
  readonly name: string;
  readonly protocol: 'anthropic' | 'openai';
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly priceIn: number;
  readonly priceOut: number;
  /** What a token read from the provider's cache costs; absent, the price in (G6-E). */
  readonly priceCached?: number;
  readonly currency: string;
  readonly boundary: 'inside' | 'outside';
  readonly retiredAt: string | null;
  readonly key: { readonly set: false } | { readonly set: true; readonly needsSetting: boolean };
}

interface Route {
  readonly purpose: 'drafting' | 'chat' | 'summarising' | 'embedding';
  readonly endpoint: string | null;
}

const PROTOCOLS: Readonly<Record<Endpoint['protocol'], string>> = {
  anthropic: 'Anthropic Messages',
  openai: 'OpenAI chat completions',
};

const PURPOSES: Readonly<Record<Route['purpose'], string>> = {
  drafting: 'Drafting',
  chat: 'Chat',
  summarising: 'Summarising',
  embedding: 'Embedding',
};

/** Whether calls can go to an endpoint: in use, with a key set for where it points. */
const usable = (endpoint: Endpoint) =>
  endpoint.retiredAt === null && endpoint.key.set && !endpoint.key.needsSetting;

const keyWords = (endpoint: Endpoint) =>
  !endpoint.key.set ? 'Not set' : endpoint.key.needsSetting ? 'Set it again' : 'Set';

/** The settings a person types, as text, before they are numbers. */
interface Draft {
  name: string;
  protocol: Endpoint['protocol'];
  baseUrl: string;
  model: string;
  contextWindow: string;
  priceIn: string;
  priceOut: string;
  priceCached: string;
  currency: string;
  boundary: Endpoint['boundary'] | '';
}

const BLANK: Draft = {
  name: '',
  protocol: 'anthropic',
  baseUrl: '',
  model: '',
  contextWindow: '200000',
  priceIn: '0',
  priceOut: '0',
  priceCached: '',
  currency: 'USD',
  boundary: '',
};

const draftOf = (endpoint: Endpoint): Draft => ({
  name: endpoint.name,
  protocol: endpoint.protocol,
  baseUrl: endpoint.baseUrl,
  model: endpoint.model,
  contextWindow: String(endpoint.contextWindow),
  priceIn: String(endpoint.priceIn),
  priceOut: String(endpoint.priceOut),
  priceCached: endpoint.priceCached === undefined ? '' : String(endpoint.priceCached),
  currency: endpoint.currency,
  boundary: endpoint.boundary,
});

/**
 * Administration's Models (generation.md, "Endpoints"; the G1 plan, G1-K): the model endpoints the
 * environment calls on its own provider accounts, each saying whether it sits outside the data
 * boundary and whether its key is set, never the key; **Add**, **Edit**, **Set key**, **Test** and
 * **Retire**; and which endpoint each purpose goes to.
 */
export function Models({ client }: { client: Client }) {
  const [generation, setGeneration] = useState(0);
  // The routes are read with the endpoints, whose names they show.
  const [routes, setRoutes] = useState<readonly Route[]>([]);
  const [load] = useState(() => async () => {
    const [endpoints, routed] = await Promise.all([
      client.GET('/v1/model-endpoints'),
      client.GET('/v1/model-routes'),
    ]);
    if (!endpoints.data) return { status: endpoints.response.status };
    if (!routed.data) return { status: routed.response.status };
    setRoutes(routed.data.items as Route[]);
    return { items: endpoints.data.items as Endpoint[] };
  });
  const read = useListing<Endpoint>(load, true, generation);
  const [said, setSaid] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [keying, setKeying] = useState<Endpoint | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const again = () => setGeneration((was) => was + 1);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const { draft, id } = editing;
    if (draft.boundary === '') {
      setSaid('Say whether this endpoint sits outside your data boundary.');
      return;
    }
    const body = {
      name: draft.name.trim(),
      protocol: draft.protocol,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      contextWindow: Number(draft.contextWindow),
      priceIn: Number(draft.priceIn),
      priceOut: Number(draft.priceOut),
      ...(draft.priceCached.trim() === '' ? {} : { priceCached: Number(draft.priceCached) }),
      currency: draft.currency.trim().toUpperCase(),
      boundary: draft.boundary,
    };
    setBusy(true);
    try {
      const { data, error } =
        id === null
          ? await client.POST('/v1/model-endpoints', { body })
          : await client.PUT('/v1/model-endpoints/{id}', { params: { path: { id } }, body });
      if (data) {
        setSaid(id === null ? `${body.name} added. Set its key to use it.` : `${body.name} saved.`);
        setEditing(null);
        again();
      } else setSaid(refusal(error, 'The endpoint could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!keying) return;
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/model-endpoints/{id}/key', {
        params: { path: { id: keying.id } },
        body: { key },
      });
      if (data) {
        setSaid(`The key for ${keying.name} is set.`);
        setKeying(null);
        again();
      } else setSaid(refusal(error, 'The key could not be set.'));
    } finally {
      // The key is never kept by the page once it is sent.
      setKey('');
      setBusy(false);
    }
  };

  const test = async (endpoint: Endpoint) => {
    setSaid(`Testing ${endpoint.name}...`);
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/model-endpoints/{id}/test', { params: { path: { id: endpoint.id } } })
      .finally(() => setBusy(false));
    if (!data) {
      setSaid(refusal(error, 'The endpoint could not be tested.'));
      return;
    }
    if (data.outcome === 'failed') {
      setSaid(`${endpoint.name} failed its test. ${data.failure?.message ?? ''}`.trim());
      return;
    }
    const tokens =
      data.tokensIn === null
        ? 'no tokens reported'
        : `${data.tokensIn} tokens in, ${data.tokensOut} out`;
    const cost = data.cost === null ? '' : `, ${endpoint.currency} ${data.cost}`;
    setSaid(
      `${endpoint.name} answered "${data.reply ?? ''}" as ${data.model ?? endpoint.model} in ${data.ms} ms: ${tokens}${cost}.`,
    );
  };

  const retire = async (endpoint: Endpoint) => {
    const { data, error } = await client.POST('/v1/model-endpoints/{id}/retirement', {
      params: { path: { id: endpoint.id } },
    });
    if (data) {
      setSaid(`${endpoint.name} retired. Nothing is sent to it now.`);
      again();
    } else setSaid(refusal(error, 'The endpoint could not be retired.'));
  };

  const route = async (purpose: Route['purpose'], endpoint: string | null) => {
    const { data, error } = await client.PUT('/v1/model-routes/{purpose}', {
      params: { path: { purpose } },
      body: { endpoint },
    });
    if (data) {
      setSaid(`${PURPOSES[purpose]} ${endpoint === null ? 'is off' : 'route saved'}.`);
      again();
    } else setSaid(refusal(error, 'The route could not be saved.'));
  };

  const field = (name: keyof Draft, label: string, input: 'text' | 'number' | 'url' = 'text') =>
    editing && (
      <label className={styles['filter']}>
        {label}
        <input
          type={input}
          value={editing.draft[name]}
          onChange={(change) =>
            setEditing({ ...editing, draft: { ...editing.draft, [name]: change.target.value } })
          }
          {...(input === 'number' ? { step: 'any', min: 0 } : {})}
        />
      </label>
    );

  return (
    <>
      <div className={styles['lead']}>
        <p>
          The model endpoints this environment calls, each on your own provider account. A
          self-hosted endpoint speaking either protocol works too. Each endpoint says whether it
          sits outside your data boundary, as you set it. A key is never shown again once it is set.
        </p>
        <button type="button" onClick={() => setEditing({ id: null, draft: BLANK })}>
          Add an endpoint
        </button>
      </div>
      {editing && (
        <form
          className={styles['toolbar']}
          onSubmit={(event) => void save(event)}
          aria-label={editing.id === null ? 'Add an endpoint' : `Edit ${editing.draft.name}`}
          noValidate
        >
          {field('name', 'Name')}
          <label className={styles['filter']}>
            Protocol
            <select
              value={editing.draft.protocol}
              disabled={editing.id !== null}
              onChange={(change) =>
                setEditing({
                  ...editing,
                  draft: {
                    ...editing.draft,
                    protocol: change.target.value as Endpoint['protocol'],
                  },
                })
              }
            >
              <option value="anthropic">{PROTOCOLS.anthropic}</option>
              <option value="openai">{PROTOCOLS.openai}</option>
            </select>
          </label>
          {field('baseUrl', 'Base URL', 'url')}
          {field('model', 'Model')}
          {field('contextWindow', 'Context window, in tokens', 'number')}
          {field('priceIn', 'Price per million tokens in', 'number')}
          {field('priceOut', 'Price per million tokens out', 'number')}
          {field('priceCached', 'Price per million tokens read from its cache', 'number')}
          {field('currency', 'Currency')}
          <label className={styles['filter']}>
            Data boundary
            <select
              value={editing.draft.boundary}
              onChange={(change) =>
                setEditing({
                  ...editing,
                  draft: {
                    ...editing.draft,
                    boundary: change.target.value as Endpoint['boundary'] | '',
                  },
                })
              }
            >
              <option value="">Choose</option>
              <option value="inside">Inside your data boundary</option>
              <option value="outside">Outside your data boundary</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      )}
      {keying && (
        <form
          className={styles['toolbar']}
          onSubmit={(event) => void saveKey(event)}
          aria-label={`Set the key for ${keying.name}`}
          noValidate
        >
          <label className={styles['filter']}>
            Key for {keying.name}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(change) => setKey(change.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={busy || key === ''}>
            Save key
          </button>
          <button
            type="button"
            onClick={() => {
              setKey('');
              setKeying(null);
            }}
          >
            Cancel
          </button>
        </form>
      )}
      <Shown read={read} failed="The model endpoints could not be loaded.">
        {(rows) => (
          <>
            {rows.length === 0 ? (
              <p className={styles['muted']}>No model endpoint has been added yet.</p>
            ) : (
              <table aria-label="Model endpoints" className={styles['table']}>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Protocol</th>
                    <th scope="col">Model</th>
                    <th scope="col">Data boundary</th>
                    <th scope="col">Key</th>
                    <th scope="col">
                      <span className={styles['hidden']}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((endpoint) => {
                    const retired = endpoint.retiredAt !== null;
                    return (
                      <tr key={endpoint.id} data-archived={retired ? 'true' : undefined}>
                        <td className={styles['strong']}>
                          {endpoint.name}
                          {retired && <span className={styles['muted']}> (retired)</span>}
                        </td>
                        <td>{PROTOCOLS[endpoint.protocol]}</td>
                        <td>{endpoint.model}</td>
                        <td>
                          {endpoint.boundary === 'outside' ? (
                            <Chip>Outside your data boundary</Chip>
                          ) : (
                            'Inside'
                          )}
                        </td>
                        <td>{keyWords(endpoint)}</td>
                        <td>
                          {!retired && (
                            <span className={styles['actions']}>
                              <button
                                type="button"
                                aria-label={`Edit ${endpoint.name}`}
                                onClick={() =>
                                  setEditing({ id: endpoint.id, draft: draftOf(endpoint) })
                                }
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                aria-label={`Set the key for ${endpoint.name}`}
                                onClick={() => {
                                  // A key typed for one endpoint is never sent to another.
                                  setKey('');
                                  setKeying(endpoint);
                                }}
                              >
                                Set key
                              </button>
                              <button
                                type="button"
                                aria-label={`Test ${endpoint.name}`}
                                disabled={busy || !usable(endpoint)}
                                onClick={() => void test(endpoint)}
                              >
                                Test
                              </button>
                              <button
                                type="button"
                                aria-label={`Retire ${endpoint.name}`}
                                disabled={busy}
                                onClick={() => void retire(endpoint)}
                              >
                                Retire
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <h3>What each purpose uses</h3>
            <table aria-label="Model routes" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Purpose</th>
                  <th scope="col">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((each) => (
                  <tr key={each.purpose}>
                    <td className={styles['strong']}>{PURPOSES[each.purpose]}</td>
                    <td>
                      <select
                        aria-label={`Endpoint for ${PURPOSES[each.purpose]}`}
                        value={each.endpoint ?? ''}
                        onChange={(change) =>
                          void route(
                            each.purpose,
                            change.target.value === '' ? null : change.target.value,
                          )
                        }
                      >
                        <option value="">None: off</option>
                        {rows
                          .filter((endpoint) => usable(endpoint) || endpoint.id === each.endpoint)
                          .map((endpoint) => (
                            <option key={endpoint.id} value={endpoint.id}>
                              {endpoint.name}
                              {endpoint.boundary === 'outside'
                                ? ', outside your data boundary'
                                : ''}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Shown>
      <p role="status">{said}</p>
    </>
  );
}
