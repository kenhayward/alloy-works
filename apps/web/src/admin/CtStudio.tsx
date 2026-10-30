import type { createApiClient, paths } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { CtStudioHandOff, sinkEntry } from './CtStudioHandOff.js';
import { CtStudioSettings, type BridgeSettingsBody } from './CtStudioSettings.js';
import { formats, words as say } from '../words/words.js';

export { sinkEntry };

type Client = ReturnType<typeof createApiClient>;
type Status = paths['/v1/ct-studio']['get']['responses']['200']['content']['application/json'];
type Connected =
  paths['/v1/ct-studio/connections']['post']['responses']['200']['content']['application/json'];
type Issued = NonNullable<Connected['issued']>;

const DAY_MS = 86_400_000;
/** A token this near its end is offered a replacement (the design: within 30 days). */
const NEAR_DAYS = 30;

/** A host that, from CT Studio's bridge, names the bridge's own machine rather than this one. */
const loopback = (host: string): boolean =>
  host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host);

/**
 * Whether CT Studio's bridge can be handed `address`: an https origin, port and all, whose host is not
 * a loopback name. The service tells environments apart by the hostname a request arrives at, so the
 * address is one of this environment's hostnames as the bridge reaches it.
 */
export function reachable(address: string): boolean {
  try {
    const url = new URL(address);
    return (
      url.protocol === 'https:' &&
      !loopback(url.hostname) &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

/**
 * The address CT Studio is handed by default: this page's own when the bridge could reach it, port
 * and all, else `https://` and the first hostname that is not a loopback name, else none. A hostname
 * carries no port, so a default from one may need it added.
 */
export function defaultAddress(pageOrigin: string, hostnames: readonly string[]): string {
  if (reachable(pageOrigin)) return pageOrigin;
  const host = hostnames.find((each) => !loopback(each));
  return host === undefined ? '' : `https://${host}`;
}

/** The sink id CT Studio is handed by default: `alloy-` and the first hostname's first label. */
export function defaultSinkId(hostnames: readonly string[]): string {
  const label = (hostnames[0] ?? 'environment').split('.')[0]!.toLowerCase();
  return `alloy-${label.replace(/[^a-z0-9-]/g, '-')}`;
}

const when = (at: string) =>
  formats().date(new Date(at), { day: 'numeric', month: 'long', year: 'numeric' });

/** What the hand-off page is showing, once a write has answered. */
interface HandOff {
  readonly kind: 'first' | 'later' | 'token';
  readonly issued: Issued | null;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly oldToken: string | null;
}

/**
 * Administration's CT Studio (docs/design/ct-studio-connect.md; API-074, API-075): what is connected,
 * **Connect a space**, a new token or a replacement identity when one is due, **Grant again** for a
 * space that lost its grant, and each space's settings. Every write ends on the hand-off page.
 */
export function CtStudio({ client }: { client: Client }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState('');
  const [flow, setFlow] = useState(false);
  const [handOff, setHandOff] = useState<HandOff | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  /** The space whose disconnection is being asked about. */
  const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await client.GET('/v1/ct-studio');
    if (data) setStatus(data);
    else setFailed(refusal(error, say('admin.ct-studio-could-not-be-read')));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === null) return <p role="status">{failed || say('admin.loading')}</p>;

  const address = status.address ?? defaultAddress(window.location.origin, status.hostnames);
  const sinkId = status.sinkId ?? defaultSinkId(status.hostnames);
  const expires = status.token === null ? null : Date.parse(status.token.expiresAt);
  const due = expires !== null && expires - Date.now() < NEAR_DAYS * DAY_MS;

  async function newToken(replaceIdentity: boolean) {
    setSaid('');
    const oldToken = status?.token?.id ?? null;
    const { data, error } = await client.POST('/v1/ct-studio/tokens', {
      body: { replaceIdentity },
    });
    if (!data) {
      setSaid(refusal(error, say('admin.the-token-could-not-be-issued')));
      return;
    }
    setStatus(data.status);
    setHandOff({
      kind: 'token',
      issued: data.issued,
      space: null,
      oldToken: replaceIdentity ? null : oldToken,
    });
  }

  async function disconnect(space: { id: string; name: string }) {
    const { data, error } = await client.DELETE('/v1/ct-studio/connections/{space}', {
      params: { path: { space: space.id } },
    });
    if (!data) {
      setSaid(refusal(error, say('admin.the-space-could-not-be-disconnected')));
      throw new Error('not disconnected');
    }
    setStatus(data);
    if (open === space.id) setOpen(null);
    setDisconnecting(null);
    setSaid(say('admin.space-is-disconnected-from-ct-studio', { space: space.name }));
  }

  async function grantAgain(space: { id: string; name: string }) {
    setSaid('');
    const read = await client.GET('/v1/spaces/{space}/bridge-settings', {
      params: { path: { space: space.id } },
    });
    if (!read.data) {
      setSaid(refusal(read.error, say('admin.the-grant-could-not-be-made')));
      return;
    }
    const { componentType, template, propertyMap, data } = read.data;
    const { data: answer, error } = await client.POST('/v1/ct-studio/connections', {
      body: {
        space: space.id,
        identity: null,
        settings: { componentType, template, propertyMap, data },
        address,
        sinkId,
      },
    });
    if (answer) {
      setStatus(answer.status);
      setSaid(say('admin.ct-studio-may-deliver-to-again', { space: space.name }));
    } else setSaid(refusal(error, say('admin.the-grant-could-not-be-made')));
  }

  return (
    <div className={styles['section']}>
      {!status.bridgeOn && <p role="alert">{say('admin.this-service-has-no-signing-key')}</p>}
      {status.identity === null ? (
        <p>{say('admin.ct-studio-is-not-connected-yet')}</p>
      ) : (
        <div>
          <p>{say('admin.ct-studio-delivers-as', { identity: status.identity.name })}</p>
          {status.identity.disabled ? (
            <>
              <p role="alert">{say('admin.the-identity-is-disabled-so-deliveries-are-refused')}</p>
              <button type="button" onClick={() => void newToken(true)}>
                {say('admin.replace-the-identity')}
              </button>
            </>
          ) : (
            <>
              {/* Near its end, or with none recorded, the token is said as an alert; a new one is
                  always offered, as the way out once a hand-off was closed before it was copied. */}
              <p {...(due || status.token === null ? { role: 'alert' } : {})}>
                {status.token === null
                  ? say('admin.no-token-is-recorded-for-ct-studio')
                  : say('admin.its-token-expires-on', { date: when(status.token.expiresAt) })}
              </p>
              <button type="button" onClick={() => void newToken(false)}>
                {say('admin.issue-a-new-token')}
              </button>
            </>
          )}
        </div>
      )}

      {status.spaces.length > 0 && (
        <table aria-label={say('admin.spaces-ct-studio-delivers-to')} className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">{say('admin.space')}</th>
              <th scope="col">{say('admin.data-tables')}</th>
              <th scope="col">
                <span className={styles['hidden']}>{say('admin.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {status.spaces.map((space) => (
              <tr key={space.id}>
                <td>
                  {space.name}
                  {!space.granted && (
                    <span className={styles['muted']}>
                      {' '}
                      {say('admin.deliveries-are-refused-here')}
                    </span>
                  )}
                </td>
                <td>{space.data ? say('admin.on') : say('admin.off')}</td>
                <td className={styles['actions']}>
                  {!space.granted && (
                    <button type="button" onClick={() => void grantAgain(space)}>
                      {say('admin.grant-again', { space: space.name })}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={open === space.id}
                    onClick={() => setOpen(open === space.id ? null : space.id)}
                  >
                    {say('admin.settings-for', { space: space.name })}
                  </button>
                  <button type="button" onClick={() => setDisconnecting(space)}>
                    {say('admin.disconnect-space', { space: space.name })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open !== null && <CtStudioSettings client={client} space={open} />}

      <button type="button" className="primary" onClick={() => setFlow(true)}>
        {say('admin.connect-a-space')}
      </button>
      <p role="status">{said}</p>

      {disconnecting !== null && (
        <ConfirmDialog
          question={say('admin.disconnect-space-from-ct-studio', { space: disconnecting.name })}
          sentence={say('admin.ct-studio-can-no-longer-deliver-here')}
          keep={say('admin.keep-it')}
          act={say('admin.disconnect')}
          onKeep={() => setDisconnecting(null)}
          onAct={() => disconnect(disconnecting)}
        />
      )}
      {flow && (
        <ConnectFlow
          client={client}
          status={status}
          address={address}
          sinkId={sinkId}
          onClose={() => setFlow(false)}
          onConnected={(answer, first) => {
            setFlow(false);
            setStatus(answer.status);
            setHandOff({
              kind: first ? 'first' : 'later',
              issued: answer.issued,
              space: answer.space,
              oldToken: null,
            });
          }}
        />
      )}
      {handOff !== null && (
        <Modal labelledBy="ct-studio-hand-off" size="wide" onClose={() => setHandOff(null)}>
          <CtStudioHandOff
            kind={handOff.kind}
            secret={handOff.issued?.secret ?? null}
            expiresAt={handOff.issued?.expiresAt ?? null}
            sinkId={status.sinkId ?? sinkId}
            address={status.address ?? address}
            identity={status.identity?.name ?? ''}
            space={handOff.space}
            bridgeOn={status.bridgeOn}
            {...(handOff.oldToken === null || status.identity === null
              ? {}
              : {
                  onRevokeOld: async () => {
                    const { response } = await client.DELETE('/v1/principals/{id}/tokens/{token}', {
                      params: { path: { id: status.identity!.id, token: handOff.oldToken! } },
                    });
                    if (!response.ok) throw new Error(String(response.status));
                  },
                })}
            onDone={() => setHandOff(null)}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * Connect CT Studio, a step at a time: the space, CT Studio's identity the first time (made, or adopted
 * with the token CT Studio holds), what deliveries become, and the address and sink id to hand over.
 */
function ConnectFlow({
  client,
  status,
  address: suggested,
  sinkId: suggestedSink,
  onClose,
  onConnected,
}: {
  client: Client;
  status: Status;
  address: string;
  sinkId: string;
  onClose: () => void;
  onConnected: (answer: Connected, first: boolean) => void;
}) {
  const first = status.identity === null;
  const [step, setStep] = useState<'space' | 'identity' | 'settings' | 'address'>('space');
  const [spaces, setSpaces] = useState<readonly { id: string; name: string }[]>([]);
  const [space, setSpace] = useState('');
  const [how, setHow] = useState<'make' | 'adopt'>('make');
  const [identities, setIdentities] = useState<readonly { id: string; name: string }[]>([]);
  const [adopt, setAdopt] = useState('');
  const [tokens, setTokens] = useState<readonly { id: string; name: string; expiresAt: string }[]>(
    [],
  );
  const [token, setToken] = useState('');
  const [settings, setSettings] = useState<BridgeSettingsBody | null>(null);
  const [address, setAddress] = useState(suggested);
  const [sinkId, setSinkId] = useState(suggestedSink);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    const connected = new Set(status.spaces.map((each) => each.id));
    everyPage<{ id: string; name: string }>((cursor) =>
      client.GET('/v1/spaces', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((answer) => {
        if (current && 'items' in answer) {
          setSpaces(answer.items.filter((each) => !connected.has(each.id)));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, status]);

  useEffect(() => {
    if (!first || how !== 'adopt') return undefined;
    let current = true;
    everyPage<{ id: string; name: string; disabledAt: string | null }>((cursor) =>
      client.GET('/v1/service-identities', {
        params: { query: cursor === undefined ? {} : { cursor } },
      }),
    )
      .then((answer) => {
        if (current && 'items' in answer) {
          setIdentities(answer.items.filter((each) => each.disabledAt === null));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, first, how]);

  useEffect(() => {
    if (adopt === '') return undefined;
    let current = true;
    everyPage<{ id: string; name: string; expiresAt: string }>((cursor) =>
      client.GET('/v1/principals/{id}/tokens', {
        params: { path: { id: adopt }, query: cursor === undefined ? {} : { cursor } },
      }),
    )
      .then((answer) => {
        if (!current || !('items' in answer)) return;
        const live = answer.items.filter((each) => Date.parse(each.expiresAt) > Date.now());
        setTokens(live);
        // The one that expires last, as the likeliest CT Studio holds (the design).
        const last = [...live].sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
        setToken(last[0]?.id ?? '');
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, adopt]);

  const keep = useCallback((body: BridgeSettingsBody) => setSettings(body), []);
  const addresses = [
    ...new Set(
      [
        suggested,
        ...status.hostnames.filter((each) => !loopback(each)).map((each) => `https://${each}`),
      ].filter(reachable),
    ),
  ];

  async function connect() {
    if (settings === null) return;
    setBusy(true);
    setSaid('');
    try {
      const { data, error } = await client.POST('/v1/ct-studio/connections', {
        body: {
          space,
          identity: !first ? null : how === 'make' ? { make: true } : { adopt, token },
          settings,
          address: new URL(address).origin,
          sinkId,
        },
      });
      if (!data) {
        setSaid(refusal(error, say('admin.the-space-could-not-be-connected')));
        return;
      }
      // Data on: the connection is tested at once, so Describe and Sample work from the start.
      if (settings.data && data.settings.connection !== null) {
        await client
          .POST('/v1/connections/{id}/test', {
            params: { path: { id: data.settings.connection } },
            body: {},
          })
          .catch(() => undefined);
      }
      onConnected(data, first);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="ct-studio-connect" size="wide" onClose={onClose}>
      <h2 id="ct-studio-connect">{say('admin.connect-a-space-to-ct-studio')}</h2>
      {step === 'space' && (
        <>
          <label className={styles['filter']}>
            {say('admin.space')}
            <select value={space} onChange={(change) => setSpace(change.target.value)}>
              <option value="">{say('admin.choose-a-space')}</option>
              {spaces.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={space === ''}
            onClick={() => setStep(first ? 'identity' : 'settings')}
          >
            {say('admin.next')}
          </button>
        </>
      )}
      {step === 'identity' && (
        <>
          <fieldset>
            <legend>{say('admin.the-identity-ct-studio-delivers-as')}</legend>
            <label className={styles['check']}>
              <input
                type="radio"
                name="ct-studio-identity"
                checked={how === 'make'}
                onChange={() => setHow('make')}
              />
              {say('admin.make-a-new-identity')}
            </label>
            <label className={styles['check']}>
              <input
                type="radio"
                name="ct-studio-identity"
                checked={how === 'adopt'}
                onChange={() => setHow('adopt')}
              />
              {say('admin.adopt-an-identity-made-by-hand')}
            </label>
          </fieldset>
          {how === 'adopt' && (
            <>
              <label className={styles['filter']}>
                {say('admin.identity')}
                <select value={adopt} onChange={(change) => setAdopt(change.target.value)}>
                  <option value="">{say('admin.choose-an-identity')}</option>
                  {identities.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles['filter']}>
                {say('admin.token-ct-studio-holds')}
                <select value={token} onChange={(change) => setToken(change.target.value)}>
                  {tokens.map((each) => (
                    <option key={each.id} value={each.id}>
                      {say('admin.token-expiring', { name: each.name, date: when(each.expiresAt) })}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            disabled={how === 'adopt' && (adopt === '' || token === '')}
            onClick={() => setStep('settings')}
          >
            {say('admin.next')}
          </button>
        </>
      )}
      {step === 'settings' && (
        <>
          <CtStudioSettings client={client} space={space} mode="flow" onChange={keep} />
          <button type="button" disabled={settings === null} onClick={() => setStep('address')}>
            {say('admin.next')}
          </button>
        </>
      )}
      {step === 'address' && (
        <>
          <label className={styles['filter']}>
            {say('admin.address-ct-studio-reaches-this-environment-at')}
            <input
              type="url"
              list="ct-studio-addresses"
              value={address}
              spellCheck={false}
              aria-describedby="ct-studio-address-hint"
              onChange={(change) => setAddress(change.target.value.trim())}
            />
            <datalist id="ct-studio-addresses">
              {addresses.map((each) => (
                <option key={each} value={each} />
              ))}
            </datalist>
          </label>
          <p id="ct-studio-address-hint">{say('admin.ct-studio-address-hint')}</p>
          <label className={styles['filter']}>
            {say('admin.sink-id')}
            <input value={sinkId} onChange={(change) => setSinkId(change.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy || !reachable(address)}
            onClick={() => void connect()}
          >
            {say('admin.connect')}
          </button>
        </>
      )}
      <p role="status">{said}</p>
    </Modal>
  );
}
