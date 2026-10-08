import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { Notice } from '../states/Notice.js';
import { documentLink } from '../structure/links.js';
import { Chip } from '../parts/Chip.js';
import styles from './ConnectionPage.module.css';
import { connectionAccessLink, queryDefinitionLink } from './links.js';
import {
  KEY_PAIR_HINT,
  PATH_STYLE_LABELS,
  RUNS_AS_LABELS,
  runsAsOf,
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
  type Described,
  type Settings,
  type Tested,
} from './shapes.js';
import { isUses, UsedList, type Uses } from './uses.js';

type Client = ReturnType<typeof createApiClient>;

const FINDINGS: Readonly<Record<string, string>> = {
  account_not_read_only:
    'This account can change data at the source, so SQL written by hand will not be allowed on this connection.',
  account_holds_privilege:
    "This account can read data, create objects, or owns functions, procedures or views of its own, so nothing runs as each person until the source's administrator removes those privileges.",
};

/**
 * What the source's administrator must change, said beneath a refusal that names the account or a
 * person's role on a connection running as each person (the D7 plan, D7-C, D7-D; ADR-0040).
 */
const FOR_THE_ADMINISTRATOR: Readonly<Record<string, string>> = {
  account_holds_privilege:
    "For the source's administrator: the connection's account must read no table, view or sequence, own no function, procedure or view, and create in no schema.",
  identity_role_unsafe:
    "For the source's administrator: each person's role must be NOLOGIN, create in no schema or database, and own nothing.",
  identity_unmatched:
    "For the source's administrator: make a role named as the person signs in, NOLOGIN, and grant it to the connection's account with SET.",
};

/** Between the lines of an answer shown as several paragraphs. */
const LINE = String.fromCharCode(10);

/** A refusal in the service's words, and what the administrator must change where it says so. */
function refusalLines(error: unknown, fallback: string): string {
  const said = refusalText(error, fallback);
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
  const more = code === undefined ? undefined : FOR_THE_ADMINISTRATOR[code];
  return more === undefined ? said : `${said}${LINE}${more}`;
}

/** An answer's lines, each a paragraph. */
function Lines({ text }: { readonly text: string }) {
  return text.split(LINE).map((line) => <p key={line}>{line}</p>);
}

const KINDS: Readonly<Record<string, string>> = {
  table: 'Table',
  view: 'View',
  materializedView: 'Materialised view',
  foreignTable: 'Foreign table',
  partitionedTable: 'Partitioned table',
};

/**
 * What a describe left out, in words, or null where it left out nothing: a table or column whose name
 * holds a control character, or whose type is longer than any PostgreSQL names, is never listed.
 */
function leftOutText(leftOut: Described['leftOut']): string | null {
  const parts = [
    leftOut.relations > 0 &&
      `${leftOut.relations} ${leftOut.relations === 1 ? 'table or view' : 'tables or views'}`,
    leftOut.columns > 0 && `${leftOut.columns} ${leftOut.columns === 1 ? 'column' : 'columns'}`,
  ].filter((part): part is string => typeof part === 'string');
  if (parts.length === 0) return null;
  return `Left out because their names or types cannot be shown here: ${parts.join(', and ')}.`;
}

/**
 * A test's answer in words (DAT-075): "Connected." and what it found of the account, or "Could not
 * connect." and the one reason the service gave, which names no address and repeats no credential.
 */
