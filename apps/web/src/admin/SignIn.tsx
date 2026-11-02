import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { RowActions } from '../parts/RowActions.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { notYours } from './listing.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export interface ShownProvider {
  readonly id: string;
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly groupsClaim: string;
  readonly closed: boolean;
}

export interface ShownSignIn {
  readonly providers: readonly ShownProvider[];
  readonly google: {
    readonly available: boolean;
    readonly open: boolean;
    readonly domains: readonly string[];
  };
  readonly sessions: { readonly idleMinutes: number; readonly absoluteHours: number };
  readonly redirectUri: string;
  readonly recentSignIn: boolean;
  readonly signedInThrough: {
    readonly route: 'organisation' | 'google';
    readonly provider: string | null;
  } | null;
}

type Answer = {
  readonly data?: ShownSignIn | undefined;
  readonly error?: unknown;
};

/** The page's address after `#/`, which a sign-in made again comes back to. */
const THIS_PAGE = 'admin/sign-in';

/** A sign-in asked for by what was asked of the service: said, and answered by asking again. */
const needsSignIn = (error: unknown) =>
  (error as { code?: unknown } | undefined)?.code === 'reauthentication_required';

/** Adding a provider: what the customer registered, and where it returns. */
function AddProvider({
  redirectUri,
  another,
  send,
  onClose,
}: {
  redirectUri: string;
  /** Whether one is open already, so a second's effect on connections is said. */
  another: boolean;
  send: (body: {
    name: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    groupsClaim?: string;
  }) => Promise<string | null>;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [groupsClaim, setGroupsClaim] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if ([name, issuer, clientId, clientSecret].some((each) => each.trim() === '')) {
      setSaid(words('admin.signin-give-all'));
      return;
    }
    setBusy(true);
    const refused = await send({
      name: name.trim(),
      issuer: issuer.trim(),
      clientId: clientId.trim(),
      clientSecret,
      ...(groupsClaim.trim() === '' ? {} : { groupsClaim: groupsClaim.trim() }),
    });
    setBusy(false);
    if (refused !== null) setSaid(refused);
  };
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void add(event)}>
        <h2 id={id}>{words('admin.signin-add-provider')}</h2>
        <p className={styles['muted']}>{words('admin.signin-register-this-address')}</p>
        <p>
          <code data-content>{redirectUri}</code>
        </p>
        <label>
          {words('admin.name')}
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {words('admin.signin-issuer')}
          <input
            type="url"
            value={issuer}
            maxLength={2000}
            onChange={(event) => setIssuer(event.target.value)}
          />
        </label>
        <label>
          {words('admin.signin-client-id')}
          <input
            value={clientId}
            maxLength={500}
            onChange={(event) => setClientId(event.target.value)}
          />
        </label>
        <label>
          {words('admin.signin-client-secret')}
          <input
            type="password"
            autoComplete="off"
            value={clientSecret}
            maxLength={2000}
            onChange={(event) => setClientSecret(event.target.value)}
          />
        </label>
        <label>
          {words('admin.signin-groups-claim')}
          <input
            value={groupsClaim}
            maxLength={100}
            placeholder="groups"
            onChange={(event) => setGroupsClaim(event.target.value)}
          />
        </label>
        {another && <p className={styles['muted']}>{words('admin.signin-another-provider')}</p>}
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.signin-add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One value of a provider's asked for and sent: a new name, or a secret never shown back. */
function OneValue({
  heading,
  label,
  secret,
  start,
  send,
  onClose,
}: {
  heading: string;
  label: string;
  secret: boolean;
  start: string;
  send: (value: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(start);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (value.trim() === '') {
      setSaid(words('admin.signin-give-all'));
      return;
    }
    setBusy(true);
    const refused = await send(secret ? value : value.trim());
    setBusy(false);
    if (refused !== null) setSaid(refused);
  };
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void save(event)}>
        <h2 id={id}>{heading}</h2>
        <label>
          {label}
          <input
            type={secret ? 'password' : 'text'}
            autoComplete="off"
            value={value}
            maxLength={2000}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * **Administration's Sign-in** (identity.md; the ID plan, IDb): the providers, the Google route and the
 * session lifetimes. Anything changed needs a sign-in in the last ten minutes, asked for as the page
 * opens, before any form, so nothing typed is lost to the trip to the provider (IN-D).
 */
export function SignIn({ client }: { client: Client }) {
  const [read, setRead] = useState<ShownSignIn | 'refused' | 'failed' | null>(null);
  const [said, setSaid] = useState('');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ShownProvider | null>(null);
  const [replacing, setReplacing] = useState<ShownProvider | null>(null);
  const [closing, setClosing] = useState<ShownProvider | null>(null);
  const [google, setGoogle] = useState({ open: false, domains: '' });
  const [sessions, setSessions] = useState({ idleMinutes: '', absoluteHours: '' });
  const [asking, setAsking] = useState(false);

  const take = useCallback((settings: ShownSignIn) => {
    setRead(settings);
    setGoogle({ open: settings.google.open, domains: settings.google.domains.join('\n') });
    setSessions({
      idleMinutes: String(settings.sessions.idleMinutes),
      absoluteHours: String(settings.sessions.absoluteHours),
    });
  }, []);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/sign-in-settings')
      .then(({ data, response }) => {
        if (!current) return;
        if (data) take(data as ShownSignIn);
        else setRead(response.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client, take]);

  const signInAgain = async () => {
    setAsking(true);
    try {
      const { data, error } = await client.POST('/v1/sessions/current/reauthentication', {
        body: { to: THIS_PAGE },
      });
      if (data) {
        window.location.assign(data.url);
        return;
      }
      setSaid(refusal(error, words('admin.signin-could-not-ask')));
    } catch {
      setSaid(words('admin.signin-could-not-ask'));
    }
    setAsking(false);
  };

  /** Takes a change's answer: what stands now, or the words a dialog should say and stay open with. */
  const settle = (answer: Answer, failed: string, done: string): string | null => {
    if (answer.data) {
      take(answer.data);
      setSaid(done);
      return null;
    }
    if (needsSignIn(answer.error)) {
      // The ten minutes ran out with the page open: the page asks again, and what was typed stays.
      setRead((was) =>
        was !== null && typeof was === 'object' ? { ...was, recentSignIn: false } : was,
      );
    }
    return refusal(answer.error, failed);
  };

  const attempt = async (run: () => Promise<Answer>, failed: string, done: string) => {
    try {
      return settle(await run(), failed, done);
    } catch {
      return failed;
    }
  };

  if (read === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (read === 'refused') {
    return (
      <Notice tone="refused">
        <p>{notYours()}</p>
      </Notice>
    );
  }
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('admin.signin-could-not-load')}</p>
      </Notice>
    );
  }

  const fresh = read.recentSignIn;
  const open = read.providers.filter((each) => !each.closed);
  const own = read.signedInThrough;
  const saveGoogle = async (event: React.FormEvent) => {
    event.preventDefault();
    const refused = await attempt(
      () =>
        client.PUT('/v1/sign-in-settings/google', {
          body: {
            open: google.open,
            domains: google.domains
              .split(/\s+/)
              .map((each) => each.trim())
              .filter((each) => each !== ''),
          },
        }) as Promise<Answer>,
      words('admin.signin-google-could-not'),
      words('admin.saved'),
    );
    if (refused !== null) setSaid(refused);
  };
  const saveSessions = async (event: React.FormEvent) => {
    event.preventDefault();
    const refused = await attempt(
      () =>
        client.PUT('/v1/sign-in-settings/sessions', {
          body: {
            idleMinutes: Number(sessions.idleMinutes),
            absoluteHours: Number(sessions.absoluteHours),
          },
        }) as Promise<Answer>,
      words('admin.signin-sessions-could-not'),
      words('admin.saved'),
    );
    if (refused !== null) setSaid(refused);
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.signin-lead')}</p>
        <button
          type="button"
          className="primary"
          disabled={!fresh}
          onClick={() => setAdding(true)}
        >
          {words('admin.signin-add-provider')}
        </button>
      </div>
      {!fresh && (
        <Notice tone="signedOut">
          <p>{words('admin.signin-needs-recent')}</p>
          <button type="button" disabled={asking} onClick={() => void signInAgain()}>
            {words('admin.signin-again')}
          </button>
        </Notice>
      )}
      <h3>{words('admin.signin-providers')}</h3>
      <table aria-label={words('admin.signin-providers')} className={styles['table']}>
        <colgroup>
          <col />
          <col />
          <col className={styles['statusColumn']} />
          <col className={styles['actionsColumn']} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{words('admin.name')}</th>
            <th scope="col">{words('admin.signin-issuer')}</th>
            <th scope="col">{words('admin.status')}</th>
            <th scope="col">
              <span className={styles['hidden']}>{words('admin.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {read.providers.map((provider) => (
            <tr key={provider.id}>
              <td data-content>{provider.name}</td>
              <td data-content>{provider.issuer}</td>
              <td>
                {provider.closed ? (
                  <Chip>{words('admin.signin-closed')}</Chip>
                ) : own?.provider === provider.id ? (
                  <Chip tone="info">{words('admin.signin-your-session')}</Chip>
                ) : (
                  <Chip tone="ok">{words('admin.signin-open')}</Chip>
                )}
              </td>
              <td>
                {!provider.closed && (
                  <RowActions
                    subject={provider.name}
                    shown={[
                      {
                        label: words('admin.rename-2'),
                        name: words('admin.rename', { name: provider.name }),
                        icon: 'Rename',
                        onSelect: () => setRenaming(provider),
                        ...(fresh ? {} : { unavailable: words('admin.signin-needs-recent') }),
                      },
                    ]}
                    more={
                      fresh
                        ? [
                            {
                              label: words('admin.signin-replace-secret'),
                              onSelect: () => setReplacing(provider),
                            },
                            ...(own?.provider === provider.id
                              ? []
                              : [
                                  {
                                    label: words('admin.signin-close'),
                                    danger: true,
                                    onSelect: () => setClosing(provider),
                                  },
                                ]),
                          ]
                        : []
                    }
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {read.providers.length === 0 && <p className={styles['muted']}>{words('admin.signin-none')}</p>}
      {read.google.available && (
        <form className={styles['settings']} onSubmit={(event) => void saveGoogle(event)}>
          <h3>{words('admin.signin-google')}</h3>
          <label className={styles['setting']}>
            <span>
              <input
                type="checkbox"
                checked={google.open}
                disabled={!fresh}
                onChange={(event) => setGoogle({ ...google, open: event.target.checked })}
              />{' '}
              {words('admin.signin-google-open')}
            </span>
          </label>
          <label className={styles['setting']}>
            {words('admin.signin-google-domains')}
            <textarea
              value={google.domains}
              disabled={!fresh}
              rows={3}
              onChange={(event) => setGoogle({ ...google, domains: event.target.value })}
            />
            <span className={styles['muted']}>{words('admin.signin-google-domains-hint')}</span>
          </label>
          <div>
            <button type="submit" disabled={!fresh}>
              {words('admin.signin-save-google')}
            </button>
          </div>
        </form>
      )}
      <form className={styles['settings']} onSubmit={(event) => void saveSessions(event)}>
        <h3>{words('admin.signin-sessions')}</h3>
        <label className={styles['setting']}>
          {words('admin.signin-idle')}
          <input
            type="number"
            min={5}
            max={1440}
            value={sessions.idleMinutes}
            disabled={!fresh}
            onChange={(event) => setSessions({ ...sessions, idleMinutes: event.target.value })}
          />
        </label>
        <label className={styles['setting']}>
          {words('admin.signin-absolute')}
          <input
            type="number"
            min={1}
            max={720}
            value={sessions.absoluteHours}
            disabled={!fresh}
            onChange={(event) => setSessions({ ...sessions, absoluteHours: event.target.value })}
          />
        </label>
        <p className={styles['muted']}>{words('admin.signin-sessions-hint')}</p>
        <div>
          <button type="submit" disabled={!fresh}>
            {words('admin.signin-save-sessions')}
          </button>
        </div>
      </form>
      <p role="status">{said}</p>
      {adding && (
        <AddProvider
          redirectUri={read.redirectUri}
          another={open.length > 0}
          onClose={() => setAdding(false)}
          send={async (body) => {
            const refused = await attempt(
              () =>
                client.POST('/v1/sign-in-settings/providers', { body }) as Promise<Answer>,
              words('admin.signin-could-not-add'),
              words('admin.signin-added', { name: body.name }),
            );
            if (refused === null) setAdding(false);
            return refused;
          }}
        />
      )}
      {renaming !== null && (
        <OneValue
          heading={words('admin.rename', { name: renaming.name })}
          label={words('admin.name')}
          secret={false}
          start={renaming.name}
          onClose={() => setRenaming(null)}
          send={async (name) => {
            const refused = await attempt(
              () =>
                client.PUT('/v1/sign-in-settings/providers/{id}', {
                  params: { path: { id: renaming.id } },
                  body: { name },
                }) as Promise<Answer>,
              words('admin.signin-could-not-rename'),
              words('admin.saved'),
            );
            if (refused === null) setRenaming(null);
            return refused;
          }}
        />
      )}
      {replacing !== null && (
        <OneValue
          heading={words('admin.signin-replace-secret-of', { name: replacing.name })}
          label={words('admin.signin-client-secret')}
          secret
          start=""
          onClose={() => setReplacing(null)}
          send={async (clientSecret) => {
            const refused = await attempt(
              () =>
                client.PUT('/v1/sign-in-settings/providers/{id}/secret', {
                  params: { path: { id: replacing.id } },
                  body: { clientSecret },
                }) as Promise<Answer>,
              words('admin.signin-could-not-replace'),
              words('admin.signin-replaced', { name: replacing.name }),
            );
            if (refused === null) setReplacing(null);
            return refused;
          }}
        />
      )}
      {closing !== null && (
        <ConfirmDialog
          question={words('admin.signin-close-question', { name: closing.name })}
          sentence={words('admin.signin-close-sentence')}
          keep={words('admin.keep-it')}
          act={words('admin.signin-close')}
          onKeep={() => setClosing(null)}
          onAct={async () => {
            const refused = await attempt(
              () =>
                client.POST('/v1/sign-in-settings/providers/{id}/closure', {
                  params: { path: { id: closing.id } },
                }) as Promise<Answer>,
              words('admin.signin-could-not-close'),
              words('admin.signin-closed-it', { name: closing.name }),
            );
            if (refused !== null) setSaid(refused);
            setClosing(null);
          }}
        />
      )}
    </>
  );
}
