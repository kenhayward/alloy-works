import type { createApiClient } from '@alloy-works/api-client';
import { MODEL_TIMEOUT_SECONDS, MODEL_TOOL_CALLS, MODEL_TURNS } from '@alloy-works/domain';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Chip } from '../parts/Chip.js';
import { RowActions } from '../parts/RowActions.js';
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
  readonly kind: 'llm' | 'embedding';
  /** How long one call may take; absent, the default (`MODEL_TIMEOUT_SECONDS`). */
  readonly timeoutSeconds?: number;
  /** How many model turns and tool calls an assistant run may make; absent, the defaults. */
  readonly turnsPerRun?: number;
  readonly toolCallsPerRun?: number;
  readonly supportsTools: boolean;
  readonly supportsImages: boolean;
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

const KINDS: Readonly<Record<Endpoint['kind'], string>> = {
  get llm() {
    return words('admin.llm');
  },
  get embedding() {
    return words('admin.embedding');
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

/** Whether a purpose may go to an endpoint: embedding to an embedding model, the rest to an LLM. */
const fits = (purpose: Route['purpose'], endpoint: Endpoint) =>
  (purpose === 'embedding') === (endpoint.kind === 'embedding');

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
  kind: Endpoint['kind'];
  /** Empty for the default. */
  timeoutSeconds: string;
  turnsPerRun: string;
  toolCallsPerRun: string;
  supportsTools: boolean;
  supportsImages: boolean;
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
  kind: 'llm',
  timeoutSeconds: '',
  turnsPerRun: '',
  toolCallsPerRun: '',
  supportsTools: true,
  supportsImages: false,
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
  kind: endpoint.kind,
  timeoutSeconds: endpoint.timeoutSeconds === undefined ? '' : String(endpoint.timeoutSeconds),
  turnsPerRun: endpoint.turnsPerRun === undefined ? '' : String(endpoint.turnsPerRun),
  toolCallsPerRun: endpoint.toolCallsPerRun === undefined ? '' : String(endpoint.toolCallsPerRun),
  supportsTools: endpoint.supportsTools,
  supportsImages: endpoint.supportsImages,
});