function TestAnswer({ tested }: { readonly tested: Tested | string | null }) {
  if (tested === null) return <p role="status" />;
  if (typeof tested === 'string') {
    return (
      <div role="status">
        <Lines text={tested} />
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
function credentialText(
  credential: ConnectionView['credential'],
  type: Settings['type'] = 'postgres',
): string {
  if (!credential.set) return 'Not set.';
  const set = `Set by ${nameOf(credential.setBy)} on ${longDate(credential.setAt)}`;
  const what = type === 'http' ? 'secret' : type === 's3' ? 'key pair' : 'password';
  if (credential.setBeforeBinding) {
    return `${set}, before this version of the product. Set the ${what} again to use this connection.`;
  }
  const moved =
    type === 'http'
      ? 'the base URL or the secret header'
      : type === 's3'
        ? 'the endpoint, the region, the bucket or how it is addressed'
        : 'the host, port, database, account or TLS';
  return credential.targetChanged
    ? `${set}, before ${moved} changed. Set the ${what} again to use this connection.`
    : `${set}.`;
}

/**
 * The last test in words - and, where it was of an earlier version, or made with an earlier
 * credential, only that: a pass of settings since changed says nothing of these (the D1 fix, C7), and
 * a pass with a password since replaced says nothing of the new one.
 */
function lastTestText(view: ConnectionView): string {
  const last = view.lastTest;
  if (last === null) return 'Not tested yet.';
  const when = `on ${longDate(last.at)} by ${nameOf(last.by)}`;
  if (last.version !== view.version.id) {
    return `Not tested since this version. The last test, of an earlier version, was ${when}.`;
  }
  if (!last.credentialCurrent) {
    return `Not tested since the credential was set. The last test, with an earlier credential, was ${when}.`;
  }
  return `Last tested ${when}: ${last.outcome === 'ok' ? 'connected' : 'could not connect'}.`;
}

/** The query definitions naming a connection: those the caller may read, and how many more (D2-O). */
interface Naming {
  readonly readable: readonly {
    readonly id: string;
    readonly title: string;
    readonly retired: boolean;
  }[];
  readonly others: number;
}

function isNaming(value: unknown): value is Naming {
  return (
    isRecord(value) &&
    typeof value.others === 'number' &&
    Array.isArray(value.readable) &&
    value.readable.every(
      (each: unknown) =>
        isRecord(each) &&
        typeof each.id === 'string' &&
        typeof each.title === 'string' &&
        typeof each.retired === 'boolean',
    )
  );
}

/** Where a connection is used: the definitions naming it and the documents holding its results. */
interface ConnectionUses {
  readonly definitions: Naming;
  readonly documents: Uses;
}

/** Those the caller may not read, counted, never named. */
const unread = (others: number) =>
  `${others} ${others === 1 ? 'query definition' : 'query definitions'} you may not read`;

/**
 * Why retiring was refused (DAT-065), in words: the definitions still naming the connection, each the
 * caller may read by title and the rest counted.
 */
function inUseText(naming: Naming): string {
  const titles = naming.readable.map((each) => each.title);
  if (titles.length === 0) return `Retire these first: ${unread(naming.others)}.`;
  const more = naming.others === 0 ? '' : `, and ${naming.others} more you may not read`;
  return `Retire these first: ${titles.join(', ')}${more}.`;
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
  if (settings.type === 's3') {
    return (
      <dl className={styles['settings']}>
        <dt>Description</dt>
        <dd>{settings.description === '' ? 'None' : settings.description}</dd>
        <dt>Endpoint</dt>
        <dd>{settings.source.endpoint}</dd>
        <dt>Region</dt>
        <dd>{settings.source.region}</dd>
        <dt>Bucket</dt>
        <dd>{settings.source.bucket}</dd>
        <dt>Addressed</dt>
        <dd>{PATH_STYLE_LABELS[settings.source.pathStyle ? 'path' : 'virtual']}</dd>
        <dt>Runs as</dt>
        <dd>{RUNS_AS_LABELS.service}</dd>
      </dl>
    );
  }
  if (settings.type === 'http') {
    return (
      <dl className={styles['settings']}>
        <dt>Description</dt>
        <dd>{settings.description === '' ? 'None' : settings.description}</dd>
        <dt>Base URL</dt>
        <dd>{settings.source.baseUrl}</dd>
        <dt>Secret header</dt>
        <dd>{settings.source.secretHeader}</dd>
        <dt>Runs as</dt>
        <dd>{RUNS_AS_LABELS.service}</dd>
      </dl>
    );
  }
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
      <dt>Runs as</dt>
      <dd>{RUNS_AS_LABELS[runsAsOf(settings.identity)]}</dd>
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
  // An S3 connection's access key id, sent with its secret access key (the D6 plan, D6-C).
  const [keyId, setKeyId] = useState('');
  const [rotation, setRotation] = useState<Tested | string | null>(null);
  const [tested, setTested] = useState<Tested | string | null>(null);
  const [tables, setTables] = useState<Described | string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uses, setUses] = useState<ConnectionUses | 'failed' | null>(null);
  const [retiring, setRetiring] = useState<readonly string[] | null>(null);
  const working = useRef(false);

  const shownVersion = useRef<string | null>(null);

  /**
   * Shows the connection as read. What a test, a credential or a describe answered was of the version
   * shown then: a new one - saved here, retired, reinstated or saved by somebody else - makes it the
   * earlier version's, so it goes (the D1 fix, C7).
   */
  const hold = useCallback((view: ConnectionView) => {
    if (shownVersion.current !== null && shownVersion.current !== view.version.id) {
      setTested(null);
      setRotation(null);
      setTables(null);
    }
    shownVersion.current = view.version.id;
    setConnection(view);
  }, []);

  const show = useCallback(
    (view: ConnectionView) => {
      hold(view);
      setDraft(draftOf(view.settings));
    },
    [hold],
  );

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
      if (isConnectionView(data)) hold(data);
    } catch {
      // What is shown stays; the next act reads it again.
    }
  }, [client, id, hold]);

  useEffect(() => {
    void load();
  }, [load]);

  // Where it is used, read with it: the definitions naming it (D2-O) and the documents holding results
  // from it (DAT-064), shown above Retire so they are seen before it is asked for.
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { data } = await client.GET('/v1/connections/{id}/uses', {
          params: { path: { id } },
        });
        const answer: unknown = data;
        if (current) {
          setUses(
            isRecord(answer) && isNaming(answer.definitions) && isUses(answer.documents)
              ? { definitions: answer.definitions, documents: answer.documents }
              : 'failed',
          );
        }
      } catch {
        if (current) setUses('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [client, id]);

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
  const { type } = view.settings;
  const http = type === 'http';
  const s3 = type === 's3';
  const secretWord = http ? 'secret' : s3 ? 'key pair' : 'password';

  /**
   * Cuts the next version from the one shown, and shows what the service answered. Retiring and
   * reinstating save the version shown with `retired` changed and nothing else, so what is typed into
   * the settings and not yet saved stays typed (`keepDraft`); a save replaces it with what was saved.
   */
  const version = async (
    settings: Settings,
    done: string,
    keepDraft = false,
    report: (lines: string | null) => void = setSaved,
  ) => {
    try {
      const { data, error, response } = await client.POST('/v1/connections/{id}/versions', {
        params: { path: { id } },
        body: { openedFrom: view.version.id, settings: asBody(settings) },
      });
      if (isConnectionView(data)) {
        if (keepDraft) hold(data);
        else show(data);
        report(data.version.id === view.version.id ? 'Nothing had changed.' : done);
        return;
      }
      const refusal: unknown = error;
      // Still named by a definition in service (DAT-065): what names it, so it can be retired first.
      if (response.status === 409 && isRecord(refusal) && isNaming(refusal.definitions)) {
        setRetiring([
          refusalText(refusal, 'This connection is still used.'),
          inUseText(refusal.definitions),
        ]);
        return;
      }
      if (response.status === 409 && isRecord(refusal) && isConnectionView(refusal.current)) {
        show(refusal.current);
        setSaved(
          'Somebody saved a newer version of this connection. It is shown now; make your change again.',
        );
        return;
      }
      report(
        response.status === 401
          ? 'You are signed out. Sign in again to change this connection.'
          : refusalText(error, 'The connection could not be changed. Try again.'),
      );
    } catch {
      report('The connection could not be changed. Try again.');
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
    act('retire', () => {
      setRetiring(null);
      return version(
        { ...view.settings, retired: to },
        to ? 'Retired. It runs nothing now.' : 'Reinstated.',
        true,
        (line) => setRetiring(line === null ? null : [line]),
      );
    });

  const setCredential = () =>
    act('credential', async () => {
      const sent = secret;
      const sentId = keyId.trim();
      // Emptied as it is sent, whatever the answer: the field never holds it longer than it must.
      setSecret('');
      setKeyId('');
      if (sent === '' || (s3 && sentId === '')) {
        setRotation(
          s3
            ? 'Type the access key id and the secret access key first.'
            : `Type the ${secretWord} first.`,
        );
        return;
      }
      try {
        const { data, error, response } = await client.PUT('/v1/connections/{id}/credential', {
          params: { path: { id } },
          body: s3 ? { accessKeyId: sentId, secretAccessKey: sent } : { secret: sent },
        });
        if (isRecord(data) && isTested(data.test)) {
          setRotation(data.test);
          await refresh();
          return;
        }
        setRotation(
          response.status === 401
            ? `You are signed out. Sign in again to set the ${secretWord}.`
            : refusalText(error, `The ${secretWord} could not be set. Try again.`),
        );
      } catch {
        setRotation(`The ${secretWord} could not be set. Try again.`);
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
        setTested(refusalLines(error, 'The connection could not be tested. Try again.'));
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
            : refusalLines(error, 'The tables could not be listed. Try again.'),
        );
      } catch {
        setTables('The tables could not be listed. Try again.');
      }
    });

  return (
    <article className={styles['page']}>
      {/* The head (the Ledger, ADR-0046): where it is, what it is, its facts as chips. */}
      <header className={styles['head']}>
        <nav aria-label="Breadcrumb" className={styles['trail']}>
          <a href="#/connections">Connections</a>
          <span>{` / ${view.space.name}`}</span>
        </nav>
        <h1>{view.settings.name}</h1>
        <p className={styles['meta']}>
          <Chip>{`${http ? 'HTTP API' : s3 ? 'S3 bucket' : 'PostgreSQL'}, in ${view.space.name}`}</Chip>
          <Chip className={styles['mono']}>{`Version ${view.version.number}`}</Chip>
          {retired && <Chip tone="warn">Retired</Chip>}
          <ManageAccessLink
            client={client}
            target={`artifact:${view.id}`}
            href={connectionAccessLink(view.id)}
          />
        </p>
      </header>

      {/* What uses it, read before the parts that change it: beside them on the page. */}
      <aside className={styles['side']} aria-label="Beside the connection">
        <Part title="Used by">
          {uses === null ? null : uses === 'failed' ? (
            <p>What uses this connection could not be read.</p>
          ) : uses.definitions.readable.length === 0 &&
            uses.definitions.others === 0 &&
            uses.documents.readable.length === 0 &&
            uses.documents.others === 0 ? (
            <p>Nothing uses this connection.</p>
          ) : (
            <>
              {(uses.definitions.readable.length > 0 || uses.definitions.others > 0) && (
                <h3>Query definitions</h3>
              )}
              {uses.definitions.readable.length > 0 && (
                <ul>
                  {uses.definitions.readable.map((each) => (
                    <li key={each.id}>
                      <a href={queryDefinitionLink(each.id)}>{each.title}</a>
                      {each.retired && ' (retired)'}
                    </li>
                  ))}
                </ul>
              )}
              {uses.definitions.others > 0 && (
                <p>
                  {uses.definitions.readable.length > 0
                    ? `And ${uses.definitions.others} more you may not read.`
                    : `Used by ${unread(uses.definitions.others)}.`}
                </p>
              )}
              <UsedList
                heading="Documents"
                uses={uses.documents}
                link={documentLink}
                counted={(others) =>
                  `Held by ${others} ${others === 1 ? 'document' : 'documents'} you may not read.`
                }
              />
            </>
          )}
        </Part>
      </aside>
      <div className={styles['main']}>
        <Part title="Settings">
          {view.mayAdminister && draft !== null ? (
            <div className={styles['form']}>
              <SettingsFields draft={draft} onChange={setDraft} typeFixed />
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
          <p>{credentialText(view.credential, type)}</p>
          {view.mayAdminister && !retired && (
            <div className={styles['form']}>
              {s3 && (
                <>
                  <p className={styles['hint']}>{KEY_PAIR_HINT}</p>
                  <label>
                    Access key id
                    <input
                      autoComplete="off"
                      spellCheck={false}
                      value={keyId}
                      onChange={(event) => setKeyId(event.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                {http ? 'Secret' : s3 ? 'Secret access key' : 'Password'}
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
            <p>{lastTestText(view)}</p>
            <button type="button" disabled={busy !== null} onClick={test}>
              Test
            </button>
            <TestAnswer tested={tested} />
          </Part>
        )}

        {view.mayUse && !retired && type === 'postgres' && (
          <Part title="Tables">
            <button type="button" disabled={busy !== null} onClick={describe}>
              List tables
            </button>
            {typeof tables === 'string' && (
              <div role="status">
                <Lines text={tables} />
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
                {tables.truncated && (
                  <p>
                    The list was cut short: the source has more tables and views than the connector
                    lists at once.
                  </p>
                )}
                {leftOutText(tables.leftOut) && <p>{leftOutText(tables.leftOut)}</p>}
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
            <div role="status">
              {retiring?.map((line, at) => (
                <p key={at}>{line}</p>
              ))}
            </div>
          </Part>
        )}
      </div>
    </article>
  );
}
