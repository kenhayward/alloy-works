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
  pending: 'Waiting',
  delivered: 'Delivered',
  given_up: 'Given up',
  dropped: 'Not sent: not readable',
};

const moment = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
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
        <h2 id={id}>Copy the signing secret</h2>
        <p className={styles['muted']}>
          Copy it now: it will not be shown again. The receiver checks each delivery’s signature
          with it.
        </p>
        <label>
          Signing secret
          <input ref={field} readOnly value={secret} autoComplete="off" spellCheck={false} />
        </label>
        <p role="status">{copied}</p>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(secret)
              .then(() => setCopied('Copied.'))
              .catch(() =>
                setCopied('The secret could not be copied. Select it and copy it yourself.'),
              )
          }
        >
          Copy
        </button>
        <button type="button" className="primary" onClick={onClose}>
          Done
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
    <Shown read={read} failed="The deliveries could not be loaded.">
      {(rows) =>
        rows.length === 0 ? (
          <p className={styles['muted']}>Nothing has been delivered to it yet.</p>
        ) : (
          <>
            <table aria-label={`Deliveries to ${hook.url}`} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">State</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Queued</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((delivery) => (
                  <tr key={delivery.id}>
                    <td className={styles['code']}>{delivery.type}</td>
                    <td>{STATES[delivery.state]}</td>
                    <td>{delivery.attempts}</td>
                    <td>{moment(delivery.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`What was sent for ${delivery.type} at ${moment(delivery.createdAt)}`}
                        onClick={() => void show(delivery)}
                      >
                        What was sent
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open !== null && (
              <section aria-label="What was sent, and what came back">
                <pre className={styles['code']}>{open.sent}</pre>
                {open.tried.length === 0 ? (
                  <p className={styles['muted']}>Not tried yet.</p>
                ) : (
                  <ol aria-label="Attempts">
                    {open.tried.map((attempt) => (
                      <li key={attempt.at}>
                        {moment(attempt.at)}:{' '}
                        {attempt.status === null
                          ? `no answer (${attempt.failure ?? 'unknown'})`
                          : `answered ${attempt.status}`}
                        , {attempt.latencyMs} ms
                        {attempt.reply ? (
                          <pre className={styles['code']}>{attempt.reply}</pre>
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
    services.find((each) => each.id === id)?.name ?? 'A service identity';
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
      setSaid(`Made the webhook to ${data.webhook.url}.`);
      setUrl('');
      setDescription('');
      setTypes(new Set());
      if (data.secret) setSecret(data.secret);
      again();
    } else setSaid(refusal(error, 'The webhook could not be made.'));
  };

  const rotate = async (hook: Hook) => {
    const { data, error } = await client.POST('/v1/webhooks/{id}/secret', {
      params: { path: { id: hook.id } },
    });
    setRotating(null);
    if (data?.secret) {
      setSaid(`A new secret for ${hook.url}: the old one signs beside it for a day.`);
      setSecret(data.secret);
    } else setSaid(refusal(error, 'The secret could not be rotated.'));
  };

  const enable = async (hook: Hook) => {
    const { data, error } = await client.PATCH('/v1/webhooks/{id}', {
      params: { path: { id: hook.id } },
      body: { enabled: true },
    });
    setSaid(
      data
        ? `Turned on the webhook to ${hook.url}.`
        : refusal(error, 'The webhook could not be turned on.'),
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
        ? `Removed the webhook to ${hook.url}.`
        : refusal(error, 'The webhook could not be removed.'),
    );
    again();
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>
          Events posted to an endpoint as they happen, signed, carrying identifiers and versions and
          never content, and only about what its service identity may read. A failing endpoint is
          tried again for a day, and turned off after three days of failures.
        </p>
      </div>
      <form onSubmit={(event) => void make(event)} aria-label="New webhook" noValidate>
        <label className={styles['filter']}>
          Service identity
          <select value={identity} onChange={(change) => setIdentity(change.target.value)}>
            <option value="">Choose one</option>
            {active.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          HTTPS URL
          <input value={url} onChange={(change) => setUrl(change.target.value)} />
        </label>
        <label className={styles['filter']}>
          What receives it
          <input value={description} onChange={(change) => setDescription(change.target.value)} />
        </label>
        <fieldset>
          <legend>Events</legend>
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
              <span className={styles['code']}>{type}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="primary"
          disabled={identity === '' || url.trim() === '' || types.size === 0}
        >
          Make
        </button>
      </form>
      <p role="status">{said}</p>
      <Shown read={read} failed="The webhooks could not be loaded.">
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>No webhook is made.</p>
          ) : (
            <table aria-label="Webhooks" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">Service identity</th>
                  <th scope="col">Events</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((hook) => (
                  <tr key={hook.id}>
                    <td className={styles['strong']}>{hook.url}</td>
                    <td>{nameOf(hook.serviceIdentity)}</td>
                    <td>{hook.eventTypes.length}</td>
                    <td>
                      {hook.disabledAt === null ? (
                        <Chip tone="ok">Active</Chip>
                      ) : (
                        <Chip tone="warn">
                          {hook.disabledReason === 'failing'
                            ? 'Off: failing'
                            : 'Off: identity disabled'}
                        </Chip>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Deliveries to ${hook.url}`}
                        aria-expanded={opened === hook.id}
                        onClick={() => setOpened(opened === hook.id ? null : hook.id)}
                      >
                        Deliveries
                      </button>{' '}
                      {hook.disabledAt !== null && (
                        <>
                          <button
                            type="button"
                            aria-label={`Turn on ${hook.url}`}
                            onClick={() => void enable(hook)}
                          >
                            Turn on
                          </button>{' '}
                        </>
                      )}
                      <button
                        type="button"
                        aria-label={`New secret for ${hook.url}`}
                        onClick={() => setRotating(hook)}
                      >
                        New secret
                      </button>{' '}
                      <button
                        type="button"
                        aria-label={`Remove ${hook.url}`}
                        onClick={() => setRemoving(hook)}
                      >
                        Remove
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
          question={`Make a new secret for ${rotating.url}?`}
          sentence="The old one goes on signing beside it for a day, so the receiver can change without losing an event."
          keep="Keep it"
          act="New secret"
          onKeep={() => setRotating(null)}
          onAct={() => rotate(rotating)}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          question={`Remove the webhook to ${removing.url}?`}
          sentence="Every delivery waiting for it goes with it."
          keep="Keep it"
          act="Remove"
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
    <section aria-label={`Deliveries of ${hook.url}`}>
      <h3>Deliveries to {hook.url}</h3>
      <Deliveries key={hook.id} client={client} hook={hook} />
    </section>
  );
}
