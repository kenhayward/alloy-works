import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** The channel as the service answers it (mail.md; the EM plan), never its password. */
interface Channel {
  readonly enabled: boolean;
  readonly relay: 'platform' | 'own';
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  readonly hasPassword: boolean;
  readonly failingSince: string | null;
  readonly lastSuccessAt: string | null;
  /** The kinds of notification it never mails (COL-060); absent from a service before EMc. */
  readonly kindsOff?: readonly MailKind[];
}

type MailKind = 'mention' | 'reply' | 'resolution' | 'round' | 'digest';

/** Each kind of notification an environment may mail, in the order a person chooses among them. */
const MAIL_KINDS: readonly { readonly kind: MailKind; readonly name: () => string }[] = [
  { kind: 'mention', name: () => words('admin.email-kind-mention') },
  { kind: 'reply', name: () => words('admin.email-kind-reply') },
  { kind: 'resolution', name: () => words('admin.email-kind-resolution') },
  { kind: 'round', name: () => words('admin.email-kind-round') },
  { kind: 'digest', name: () => words('admin.email-kind-digest') },
];

interface Read {
  readonly channel: Channel;
  readonly platform: { readonly offered: boolean; readonly fromAddress?: string };
}

interface Sent {
  readonly id: string;
  readonly purpose: 'test' | 'notification' | 'invitation' | 'closure';
  readonly state: 'pending' | 'sent' | 'given_up' | 'dropped';
  readonly droppedReason: string | null;
  readonly attempts: number;
  readonly createdAt: string;
  readonly last: {
    readonly at: string;
    readonly failure: string | null;
    readonly smtpCode: number | null;
  } | null;
}

interface Listed {
  readonly items: readonly Sent[];
  readonly counts: {
    readonly waiting: number;
    readonly sent: number;
    readonly givenUp: number;
    readonly dropped: Readonly<Record<string, number>>;
  };
}

interface Draft {
  enabled: boolean;
  relay: 'platform' | 'own';
  host: string;
  port: '465' | '587';
  username: string;
  fromAddress: string;
  fromName: string;
  kindsOff: readonly MailKind[];
}

const draftOf = ({ channel }: Read): Draft => ({
  enabled: channel.enabled,
  relay: channel.relay,
  host: channel.host ?? '',
  port: channel.port === 465 ? '465' : '587',
  username: channel.username ?? '',
  fromAddress: channel.fromAddress ?? '',
  fromName: channel.fromName ?? '',
  kindsOff: channel.kindsOff ?? [],
});

const PURPOSES: Readonly<Record<Sent['purpose'], string>> = {
  get test() {
    return words('admin.email-purpose-test');
  },
  get notification() {
    return words('admin.email-purpose-notification');
  },
  get invitation() {
    return words('admin.email-purpose-invitation');
  },
  get closure() {
    return words('admin.email-purpose-closure');
  },
};

const STATES: Readonly<Record<Sent['state'], string>> = {
  get pending() {
    return words('admin.waiting');
  },
  get sent() {
    return words('admin.email-state-sent');
  },
  get given_up() {
    return words('admin.given-up');
  },
  get dropped() {
    return words('admin.email-state-dropped');
  },
};