/**
 * Administration's Models (generation.md, "Endpoints"; the G1 plan, G1-K): the model endpoints the
 * environment calls on its own provider accounts, each saying whether it sits outside the data
 * boundary and whether its key is set, never the key; **Add**; each line's **Edit** and **Test** as
 * icons, its form opening beside it, and **Set key** and **Retire** under More actions (ADR-0049,
 * decision 4); and which endpoint each purpose goes to, an embedding model offered for embedding alone.
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
  const hint = useId();
  const limitsHint = useId();
  // The form's first field, focused as it opens: beside its line, it may open far down the page.
  const first = useRef<HTMLInputElement>(null);
  const opened = editing === null ? null : (editing.id ?? 'new');
  useEffect(() => {
    if (opened !== null) first.current?.focus();
  }, [opened]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const { draft, id } = editing;
    if (draft.boundary === '') {
      setSaid(words('admin.say-whether-this-endpoint-sits'));
      return;
    }
    const beyond = (value: string, bounds: { readonly least: number; readonly most: number }) => {
      if (value.trim() === '') return false;
      const number = Number(value);
      return !Number.isInteger(number) || number < bounds.least || number > bounds.most;
    };
    if (beyond(draft.turnsPerRun, MODEL_TURNS) || beyond(draft.toolCallsPerRun, MODEL_TOOL_CALLS)) {
      setSaid(
        words('admin.run-limits-out-of-bounds', {
          turns: MODEL_TURNS.most,
          calls: MODEL_TOOL_CALLS.most,
        }),
      );
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
      kind: draft.kind,
      ...(draft.timeoutSeconds.trim() === ''
        ? {}
        : { timeoutSeconds: Number(draft.timeoutSeconds) }),
      ...(draft.turnsPerRun.trim() === '' ? {} : { turnsPerRun: Number(draft.turnsPerRun) }),
      ...(draft.toolCallsPerRun.trim() === ''
        ? {}
        : { toolCallsPerRun: Number(draft.toolCallsPerRun) }),
      supportsTools: draft.supportsTools,
      supportsImages: draft.supportsImages,
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
    if (busy) return;
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
      // The failure's own sentence is the service's, said after ours.
      setSaid(
        `${words('admin.failed-its-test', { name: endpoint.name })} ${data.failure?.message ?? ''}`.trim(),
      );
      return;
    }
    setSaid(
      words('admin.answered-as-in-ms', {
        name: endpoint.name,
        reply: data.reply ?? '',
        model: data.model ?? endpoint.model,
        ms: data.ms,
        counted: data.tokensIn === null ? 'no' : 'yes',
        tokensIn: data.tokensIn ?? 0,
        tokensOut: data.tokensOut ?? 0,
        costed: data.cost === null ? 'no' : 'yes',
        currency: endpoint.currency,
        cost: data.cost ?? '',
      }),
    );
  };

  const retire = async (endpoint: Endpoint) => {
    if (busy) return;
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
      setSaid(words('admin.route-said', { purpose, state: endpoint === null ? 'off' : 'on' }));
      again();
    } else setSaid(refusal(error, words('admin.the-route-could-not-be')));
  };

  type Text = {
    [K in keyof Draft]: Draft[K] extends string ? K : never;
  }[keyof Draft];
  const field = (name: Text, label: string, input: 'text' | 'number' | 'url' = 'text') =>
    editing && (
      <label className={styles['filter']}>
        {label}
        <input
          ref={name === 'name' ? first : undefined}
          type={input}
          value={editing.draft[name]}
          onChange={(change) =>
            setEditing({ ...editing, draft: { ...editing.draft, [name]: change.target.value } })
          }
          {...(input === 'number' ? { step: 'any', min: 0 } : {})}
        />
      </label>
    );

  const limit = (
    name: 'turnsPerRun' | 'toolCallsPerRun',
    label: string,
    bounds: { readonly least: number; readonly default: number; readonly most: number },
  ) =>
    editing && (
      <label className={styles['filter']}>
        {label}
        <input
          type="number"
          step={1}
          min={bounds.least}
          max={bounds.most}
          placeholder={String(bounds.default)}
          aria-describedby={limitsHint}
          value={editing.draft[name]}
          onChange={(change) =>
            setEditing({ ...editing, draft: { ...editing.draft, [name]: change.target.value } })
          }
        />
      </label>
    );

  const check = (name: 'supportsTools' | 'supportsImages', label: string) =>
    editing && (
      <label className={styles['filter']}>
        <input
          type="checkbox"
          checked={editing.draft[name]}
          onChange={(change) =>
            setEditing({ ...editing, draft: { ...editing.draft, [name]: change.target.checked } })
          }
        />{' '}
        {label}
      </label>
    );

  const form = () =>
    editing && (
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
        <label className={styles['filter']}>
          {words('admin.type')}
          <select
            value={editing.draft.kind}
            onChange={(change) =>
              setEditing({
                ...editing,
                draft: { ...editing.draft, kind: change.target.value as Endpoint['kind'] },
              })
            }
          >
            <option value="llm">{KINDS.llm}</option>
            <option value="embedding">{KINDS.embedding}</option>
          </select>
        </label>
        <label className={styles['filter']}>
          {words('admin.timeout-in-seconds')}
          <input
            type="number"
            step={1}
            min={MODEL_TIMEOUT_SECONDS.least}
            max={MODEL_TIMEOUT_SECONDS.most}
            placeholder={String(MODEL_TIMEOUT_SECONDS.default)}
            aria-describedby={hint}
            value={editing.draft.timeoutSeconds}
            onChange={(change) =>
              setEditing({
                ...editing,
                draft: { ...editing.draft, timeoutSeconds: change.target.value },
              })
            }
          />
        </label>
        <span id={hint} className={styles['muted']}>
          {words('admin.default-timeout', { seconds: MODEL_TIMEOUT_SECONDS.default })}
        </span>
        {limit('turnsPerRun', words('admin.turns-a-run'), MODEL_TURNS)}
        {limit('toolCallsPerRun', words('admin.tool-calls-a-run'), MODEL_TOOL_CALLS)}
        <span id={limitsHint} className={styles['muted']}>
          {words('admin.default-run-limits', {
            turns: MODEL_TURNS.default,
            calls: MODEL_TOOL_CALLS.default,
          })}
        </span>
        {check('supportsTools', words('admin.calls-tools'))}
        {check('supportsImages', words('admin.reads-images'))}
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
    );

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.the-model-endpoints-this-environment')}</p>
        <button type="button" onClick={() => setEditing({ id: null, draft: BLANK })}>
          {words('admin.add-an-endpoint')}
        </button>
      </div>
      {editing?.id === null && form()}
      {keying && (
        <form
          className={styles['toolbar']}
          onSubmit={(event) => void saveKey(event)}
          aria-label={words('admin.set-the-key-for', { name: keying.name })}
          noValidate
        >
          <label className={styles['filter']}>
            {words('admin.key-for', { name: keying.name })}
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
                    <th scope="col">{words('admin.type')}</th>
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
                    return [
                      <tr key={endpoint.id} data-archived={retired ? 'true' : undefined}>
                        <td className={styles['strong']}>
                          <span data-content>{endpoint.name}</span>
                          {retired && (
                            <span className={styles['muted']}> {words('admin.retired-mark')}</span>
                          )}
                        </td>
                        <td>{PROTOCOLS[endpoint.protocol]}</td>
                        <td data-content>{endpoint.model}</td>
                        <td>{KINDS[endpoint.kind]}</td>
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
                            <RowActions
                              subject={endpoint.name}
                              shown={[
                                {
                                  label: words('admin.edit-2'),
                                  name: words('admin.edit', { name: endpoint.name }),
                                  icon: 'Edit',
                                  onSelect: () =>
                                    setEditing({ id: endpoint.id, draft: draftOf(endpoint) }),
                                },
                                {
                                  label: words('admin.test-2'),
                                  name: words('admin.test', { name: endpoint.name }),
                                  icon: 'Test',
                                  ...(usable(endpoint)
                                    ? {}
                                    : { unavailable: words('admin.set-its-key-to-test-it') }),
                                  onSelect: () => void test(endpoint),
                                },
                              ]}
                              more={[
                                {
                                  label: words('admin.set-key'),
                                  onSelect: () => {
                                    // A key typed for one endpoint is never sent to another.
                                    setKey('');
                                    setKeying(endpoint);
                                  },
                                },
                                {
                                  label: words('admin.retire-2'),
                                  danger: true,
                                  onSelect: () => void retire(endpoint),
                                },
                              ]}
                            />
                          )}
                        </td>
                      </tr>,
                      // Its form beside it, where it was asked for.
                      editing?.id === endpoint.id && (
                        <tr key={`${endpoint.id}-editing`}>
                          <td colSpan={7}>{form()}</td>
                        </tr>
                      ),
                    ];
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
                        aria-label={words('admin.endpoint-for', { purpose: each.purpose })}
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
                          .filter(
                            (endpoint) =>
                              (usable(endpoint) && fits(each.purpose, endpoint)) ||
                              endpoint.id === each.endpoint,
                          )
                          .map((endpoint) => (
                            <option key={endpoint.id} value={endpoint.id}>
                              {words('admin.outside-your-data-boundary', {
                                name: endpoint.name,
                                boundary: endpoint.boundary,
                              })}
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
