import type { createApiClient } from '@alloy-works/api-client';
import { useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Chip } from '../parts/Chip.js';
import { EmbeddingPanel } from './EmbeddingPanel.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { words } from '../words/words.js';

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
  readonly purpose: 'drafting' | 'chat' | 'summarising' | 'embedding' | 'translate';
  readonly endpoint: string | null;
}

const PROTOCOLS: Readonly<Record<Endpoint['protocol'], string>> = {
  get anthropic() {
    return words('admin.anthropic-messages');
  },
  get openai() {
    return words('admin.openai-chat-completions');
  },
};

const PURPOSES: Readonly<Record<Route['purpose'], string>> = {
  get drafting() {
    return words('admin.drafting');
  },
  get chat() {
    return words('admin.chat');
  },
  get summarising() {
    return words('admin.summarising');
  },
  get embedding() {
    return words('admin.embedding');
  },
  get translate() {
    return words('admin.machine-translation');
  },
};

/** Whether calls can go to an endpoint: in use, with a key set for where it points. */
const usable = (endpoint: Endpoint) =>
  endpoint.retiredAt === null && endpoint.key.set && !endpoint.key.needsSetting;

const keyWords = (endpoint: Endpoint) =>
  !endpoint.key.set
    ? words('admin.not-set')
    : endpoint.key.needsSetting
      ? words('admin.set-it-again')
      : words('admin.set');

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
      setSaid(words('admin.say-whether-this-endpoint-sits'));
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
        setSaid(
          id === null
            ? words('admin.added-set-its-key-to', { name: body.name })
            : words('admin.saved-2', { name: body.name }),
        );
        setEditing(null);
        again();
      } else setSaid(refusal(error, words('admin.the-endpoint-could-not-be')));
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
        setSaid(words('admin.the-key-for-is-set', { name: keying.name }));
        setKeying(null);
        again();
      } else setSaid(refusal(error, words('admin.the-key-could-not-be')));
    } finally {
      // The key is never kept by the page once it is sent.
      setKey('');
      setBusy(false);
    }
  };

  const test = async (endpoint: Endpoint) => {
    setSaid(words('admin.testing', { name: endpoint.name }));
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/model-endpoints/{id}/test', { params: { path: { id: endpoint.id } } })
      .finally(() => setBusy(false));
    if (!data) {
      setSaid(refusal(error, words('admin.the-endpoint-could-not-be-2')));
      return;
    }
    if (data.outcome === 'failed') {
      setSaid(`${endpoint.name} failed its test. ${data.failure?.message ?? ''}`.trim());
      return;
    }
    const tokens =
      data.tokensIn === null
        ? words('admin.no-tokens-reported')
        : words('admin.tokens-in-out', { tokensIn: data.tokensIn, tokensOut: data.tokensOut });
    const cost = data.cost === null ? '' : `, ${endpoint.currency} ${data.cost}`;
    setSaid(
      words('admin.answered-as-in-ms', {
        name: endpoint.name,
        value2: data.reply ?? '',
        value3: data.model ?? endpoint.model,
        ms: data.ms,
        tokens,
        cost,
      }),
    );
  };

  const retire = async (endpoint: Endpoint) => {
    const { data, error } = await client.POST('/v1/model-endpoints/{id}/retirement', {
      params: { path: { id: endpoint.id } },
    });
    if (data) {
      setSaid(words('admin.retired-nothing-is-sent-to', { name: endpoint.name }));
      again();
    } else setSaid(refusal(error, words('admin.the-endpoint-could-not-be-3')));
  };

  const route = async (purpose: Route['purpose'], endpoint: string | null) => {
    const { data, error } = await client.PUT('/v1/model-routes/{purpose}', {
      params: { path: { purpose } },
      body: { endpoint },
    });
    if (data) {
      setSaid(
        `${PURPOSES[purpose]} ${endpoint === null ? words('admin.is-off') : words('admin.route-saved')}.`,
      );
      again();
    } else setSaid(refusal(error, words('admin.the-route-could-not-be')));
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
        <p>{words('admin.the-model-endpoints-this-environment')}</p>
        <button type="button" onClick={() => setEditing({ id: null, draft: BLANK })}>
          {words('admin.add-an-endpoint')}
        </button>
      </div>
      {editing && (
        <form
          className={styles['toolbar']}
          onSubmit={(event) => void save(event)}
          aria-label={
            editing.id === null
              ? words('admin.add-an-endpoint')
              : words('admin.edit', { name: editing.draft.name })
          }
          noValidate
        >
          {field('name', words('admin.name'))}
          <label className={styles['filter']}>
            {words('admin.protocol')}
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
          {field('baseUrl', words('admin.base-url'), 'url')}
          {field('model', words('admin.model'))}
          {field('contextWindow', words('admin.context-window-in-tokens'), 'number')}
          {field('priceIn', words('admin.price-per-million-tokens-in'), 'number')}
          {field('priceOut', words('admin.price-per-million-tokens-out'), 'number')}
          {field('priceCached', words('admin.price-per-million-tokens-read'), 'number')}
          {field('currency', words('admin.currency'))}
          <label className={styles['filter']}>
            {words('admin.data-boundary')}
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
              <option value="">{words('admin.choose')}</option>
              <option value="inside">{words('admin.inside-your-data-boundary')}</option>
              <option value="outside">{words('admin.outside-your-data-boundary-2')}</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.save')}
          </button>
          <button type="button" onClick={() => setEditing(null)}>
            {words('admin.cancel')}
          </button>
        </form>
      )}
      {keying && (
        <form
          className={styles['toolbar']}
          onSubmit={(event) => void saveKey(event)}
          aria-label={words('admin.set-the-key-for', { name: keying.name })}
          noValidate
        >
          <label className={styles['filter']}>
            {words('admin.key-for')}
            {keying.name}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(change) => setKey(change.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={busy || key === ''}>
            {words('admin.save-key')}
          </button>
          <button
            type="button"
            onClick={() => {
              setKey('');
              setKeying(null);
            }}
          >
            {words('admin.cancel')}
          </button>
        </form>
      )}
      <Shown read={read} failed={words('admin.the-model-endpoints-could-not-be')}>
        {(rows) => (
          <>
            {rows.length === 0 ? (
              <p className={styles['muted']}>{words('admin.no-model-endpoint-has-been')}</p>
            ) : (
              <table aria-label={words('admin.model-endpoints')} className={styles['table']}>
                <thead>
                  <tr>
                    <th scope="col">{words('admin.name')}</th>
                    <th scope="col">{words('admin.protocol')}</th>
                    <th scope="col">{words('admin.model')}</th>
                    <th scope="col">{words('admin.data-boundary')}</th>
                    <th scope="col">{words('admin.key')}</th>
                    <th scope="col">
                      <span className={styles['hidden']}>{words('admin.actions')}</span>
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
                            <Chip>{words('admin.outside-your-data-boundary-2')}</Chip>
                          ) : (
                            words('admin.inside')
                          )}
                        </td>
                        <td>{keyWords(endpoint)}</td>
                        <td>
                          {!retired && (
                            <span className={styles['actions']}>
                              <button
                                type="button"
                                aria-label={words('admin.edit', { name: endpoint.name })}
                                onClick={() =>
                                  setEditing({ id: endpoint.id, draft: draftOf(endpoint) })
                                }
                              >
                                {words('admin.edit-2')}
                              </button>
                              <button
                                type="button"
                                aria-label={words('admin.set-the-key-for', { name: endpoint.name })}
                                onClick={() => {
                                  // A key typed for one endpoint is never sent to another.
                                  setKey('');
                                  setKeying(endpoint);
                                }}
                              >
                                {words('admin.set-key')}
                              </button>
                              <button
                                type="button"
                                aria-label={words('admin.test', { name: endpoint.name })}
                                disabled={busy || !usable(endpoint)}
                                onClick={() => void test(endpoint)}
                              >
                                {words('admin.test-2')}
                              </button>
                              <button
                                type="button"
                                aria-label={words('admin.retire-3', { name: endpoint.name })}
                                disabled={busy}
                                onClick={() => void retire(endpoint)}
                              >
                                {words('admin.retire-2')}
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
            <h3>{words('admin.what-each-purpose-uses')}</h3>
            <table aria-label={words('admin.model-routes')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.purpose')}</th>
                  <th scope="col">{words('admin.endpoint')}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((each) => (
                  <tr key={each.purpose}>
                    <td className={styles['strong']}>{PURPOSES[each.purpose]}</td>
                    <td>
                      <select
                        aria-label={words('admin.endpoint-for', { value1: PURPOSES[each.purpose] })}
                        value={each.endpoint ?? ''}
                        onChange={(change) =>
                          void route(
                            each.purpose,
                            change.target.value === '' ? null : change.target.value,
                          )
                        }
                      >
                        <option value="">{words('admin.none-off')}</option>
                        {rows
                          .filter((endpoint) => usable(endpoint) || endpoint.id === each.endpoint)
                          .map((endpoint) => (
                            <option key={endpoint.id} value={endpoint.id}>
                              {endpoint.name}
                              {endpoint.boundary === 'outside'
                                ? words('admin.outside-your-data-boundary')
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
      <EmbeddingPanel client={client} generation={generation} />
    </>
  );
}
