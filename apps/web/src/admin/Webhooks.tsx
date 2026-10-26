import type { createApiClient } from '@alloy-works/api-client';
import { webhookEventTypes } from '@alloy-works/domain';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import styles from './Administration.module.css';
import { Shown, useListing, type Read } from './listing.js';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A subscription as the page lists it (webhooks.md; the WB plan, WB-H). */
interface Hook {
  readonly id: string;
  readonly serviceIdentity: string;
  readonly url: string;
  readonly description: string;
  readonly eventTypes: readonly string[];
  readonly disabledAt: string | null;
  readonly disabledReason: 'failing' | 'identity_disabled' | null;
  readonly lastSuccessAt: string | null;
}

interface Service {
  readonly id: string;
  readonly name: string;
  readonly disabledAt: string | null;
}

interface Delivery {
  readonly id: string;
  readonly type: string;
  readonly state: 'pending' | 'delivered' | 'given_up' | 'dropped';
  readonly attempts: number;
  readonly createdAt: string;
}

interface Attempt {
  readonly at: string;
  readonly status: number | null;
  readonly latencyMs: number;
  readonly failure: string | null;
  readonly reply: string | null;
}

const STATES: Readonly<Record<Delivery['state'], string>> = {
  get pending() {
    return words('admin.waiting');
  },
  get delivered() {
    return words('admin.delivered');
  },
  get given_up() {
    return words('admin.given-up');
  },
  get dropped() {
    return words('admin.not-sent-not-readable');
  },
};

const moment = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The secret, shown once with Copy: held in this dialog's state alone, gone when it closes. */
function SecretShown({ secret, onClose }: { secret: string; onClose: () => void }) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <section>
        <h2 id={id}>{words('admin.copy-the-signing-secret')}</h2>
        <p className={styles['muted']}>{words('admin.copy-it-now-it-will')}</p>
        <label>
          {words('admin.signing-secret')}
          <input ref={field} readOnly value={secret} autoComplete="off" spellCheck={false} />
        </label>
        <p role="status">{copied}</p>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(secret)
              .then(() => setCopied(words('admin.copied')))
              .catch(() => setCopied(words('admin.the-secret-could-not-be-2')))
          }
        >
          {words('admin.copy')}
        </button>
        <button type="button" className="primary" onClick={onClose}>
          {words('admin.done')}
        </button>
      </section>
    </Modal>
  );
}

