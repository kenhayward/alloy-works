import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { Notice } from '../states/Notice.js';
import styles from './ConnectionPage.module.css';
import { connectionAccessLink } from './links.js';
import {
  SettingsFields,
  TLS_LABELS,
  draftOf,
  draftProblem,
  settingsOf,
  type Draft,
} from './SettingsFields.js';
import {
  asBody,
  isConnectionView,
  isRecord,
  isRelations,
  isTested,
  longDate,
  nameOf,
  refusalText,
  type ConnectionView,
  type Relation,
  type Settings,
  type Tested,
} from './shapes.js';

type Client = ReturnType<typeof createApiClient>;

const FINDINGS: Readonly<Record<string, string>> = {
  account_not_read_only:
    'This account can change data at the source, so SQL written by hand will not be allowed on this connection.',
};

const KINDS: Readonly<Record<string, string>> = {
  table: 'Table',
  view: 'View',
  materializedView: 'Materialised view',
  foreignTable: 'Foreign table',
  partitionedTable: 'Partitioned table',
};

/**
 * A test's answer in words (DAT-075): "Connected." and what it found of the account, or "Could not
 * connect." and the one reason the service gave, which names no address and repeats no credential.
 */
function TestAnswer({ tested }: { readonly tested: Tested | string | null }) {
  if (tested === null) return <p role="status" />;
  if (typeof tested === 'string') {
    return (
      <div role="status">
        <p>{tested}</p>
      </div>
    );
  }
  if (tested.outcome === 'ok') {
    return (
      <div role="status">
        <p>Connected.</p>
        {tested.findings.map((finding) => (
          <p key={finding}>{FINDINGS[finding] ?? finding}</p>
        ))}
      </div>
    );
  }
  return (
    <div role="status">
      <p>Could not connect.</p>
      <p>{tested.failure.message}</p>
    </div>
  );
}

/**
 * Whether the credential is set, by whom and when - and, where the connection has since been pointed
 * somewhere else to sign in, that it will not be used until it is set again (the D1 fix, C3).
 */
function credentialText(credential: ConnectionView['credential']): string {
  if (!credential.set) return 'Not set.';
  const set = `Set by ${nameOf(credential.setBy)} on ${longDate(credential.setAt)}`;
  return credential.targetChanged
    ? `${set}, before the host, port, database, account or TLS changed. Set the password again to use this connection.`
    : `${set}.`;
}