const moment = (iso: string) =>
  formats().date(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * **Administration's Email** (the EM plan, EMb): whether this environment sends mail and by whose
 * relay, its own relay's password set write-only, a test to the reader's own address, and what was
 * sent, waits or was not sent these 30 days, by code alone. Read and changed by those who may
 * configure its services; the password by those who may rotate its secrets.
 */
export function Mail({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const id = useId();
  const [read, setRead] = useState<Read | 'failed' | 'refused' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [password, setPassword] = useState('');
  const [listed, setListed] = useState<Listed | 'failed' | null>(null);
  const [said, setSaid] = useState('');
  const [passwordSaid, setPasswordSaid] = useState('');
  const [testSaid, setTestSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const shown = (answer: Read) => {
    setRead(answer);
    setDraft(draftOf(answer));
  };

  const list = useCallback(async () => {
    try {
      const { data } = await client.GET('/v1/mail-channel/mail', { params: { query: {} } });
      setListed(data ?? 'failed');
    } catch {
      setListed('failed');
    }
  }, [client]);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/mail-channel')
      .then(({ data, response }) => {
        if (!current) return;
        if (data) {
          shown(data);
          void list();
        } else setRead(response.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client, list]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null) return;
    setBusy(true);
    setSaid('');
    try {
      const own = draft.relay === 'own';
      const { data, error } = await client.PUT('/v1/mail-channel', {
        body: {
          enabled: draft.enabled,
          relay: draft.relay,
          ...(own
            ? {
                host: draft.host.trim(),
                port: draft.port === '465' ? 465 : 587,
                username: draft.username.trim() === '' ? null : draft.username.trim(),
                fromAddress: draft.fromAddress.trim(),
              }
            : {}),
          fromName: draft.fromName.trim() === '' ? null : draft.fromName.trim(),
          kindsOff: [...draft.kindsOff],
        },
      });
      if (data) {
        shown(data);
        setSaid(words('admin.saved'));
      } else setSaid(refusal(error, words('admin.email-could-not-save')));
    } catch {
      setSaid(words('admin.email-could-not-save'));
    } finally {
      setBusy(false);
    }
  };

  const setThePassword = async () => {
    setBusy(true);
    setPasswordSaid('');
    try {
      const { data, error } = await client.PUT('/v1/mail-channel/password', {
        body: { password },
      });
      if (data) {
        shown(data);
        setPassword('');
        setPasswordSaid(words('admin.email-password-set'));
      } else setPasswordSaid(refusal(error, words('admin.email-password-failed')));
    } catch {
      setPasswordSaid(words('admin.email-password-failed'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setTestSaid('');
    try {
      const { data, error } = await client.POST('/v1/mail-channel/test');
      if (data) {
        setTestSaid(words('admin.email-test-queued'));
        await list();
      } else setTestSaid(refusal(error, words('admin.email-test-failed')));
    } catch {
      setTestSaid(words('admin.email-test-failed'));
    } finally {
      setBusy(false);
    }
  };

  if (read === null || (draft === null && typeof read === 'object')) {
    return <Waiting>{words('admin.loading')}</Waiting>;
  }
  if (read === 'refused') {
    return (
      <Notice tone="failed">
        <p>{words('admin.email-refused')}</p>
      </Notice>
    );
  }
  if (read === 'failed' || draft === null) {
    return (
      <Notice tone="failed">
        <p>{words('admin.email-could-not-load')}</p>
      </Notice>
    );
  }
  const { channel, platform } = read;
  const own = draft.relay === 'own';
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const held = channel.relay === 'own' && channel.username !== null;

  return (
    <div className={styles['mailPage']}>
      <p className={styles['muted']}>{words('admin.email-intro')}</p>
      {channel.failingSince !== null && (
        <Notice tone="failed">
          <p>{words('admin.email-failing', { at: moment(channel.failingSince) })}</p>
        </Notice>
      )}
      {channel.lastSuccessAt !== null && channel.failingSince === null && (
        <p className={styles['muted']}>
          {words('admin.email-last-sent', { at: moment(channel.lastSuccessAt) })}
        </p>
      )}
      <form className={styles['settings']} onSubmit={(event) => void save(event)}>
        <label className={styles['setting']}>
          <span>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!mayChange}
              onChange={(event) => set({ enabled: event.target.checked })}
            />{' '}
            {words('admin.email-on')}
          </span>
        </label>
        <fieldset>
          <legend className={styles['strong']}>{words('admin.email-relay')}</legend>
          <label className={styles['setting']}>
            <span>
              <input
                type="radio"
                name={`${id}-relay`}
                checked={draft.relay === 'platform'}
                disabled={!mayChange || (!platform.offered && channel.relay !== 'platform')}
                onChange={() => set({ relay: 'platform' })}
              />{' '}
              {words('admin.email-platform')}
            </span>
            <span className={styles['muted']}>
              {platform.offered && platform.fromAddress !== undefined ? (
                <span data-content>
                  {words('admin.email-platform-from', { address: platform.fromAddress })}
                </span>
              ) : (
                words('admin.email-platform-none')
              )}
            </span>
          </label>
          <label className={styles['setting']}>
            <span>
              <input
                type="radio"
                name={`${id}-relay`}
                checked={own}
                disabled={!mayChange}
                onChange={() => set({ relay: 'own' })}
              />{' '}
              {words('admin.email-own')}
            </span>
            <span className={styles['muted']}>{words('admin.email-own-hint')}</span>
          </label>
        </fieldset>
        {own && (
          <fieldset className={styles['settings']}>
            <legend className={styles['strong']}>{words('admin.email-own-relay')}</legend>
            <div className={`${styles['setting']} ${styles['settingWide']}`}>
              <label htmlFor={`${id}-host`}>{words('admin.email-host')}</label>
              <input
                id={`${id}-host`}
                required
                value={draft.host}
                disabled={!mayChange}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => set({ host: event.target.value })}
              />
            </div>
            <div className={styles['setting']}>
              <label htmlFor={`${id}-port`}>{words('admin.email-port')}</label>
              <select
                id={`${id}-port`}
                value={draft.port}
                disabled={!mayChange}
                onChange={(event) => set({ port: event.target.value as Draft['port'] })}
              >
                <option value="587">{words('admin.email-port-587')}</option>
                <option value="465">{words('admin.email-port-465')}</option>
              </select>
            </div>
            <div className={`${styles['setting']} ${styles['settingWide']}`}>
              <label htmlFor={`${id}-username`}>{words('admin.email-username')}</label>
              <input
                id={`${id}-username`}
                value={draft.username}
                disabled={!mayChange}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-username-hint`}
                onChange={(event) => set({ username: event.target.value })}
              />
              <span id={`${id}-username-hint`} className={styles['muted']}>
                {words('admin.email-username-hint')}
              </span>
            </div>
            <div className={`${styles['setting']} ${styles['settingWide']}`}>
              <label htmlFor={`${id}-from`}>{words('admin.email-from-address')}</label>
              <input
                id={`${id}-from`}
                type="email"
                required
                value={draft.fromAddress}
                disabled={!mayChange}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-from-hint`}
                onChange={(event) => set({ fromAddress: event.target.value })}
              />
              <span id={`${id}-from-hint`} className={styles['muted']}>
                {words('admin.email-from-address-hint')}
              </span>
            </div>
          </fieldset>
        )}
        <div className={`${styles['setting']} ${styles['settingWide']}`}>
          <label htmlFor={`${id}-name`}>{words('admin.email-from-name')}</label>
          <input
            id={`${id}-name`}
            value={draft.fromName}
            disabled={!mayChange}
            aria-describedby={`${id}-name-hint`}
            onChange={(event) => set({ fromName: event.target.value })}
          />
          <span id={`${id}-name-hint`} className={styles['muted']}>
            {words('admin.email-from-name-hint')}
          </span>
        </div>
        <fieldset>
          <legend className={styles['strong']}>{words('admin.email-kinds')}</legend>
          {MAIL_KINDS.map(({ kind, name }) => (
            <label key={kind} className={styles['setting']}>
              <span>
                <input
                  type="checkbox"
                  checked={!draft.kindsOff.includes(kind)}
                  disabled={!mayChange}
                  onChange={(event) =>
                    set({
                      kindsOff: MAIL_KINDS.map((each) => each.kind).filter((each) =>
                        each === kind ? !event.target.checked : draft.kindsOff.includes(each),
                      ),
                    })
                  }
                />{' '}
                {name()}
              </span>
            </label>
          ))}
          <p className={styles['muted']}>{words('admin.email-kinds-hint')}</p>
        </fieldset>
        <p role="status">{said}</p>
        {mayChange ? (
          <div>
            <button type="submit" className="primary" disabled={busy}>
              {words('admin.save')}
            </button>
          </div>
        ) : (
          <p className={styles['muted']}>{words('admin.email-only-configure')}</p>
        )}
      </form>
      {held && (
        <section className={styles['settings']} aria-labelledby={`${id}-password-heading`}>
          <h3 id={`${id}-password-heading`} className={styles['strong']}>
            {words('admin.email-password')}
          </h3>
          <p className={styles['muted']}>
            {channel.hasPassword
              ? words('admin.email-password-held')
              : words('admin.email-password-none')}
          </p>
          <div className={`${styles['setting']} ${styles['settingWide']}`}>
            <label htmlFor={`${id}-password`}>{words('admin.email-new-password')}</label>
            <input
              id={`${id}-password`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <p role="status">{passwordSaid}</p>
          <div>
            <button
              type="button"
              disabled={busy || password === ''}
              onClick={() => void setThePassword()}
            >
              {words('admin.email-set-password')}
            </button>
          </div>
        </section>
      )}
      <section className={styles['settings']} aria-labelledby={`${id}-test-heading`}>
        <h3 id={`${id}-test-heading`} className={styles['strong']}>
          {words('admin.email-test-heading')}
        </h3>
        <p className={styles['muted']}>{words('admin.email-test-hint')}</p>
        <p role="status">{testSaid}</p>
        <div>
          <button type="button" disabled={busy} onClick={() => void test()}>
            {words('admin.email-test')}
          </button>
        </div>
      </section>
      <section aria-labelledby={`${id}-mail-heading`}>
        <h3 id={`${id}-mail-heading`} className={styles['strong']}>
          {words('admin.email-recent')}
        </h3>
        <Recent listed={listed} label={words('admin.email-recent')} />
        <div>
          <button type="button" onClick={() => void list()}>
            {words('admin.email-refresh')}
          </button>
        </div>
      </section>
    </div>
  );
}

/** What was sent, waits or was not sent, by code alone: never an address or the relay's words. */
function Recent({ listed, label }: { listed: Listed | 'failed' | null; label: string }) {
  if (listed === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (listed === 'failed') {
    return <p className={styles['muted']}>{words('admin.email-could-not-list')}</p>;
  }
  const dropped = Object.values(listed.counts.dropped).reduce((sum, each) => sum + each, 0);
  return (
    <>
      <p className={styles['muted']}>
        {words('admin.email-counts', {
          waiting: listed.counts.waiting,
          sent: listed.counts.sent,
          givenUp: listed.counts.givenUp,
          dropped,
        })}
      </p>
      {listed.items.length === 0 ? (
        <p className={styles['muted']}>{words('admin.email-none-yet')}</p>
      ) : (
        <table aria-label={label} className={styles['table']}>
          <thead>
            <tr>
              <th scope="col" className={styles['statusColumn']}>
                {words('admin.email-purpose')}
              </th>
              <th scope="col">{words('admin.state')}</th>
              <th scope="col" className={styles['statusColumn']}>
                {words('admin.attempts')}
              </th>
              <th scope="col">{words('admin.queued')}</th>
              <th scope="col">{words('admin.email-last-attempt')}</th>
            </tr>
          </thead>
          <tbody>
            {listed.items.map((each) => (
              <tr key={each.id}>
                <td>{PURPOSES[each.purpose]}</td>
                <td className={styles['wraps']}>
                  {STATES[each.state]}
                  {each.droppedReason !== null && (
                    <>
                      {' '}
                      <span className={styles['code']}>{each.droppedReason}</span>
                    </>
                  )}
                </td>
                <td>{formats().number(each.attempts)}</td>
                <td>
                  <time dateTime={each.createdAt}>{moment(each.createdAt)}</time>
                </td>
                <td className={styles['wraps']}>
                  {each.last === null
                    ? words('admin.not-tried-yet')
                    : words('admin.email-attempt', {
                        at: moment(each.last.at),
                        failed: each.last.failure === null ? 'no' : 'yes',
                        failure: each.last.failure ?? '',
                        coded: each.last.smtpCode === null ? 'no' : 'yes',
                        code: each.last.smtpCode ?? 0,
                      })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