/** A subscription's deliveries, newest first, each opened to its attempts (API-029). */
function Deliveries({ client, hook }: { client: Client; hook: Hook }) {
  const [load] = useState(
    () => () =>
      everyPage<Delivery>((cursor) =>
        client.GET('/v1/webhooks/{id}/deliveries', {
          params: { path: { id: hook.id }, query: cursor ? { cursor } : {} },
        }),
      ),
  );
  const read = useListing<Delivery>(load, true);
  const [open, setOpen] = useState<{ id: string; tried: readonly Attempt[]; sent: string } | null>(
    null,
  );
  const show = async (delivery: Delivery) => {
    const { data } = await client.GET('/v1/webhooks/{id}/deliveries/{delivery}', {
      params: { path: { id: hook.id, delivery: delivery.id } },
    });
    if (data)
      setOpen({ id: delivery.id, tried: data.tried, sent: JSON.stringify(data.payload, null, 2) });
  };
  return (
    <Shown read={read} failed={words('admin.the-deliveries-could-not-be-loaded')}>
      {(rows) =>
        rows.length === 0 ? (
          <p className={styles['muted']}>{words('admin.nothing-has-been-delivered-to')}</p>
        ) : (
          <>
            <table
              aria-label={words('admin.deliveries-to', { url: hook.url })}
              className={styles['table']}
            >
              <thead>
                <tr>
                  <th scope="col">{words('admin.event')}</th>
                  <th scope="col">{words('admin.state')}</th>
                  <th scope="col">{words('admin.attempts')}</th>
                  <th scope="col">{words('admin.queued')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((delivery) => (
                  <tr key={delivery.id}>
                    <td className={styles['code']} data-content>
                      {delivery.type}
                    </td>
                    <td>{STATES[delivery.state]}</td>
                    <td>{formats().number(delivery.attempts)}</td>
                    <td>{moment(delivery.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={words('admin.what-was-sent-for-at', {
                          type: delivery.type,
                          at: moment(delivery.createdAt),
                        })}
                        onClick={() => void show(delivery)}
                      >
                        {words('admin.what-was-sent')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open !== null && (
              <section aria-label={words('admin.what-was-sent-and-what')}>
                <pre className={styles['code']} data-content>
                  {open.sent}
                </pre>
                {open.tried.length === 0 ? (
                  <p className={styles['muted']}>{words('admin.not-tried-yet')}</p>
                ) : (
                  <ol aria-label={words('admin.attempts')}>
                    {open.tried.map((attempt) => (
                      <li key={attempt.at}>
                        {words('admin.attempt-said', {
                          at: moment(attempt.at),
                          answered: attempt.status === null ? 'no' : 'yes',
                          status: attempt.status ?? '',
                          known: attempt.failure === null ? 'no' : 'yes',
                          failure: attempt.failure ?? '',
                          ms: attempt.latencyMs,
                        })}
                        {attempt.reply ? (
                          <pre className={styles['code']} data-content>
                            {attempt.reply}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </>
        )
      }
    </Shown>
  );
}

/**
 * Administration's **Webhooks** (webhooks.md; the WB plan, WB-H and WB-J): each subscription, whose
 * service identity's view decides what it receives; **New webhook**, its secret shown once; and for
 * each, its deliveries, a new secret, and removing it, each of the last two after asking.
 */
export function Webhooks({ client }: { client: Client }) {
  const [generation, setGeneration] = useState(0);
  const [load] = useState(
    () => () =>
      everyPage<Hook>((cursor) =>
        client.GET('/v1/webhooks', { params: { query: cursor ? { cursor } : {} } }),
      ),
  );
  const read = useListing<Hook>(load, true, generation);
  const [services, setServices] = useState<readonly Service[]>([]);
  useEffect(() => {
    void everyPage<Service>((cursor) =>
      client.GET('/v1/service-identities', { params: { query: cursor ? { cursor } : {} } }),
    ).then((answer) => 'items' in answer && setServices(answer.items));
  }, [client, generation]);
  const [identity, setIdentity] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [types, setTypes] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [rotating, setRotating] = useState<Hook | null>(null);
  const [removing, setRemoving] = useState<Hook | null>(null);
  const again = () => setGeneration((was) => was + 1);
  const nameOf = (id: string) =>
    services.find((each) => each.id === id)?.name ?? words('admin.a-service-identity');
  const active = services.filter((each) => each.disabledAt === null);

  const make = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await client.POST('/v1/webhooks', {
      body: {
        serviceIdentity: identity,
        url: url.trim(),
        description: description.trim(),
        eventTypes: webhookEventTypes.filter((each) => types.has(each)),
      },
    });
    if (data) {
      setSaid(words('admin.made-the-webhook-to', { url: data.webhook.url }));
      setUrl('');
      setDescription('');
      setTypes(new Set());
      if (data.secret) setSecret(data.secret);
      again();
    } else setSaid(refusal(error, words('admin.the-webhook-could-not-be')));
  };

  const rotate = async (hook: Hook) => {
    const { data, error } = await client.POST('/v1/webhooks/{id}/secret', {
      params: { path: { id: hook.id } },
    });
    setRotating(null);
    if (data?.secret) {
      setSaid(words('admin.a-new-secret-for-the', { url: hook.url }));
      setSecret(data.secret);
    } else setSaid(refusal(error, words('admin.the-secret-could-not-be-3')));
  };

  const enable = async (hook: Hook) => {
    const { data, error } = await client.PATCH('/v1/webhooks/{id}', {
      params: { path: { id: hook.id } },
      body: { enabled: true },
    });
    setSaid(
      data
        ? words('admin.turned-on-the-webhook-to', { url: hook.url })
        : refusal(error, words('admin.the-webhook-could-not-be-2')),
    );
    again();
  };

  const remove = async (hook: Hook) => {
    const { data, error } = await client.DELETE('/v1/webhooks/{id}', {
      params: { path: { id: hook.id } },
    });
    setRemoving(null);
    setSaid(
      data
        ? words('admin.removed-the-webhook-to', { url: hook.url })
        : refusal(error, words('admin.the-webhook-could-not-be-3')),
    );
    again();
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.events-posted-to-an-endpoint')}</p>
      </div>
      <form
        onSubmit={(event) => void make(event)}
        aria-label={words('admin.new-webhook')}
        noValidate
      >
        <label className={styles['filter']}>
          {words('admin.service-identity')}
          <select value={identity} onChange={(change) => setIdentity(change.target.value)}>
            <option value="">{words('admin.choose-one')}</option>
            {active.map((each) => (
              <option key={each.id} value={each.id} data-content>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          {words('admin.https-url')}
          <input value={url} onChange={(change) => setUrl(change.target.value)} />
        </label>
        <label className={styles['filter']}>
          {words('admin.what-receives-it')}
          <input value={description} onChange={(change) => setDescription(change.target.value)} />
        </label>
        <fieldset>
          <legend>{words('admin.events-2')}</legend>
          {webhookEventTypes.map((type) => (
            <label key={type} className={styles['check']}>
              <input
                type="checkbox"
                checked={types.has(type)}
                onChange={(change) => {
                  const next = new Set(types);
                  if (change.target.checked) next.add(type);
                  else next.delete(type);
                  setTypes(next);
                }}
              />
              <span className={styles['code']} data-content>
                {type}
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="primary"
          disabled={identity === '' || url.trim() === '' || types.size === 0}
        >
          {words('admin.make')}
        </button>
      </form>
      <p role="status">{said}</p>
      <Shown read={read} failed={words('admin.the-webhooks-could-not-be-loaded')}>
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>{words('admin.no-webhook-is-made')}</p>
          ) : (
            <table aria-label={words('admin.webhooks')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.url')}</th>
                  <th scope="col">{words('admin.service-identity')}</th>
                  <th scope="col">{words('admin.events-2')}</th>
                  <th scope="col">{words('admin.status')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((hook) => (
                  <tr key={hook.id}>
                    <td className={styles['strong']} data-content>
                      {hook.url}
                    </td>
                    <td>{nameOf(hook.serviceIdentity)}</td>
                    <td>{formats().number(hook.eventTypes.length)}</td>
                    <td>
                      {hook.disabledAt === null ? (
                        <Chip tone="ok">{words('admin.active')}</Chip>
                      ) : (
                        <Chip tone="warn">
                          {hook.disabledReason === 'failing'
                            ? words('admin.off-failing')
                            : words('admin.off-identity-disabled')}
                        </Chip>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={words('admin.deliveries-to', { url: hook.url })}
                        aria-expanded={opened === hook.id}
                        onClick={() => setOpened(opened === hook.id ? null : hook.id)}
                      >
                        {words('admin.deliveries')}
                      </button>{' '}
                      {hook.disabledAt !== null && (
                        <>
                          <button
                            type="button"
                            aria-label={words('admin.turn-on', { url: hook.url })}
                            onClick={() => void enable(hook)}
                          >
                            {words('admin.turn-on-2')}
                          </button>{' '}
                        </>
                      )}
                      <button
                        type="button"
                        aria-label={words('admin.new-secret-for', { url: hook.url })}
                        onClick={() => setRotating(hook)}
                      >
                        {words('admin.new-secret')}
                      </button>{' '}
                      <button
                        type="button"
                        aria-label={words('admin.remove-4', { url: hook.url })}
                        onClick={() => setRemoving(hook)}
                      >
                        {words('admin.remove-2')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Shown>
      {opened !== null && <OpenedDeliveries client={client} read={read} id={opened} />}
      {secret !== null && <SecretShown secret={secret} onClose={() => setSecret(null)} />}
      {rotating !== null && (
        <ConfirmDialog
          question={words('admin.make-a-new-secret-for', { url: rotating.url })}
          sentence={words('admin.the-old-one-goes-on')}
          keep={words('admin.keep-it')}
          act={words('admin.new-secret')}
          onKeep={() => setRotating(null)}
          onAct={() => rotate(rotating)}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          question={words('admin.remove-the-webhook-to', { url: removing.url })}
          sentence={words('admin.every-delivery-waiting-for-it')}
          keep={words('admin.keep-it')}
          act={words('admin.remove-2')}
          onKeep={() => setRemoving(null)}
          onAct={() => remove(removing)}
        />
      )}
    </>
  );
}

/** The opened subscription's deliveries, found among those read. */
function OpenedDeliveries({ client, read, id }: { client: Client; read: Read<Hook>; id: string }) {
  const rows = read !== null && typeof read === 'object' ? read.rows : [];
  const hook = rows.find((each) => each.id === id);
  if (!hook) return null;
  return (
    <section aria-label={words('admin.deliveries-of', { url: hook.url })}>
      <h3>{words('admin.deliveries-to', { url: hook.url })}</h3>
      <Deliveries key={hook.id} client={client} hook={hook} />
    </section>
  );
}