/** One of the page's parts, a region named by its heading. */
function Part({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles['part']}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function SettingsList({ settings }: { readonly settings: Settings }) {
  return (
    <dl className={styles['settings']}>
      <dt>Description</dt>
      <dd>{settings.description === '' ? 'None' : settings.description}</dd>
      <dt>Host</dt>
      <dd>{settings.source.host}</dd>
      <dt>Port</dt>
      <dd>{settings.source.port}</dd>
      <dt>Database</dt>
      <dd>{settings.source.database}</dd>
      <dt>Account</dt>
      <dd>{settings.source.account}</dd>
      <dt>TLS</dt>
      <dd>{TLS_LABELS[settings.source.tls]}</dd>
    </dl>
  );
}

/**
 * One connection (data.md, "The connection"), at `#/connections/<id>`: its settings, saved as a
 * version by whoever may administer it; its credential, shown only as whether it is set, by whom and
 * when, and set or replaced through a password field that is emptied once sent (DAT-004); a test and
 * its tables, for whoever may use it; retiring and reinstating, each a version; and its access.
 */
export function ConnectionPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const [connection, setConnection] = useState<ConnectionView | 'missing' | 'failed' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [rotation, setRotation] = useState<Tested | string | null>(null);
  const [tested, setTested] = useState<Tested | string | null>(null);
  const [tables, setTables] = useState<
    { readonly relations: readonly Relation[]; readonly truncated: boolean } | string | null
  >(null);
  const [busy, setBusy] = useState<string | null>(null);
  const working = useRef(false);

  const show = useCallback((view: ConnectionView) => {
    setConnection(view);
    setDraft(draftOf(view.settings));
  }, []);

  const load = useCallback(async () => {
    try {
      const { data, response } = await client.GET('/v1/connections/{id}', {
        params: { path: { id } },
      });
      if (isConnectionView(data)) show(data);
      else setConnection(response.status === 404 ? 'missing' : 'failed');
    } catch {
      setConnection('failed');
    }
  }, [client, id, show]);

  /**
   * Reads the connection again after a test or a credential, keeping whatever is typed into the
   * settings: only a version saved, or one somebody else saved first, replaces those.
   */
  const refresh = useCallback(async () => {
    try {
      const { data } = await client.GET('/v1/connections/{id}', { params: { path: { id } } });
      if (isConnectionView(data)) setConnection(data);
    } catch {
      // What is shown stays; the next act reads it again.
    }
  }, [client, id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one act at a time: a second click while one is in flight sends nothing. */
  const act = useCallback(async (name: string, work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(name);
    try {
      await work();
    } finally {
      working.current = false;
      setBusy(null);
    }
  }, []);

  if (connection === null) return null;
  if (connection === 'missing' || connection === 'failed') {
    return (
      <Notice tone="failed">
        <p>
          {connection === 'missing'
            ? 'There is no such connection, or it is not one you may read.'
            : 'The connection could not be loaded.'}
        </p>
        {connection === 'failed' && (
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        )}
      </Notice>
    );
  }

  const view = connection;
  const retired = view.settings.retired;

  /** Cuts the next version from the one shown, and shows what the service answered. */
  const version = async (settings: Settings, done: string) => {
    try {
      const { data, error, response } = await client.POST('/v1/connections/{id}/versions', {
        params: { path: { id } },
        body: { openedFrom: view.version.id, settings: asBody(settings) },
      });
      if (isConnectionView(data)) {
        show(data);
        setSaved(data.version.id === view.version.id ? 'Nothing had changed.' : done);
        return;
      }
      const refusal: unknown = error;
      if (response.status === 409 && isRecord(refusal) && isConnectionView(refusal.current)) {
        show(refusal.current);
        setSaved(
          'Somebody saved a newer version of this connection. It is shown now; make your change again.',
        );
        return;
      }
      setSaved(
        response.status === 401
          ? 'You are signed out. Sign in again to change this connection.'
          : refusalText(error, 'The connection could not be changed. Try again.'),
      );
    } catch {
      setSaved('The connection could not be changed. Try again.');
    }
  };

  const save = () =>
    act('save', async () => {
      if (draft === null) return;
      const problem = draftProblem(draft);
      if (problem) {
        setSaved(problem);
        return;
      }
      await version(settingsOf(draft, view.settings), 'Saved as a new version.');
    });

  const retire = (to: boolean) =>
    act('retire', () =>
      version(
        { ...view.settings, retired: to },
        to ? 'Retired. It runs nothing now.' : 'Reinstated.',
      ),
    );

  const setCredential = () =>
    act('credential', async () => {
      const sent = secret;
      // Emptied as it is sent, whatever the answer: the field never holds it longer than it must.
      setSecret('');
      if (sent === '') {
        setRotation('Type the password first.');
        return;
      }
      try {
        const { data, error, response } = await client.PUT('/v1/connections/{id}/credential', {
          params: { path: { id } },
          body: { secret: sent },
        });
        if (isRecord(data) && isTested(data.test)) {
          setRotation(data.test);
          await refresh();
          return;
        }
        setRotation(
          response.status === 401
            ? 'You are signed out. Sign in again to set the password.'
            : refusalText(error, 'The password could not be set. Try again.'),
        );
      } catch {
        setRotation('The password could not be set. Try again.');
      }
    });

  const test = () =>
    act('test', async () => {
      setTested(null);
      try {
        const { data, error } = await client.POST('/v1/connections/{id}/test', {
          params: { path: { id } },
          body: {},
        });
        if (isTested(data)) {
          setTested(data);
          await refresh();
          return;
        }
        setTested(refusalText(error, 'The connection could not be tested. Try again.'));
      } catch {
        setTested('The connection could not be tested. Try again.');
      }
    });

  const describe = () =>
    act('describe', async () => {
      setTables(null);
      try {
        const { data, error } = await client.POST('/v1/connections/{id}/describe', {
          params: { path: { id } },
          body: {},
        });
        setTables(
          isRelations(data)
            ? data
            : refusalText(error, 'The tables could not be listed. Try again.'),
        );
      } catch {
        setTables('The tables could not be listed. Try again.');
      }
    });

  return (
    <article className={styles['page']}>
      <p>
        <a href="#/connections">Back to connections</a>{' '}
        <ManageAccessLink
          client={client}
          target={`artifact:${view.id}`}
          href={connectionAccessLink(view.id)}
        />
      </p>
      <h1>{view.settings.name}</h1>
      <p className={styles['meta']}>
        <span>PostgreSQL, in {view.space.name}</span>
        <span>Version {view.version.number}</span>
        {retired && <span className={styles['retired']}>Retired</span>}
      </p>

      <Part title="Settings">
        {view.mayAdminister && draft !== null ? (
          <div className={styles['form']}>
            <SettingsFields draft={draft} onChange={setDraft} />
            <button type="button" className="primary" disabled={busy !== null} onClick={save}>
              Save version
            </button>
          </div>
        ) : (
          <SettingsList settings={view.settings} />
        )}
        <p role="status">{saved}</p>
      </Part>

      <Part title="Credential">
        <p>{credentialText(view.credential)}</p>
        {view.mayAdminister && !retired && (
          <div className={styles['form']}>
            <label>
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
            <button type="button" disabled={busy !== null} onClick={setCredential}>
              {!view.credential.set
                ? 'Set'
                : view.credential.targetChanged
                  ? 'Set again'
                  : 'Replace'}
            </button>
            <p className={styles['hint']}>
              It is sealed as soon as it is sent and never shown again, here or anywhere. The
              connection is tested with it straight after.
            </p>
          </div>
        )}
        <TestAnswer tested={rotation} />
      </Part>

      {view.mayUse && !retired && (
        <Part title="Test">
          <p>
            {view.lastTest === null
              ? 'Not tested yet.'
              : `Last tested on ${longDate(view.lastTest.at)} by ${nameOf(view.lastTest.by)}: ${
                  view.lastTest.outcome === 'ok' ? 'connected' : 'could not connect'
                }.`}
          </p>
          <button type="button" disabled={busy !== null} onClick={test}>
            Test
          </button>
          <TestAnswer tested={tested} />
        </Part>
      )}

      {view.mayUse && !retired && (
        <Part title="Tables">
          <button type="button" disabled={busy !== null} onClick={describe}>
            List tables
          </button>
          {typeof tables === 'string' && (
            <div role="status">
              <p>{tables}</p>
            </div>
          )}
          {tables !== null && typeof tables !== 'string' && (
            <>
              <table className={styles['tables']}>
                <caption>Tables and views</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.relations.map((relation) => (
                    <tr key={`${relation.schema}.${relation.name}`}>
                      <td>{`${relation.schema}.${relation.name}`}</td>
                      <td>{KINDS[relation.kind] ?? relation.kind}</td>
                      <td>{relation.columns.map((column) => column.name).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tables.truncated && <p>There are more than the connector lists.</p>}
            </>
          )}
        </Part>
      )}

      {view.mayAdminister && (
        <Part title={retired ? 'Reinstating' : 'Retiring'}>
          <p>
            {retired
              ? 'A retired connection runs nothing. Reinstating it lets it be tested and used again.'
              : 'A retired connection runs nothing. Everything already kept from it stays as it is.'}
          </p>
          <button type="button" disabled={busy !== null} onClick={() => retire(!retired)}>
            {retired ? 'Reinstate' : 'Retire'}
          </button>
        </Part>
      )}
    </article>
  );
}
