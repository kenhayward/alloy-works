import type { createApiClient } from '@alloy-works/api-client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { Notice } from '../states/Notice.js';
import { documentLink } from '../structure/links.js';
import { Icon } from '../editor/Icon.js';
import { Chip } from '../parts/Chip.js';
import { DetailPage } from '../parts/DetailPage.js';
import type { PanelTab } from '../parts/PanelTabs.js';
import { RowActions } from '../parts/RowActions.js';
import type { StripCell } from '../parts/StateStrip.js';
import styles from './ConnectionPage.module.css';
import { useInstalledExtensions } from './extensions.js';
import { connectionAccessLink, connectionLink, queryDefinitionLink } from './links.js';
import {
  PATH_STYLE_LABELS,
  RUNS_AS_LABELS,
  runsAsOf,
  SettingsFields,
  TLS_LABELS,
  draftOf,
  draftProblem,
  settingsOf,
  withManifestFields,
  type Draft,
} from './SettingsFields.js';
import {
  asBody,
  isConnectionView,
  isRecord,
  isRelations,
  isTested,
  leftOutText,
  longDate,
  nameOf,
  refusalText,
  type ConnectionView,
  type Described,
  type Settings,
  type Tested,
} from './shapes.js';
import { isUses, PagedUses, type Uses } from './uses.js';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

const FINDINGS: Readonly<Record<string, string>> = {
  get account_not_read_only() {
    return words('data.this-account-can-change-data');
  },
  get account_holds_privilege() {
    return words('data.this-account-can-read-data');
  },
};

/**
 * What the source's administrator must change, said beneath a refusal that names the account or a
 * person's role on a connection running as each person (the D7 plan, D7-C, D7-D; ADR-0040).
 */
const FOR_THE_ADMINISTRATOR: Readonly<Record<string, string>> = {
  get account_holds_privilege() {
    return words('data.for-the-source-s-administrator');
  },
  get identity_role_unsafe() {
    return words('data.for-the-source-s-administrator-2');
  },
  get identity_unmatched() {
    return words('data.for-the-source-s-administrator-3');
  },
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
  get table() {
    return words('data.table');
  },
  get view() {
    return words('data.view');
  },
  get materializedView() {
    return words('data.materialised-view');
  },
  get foreignTable() {
    return words('data.foreign-table');
  },
  get partitionedTable() {
    return words('data.partitioned-table');
  },
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
        <Lines text={tested} />
      </div>
    );
  }
  if (tested.outcome === 'ok') {
    return (
      <div role="status">
        <p>{words('data.connected')}</p>
        {tested.findings.map((finding) => (
          <p key={finding}>{FINDINGS[finding] ?? finding}</p>
        ))}
      </div>
    );
  }
  return (
    <div role="status">
      <p>{words('data.could-not-connect')}</p>
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
  if (!credential.set) return words('data.not-set');
  const values = {
    name: nameOf(credential.setBy),
    date: longDate(credential.setAt),
    secret: secretKind(type),
    type,
  };
  if (credential.setBeforeBinding) return words('data.before-this-version-of-the', values);
  return credential.targetChanged
    ? words('data.before-changed-set-the-again', values)
    : words('data.set-by-on', values);
}

/** What a connection of a type signs in with, as its messages select it. */
const secretKind = (type: Settings['type']) =>
  type === 'http' || type === 'extension' ? 'secret' : type === 's3' ? 'keyPair' : 'password';

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

/**
 * Why retiring was refused (DAT-065), in words: the definitions still naming the connection, each the
 * caller may read by title and the rest counted.
 */
function inUseText(naming: Naming): string {
  const titles = naming.readable.map((each) => each.title);
  if (titles.length === 0) return words('data.retire-these-first', { others: naming.others });
  return words('data.retire-these-first-2', {
    titles: formats().list(titles, { type: 'unit', style: 'short' }),
    others: naming.others,
  });
}

/** The strip's Credential cell (ADR-0050, decision 4): set, by whom and when, or what it lacks. */
function credentialCell(credential: ConnectionView['credential']): StripCell {
  const base = {
    key: 'credential',
    icon: 'Credential',
    label: words('data.credential'),
  } as const;
  if (!credential.set) return { ...base, tone: 'warn', value: words('data.not-set-2') };
  const who = { name: nameOf(credential.setBy), date: longDate(credential.setAt) };
  if (credential.setBeforeBinding || credential.targetChanged) {
    return {
      ...base,
      tone: 'warn',
      value: words('data.set-again-to-use'),
      detail: words('data.set', who),
    };
  }
  return { ...base, tone: 'ok', value: words('data.set-2'), detail: words('data.by-on', who) };
}

/**
 * The strip's Last test cell: its answer, by whom and when - or, where it was of an earlier version or
 * an earlier credential, only that, since it says nothing of these (the D1 fix, C7).
 */
function lastTestCell(view: ConnectionView): StripCell {
  const base = { key: 'last-test', label: words('data.last-test') } as const;
  const last = view.lastTest;
  if (last === null)
    return {
      ...base,
      icon: 'Test',
      tone: 'muted',
      value: words('data.not-tested-yet'),
    };
  const who = { date: longDate(last.at), name: nameOf(last.by) };
  const when = words('data.on-by', who);
  if (last.version !== view.version.id) {
    return {
      ...base,
      icon: 'Needs attention',
      tone: 'warn',
      value: words('data.not-tested-since-this-version'),
      detail: words('data.the-last-test-of-an', who),
    };
  }
  if (!last.credentialCurrent) {
    return {
      ...base,
      icon: 'Needs attention',
      tone: 'warn',
      value: words('data.not-tested-since-the-credential'),
      detail: words('data.the-last-test-with-an', who),
    };
  }
  return last.outcome === 'ok'
    ? {
        ...base,
        icon: 'Done editing',
        tone: 'ok',
        value: words('data.connected-2'),
        detail: when,
      }
    : {
        ...base,
        icon: 'Needs attention',
        tone: 'warn',
        value: words('data.could-not-connect-2'),
        detail: when,
      };
}
function SettingsList({ settings }: { readonly settings: Settings }) {
  if (settings.type === 's3') {
    return (
      <dl className={styles['settings']}>
        <dt>{words('data.description')}</dt>
        <dd {...(settings.description === '' ? {} : { 'data-content': true })}>
          {settings.description === '' ? words('data.none') : settings.description}
        </dd>
        <dt>{words('data.endpoint')}</dt>
        <dd data-content>{settings.source.endpoint}</dd>
        <dt>{words('data.region')}</dt>
        <dd data-content>{settings.source.region}</dd>
        <dt>{words('data.bucket')}</dt>
        <dd data-content>{settings.source.bucket}</dd>
        <dt>{words('data.addressed')}</dt>
        <dd>{PATH_STYLE_LABELS[settings.source.pathStyle ? 'path' : 'virtual']}</dd>
        <dt>{words('data.runs-as')}</dt>
        <dd>{RUNS_AS_LABELS.service}</dd>
      </dl>
    );
  }
  if (settings.type === 'http') {
    return (
      <dl className={styles['settings']}>
        <dt>{words('data.description')}</dt>
        <dd {...(settings.description === '' ? {} : { 'data-content': true })}>
          {settings.description === '' ? words('data.none') : settings.description}
        </dd>
        <dt>{words('data.base-url')}</dt>
        <dd data-content>{settings.source.baseUrl}</dd>
        <dt>{words('data.secret-header')}</dt>
        <dd data-content>{settings.source.secretHeader}</dd>
        <dt>{words('data.runs-as')}</dt>
        <dd>{RUNS_AS_LABELS.service}</dd>
      </dl>
    );
  }
  if (settings.type === 'extension') {
    return (
      <dl className={styles['settings']}>
        <dt>{words('data.description')}</dt>
        <dd {...(settings.description === '' ? {} : { 'data-content': true })}>
          {settings.description === '' ? words('data.none') : settings.description}
        </dd>
        <dt>{words('data.endpoint')}</dt>
        <dd data-content>{settings.source.endpoint}</dd>
        {Object.entries(settings.source.settings).map(([key, value]) => (
          <Fragment key={key}>
            <dt data-content>{key}</dt>
            <dd {...(typeof value === 'boolean' ? {} : { 'data-content': true })}>
              {typeof value === 'boolean'
                ? value
                  ? words('data.yes')
                  : words('data.no')
                : String(value)}
            </dd>
          </Fragment>
        ))}
        <dt>{words('data.runs-as')}</dt>
        <dd>{RUNS_AS_LABELS[runsAsOf(settings.identity)]}</dd>
      </dl>
    );
  }
  return (
    <dl className={styles['settings']}>
      <dt>{words('data.description')}</dt>
      <dd {...(settings.description === '' ? {} : { 'data-content': true })}>
        {settings.description === '' ? words('data.none') : settings.description}
      </dd>
      <dt>{words('data.host')}</dt>
      <dd data-content>{settings.source.host}</dd>
      <dt>{words('data.port')}</dt>
      <dd data-content>{settings.source.port}</dd>
      <dt>{words('data.database')}</dt>
      <dd data-content>{settings.source.database}</dd>
      <dt>{words('data.account')}</dt>
      <dd data-content>{settings.source.account}</dd>
      <dt>{words('data.tls')}</dt>
      <dd>{TLS_LABELS[settings.source.tls]}</dd>
      <dt>{words('data.runs-as')}</dt>
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
export function ConnectionPage({
  client,
  id,
  tab = null,
}: {
  readonly client: Client;
  readonly id: string;
  /** The tab the address names, or null for Settings (ADR-0050). */
  readonly tab?: string | null;
}) {
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
  // An extension's manifest, for its fields' labels and a newer one, read where it may be changed.
  const extensions = useInstalledExtensions(
    client,
    isConnectionView(connection) &&
      connection.settings.type === 'extension' &&
      connection.mayAdminister,
  );
  useEffect(() => {
    setDraft((held) => (held === null ? held : withManifestFields(held, extensions)));
  }, [extensions, connection]);

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
            ? words('data.there-is-no-such-connection')
            : words('data.the-connection-could-not-be')}
        </p>
        {connection === 'failed' && (
          <button type="button" onClick={() => void load()}>
            {words('data.try-again')}
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
  const extension = type === 'extension';
  const signsInWith = secretKind(type);
  // An extension's secret is named as its manifest names it, where that is read.
  const manifest =
    extension && Array.isArray(extensions)
      ? extensions.find(
          (each) =>
            view.settings.type === 'extension' && each.id === view.settings.source.extension,
        )?.manifest
      : undefined;
  const secretLabel =
    manifest !== undefined && manifest.authentication !== 'none' ? (
      // The extension's own words for it, never the interface's.
      <span data-content>{manifest.authentication.label}</span>
    ) : http || extension ? (
      words('data.secret')
    ) : s3 ? (
      words('data.secret-access-key')
    ) : (
      words('data.password')
    );

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
        report(data.version.id === view.version.id ? words('data.nothing-had-changed') : done);
        return;
      }
      const refusal: unknown = error;
      // Still named by a definition in service (DAT-065): what names it, so it can be retired first.
      if (response.status === 409 && isRecord(refusal) && isNaming(refusal.definitions)) {
        setRetiring([
          refusalText(refusal, words('data.this-connection-is-still-used')),
          inUseText(refusal.definitions),
        ]);
        return;
      }
      if (response.status === 409 && isRecord(refusal) && isConnectionView(refusal.current)) {
        show(refusal.current);
        setSaved(words('data.somebody-saved-a-newer-version'));
        return;
      }
      report(
        response.status === 401
          ? words('data.you-are-signed-out-sign')
          : refusalText(error, words('data.the-connection-could-not-be-2')),
      );
    } catch {
      report(words('data.the-connection-could-not-be-2'));
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
      await version(settingsOf(draft, view.settings), words('data.saved-as-a-new-version'));
    });

  const retire = (to: boolean) =>
    act('retire', () => {
      setRetiring(null);
      return version(
        { ...view.settings, retired: to },
        to ? words('data.retired-it-runs-nothing-now') : words('data.reinstated'),
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
            ? words('data.type-the-access-key-id')
            : words('data.type-the-first', { secret: signsInWith }),
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
            ? words('data.you-are-signed-out-sign-2', { secret: signsInWith })
            : refusalText(error, words('data.the-could-not-be-set', { secret: signsInWith })),
        );
      } catch {
        setRotation(words('data.the-could-not-be-set', { secret: signsInWith }));
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
        setTested(refusalLines(error, words('data.the-connection-could-not-be-3')));
      } catch {
        setTested(words('data.the-connection-could-not-be-3'));
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
          isRelations(data) ? data : refusalLines(error, words('data.the-tables-could-not-be')),
        );
      } catch {
        setTables(words('data.the-tables-could-not-be'));
      }
    });

  const usedBy =
    uses === null || uses === 'failed'
      ? null
      : {
          definitions: uses.definitions.readable.length + uses.definitions.others,
          documents: uses.documents.readable.length + uses.documents.others,
        };
  const tabs: PanelTab[] = [
    { key: 'settings', label: words('data.settings') },
    { key: 'credential', label: words('data.credential') },
    ...(view.mayUse && !retired && type === 'postgres'
      ? [{ key: 'tables', label: words('data.tables') }]
      : []),
    {
      key: 'used-by',
      label: words('data.used-by'),
      ...(usedBy === null ? {} : { count: usedBy.definitions + usedBy.documents }),
    },
  ];

  return (
    <DetailPage
      trail={
        <>
          <a href="#/connections">{words('data.connections')}</a>
          {' / '}
          <span data-content>{view.space.name}</span>
        </>
      }
      title={view.settings.name}
      chips={
        <>
          <Chip>{words('data.in', { type, name: view.space.name })}</Chip>
          <Chip className={styles['mono']}>
            {words('data.version', { number: view.version.number })}
          </Chip>
          {retired && <Chip tone="warn">{words('data.retired')}</Chip>}
          <ManageAccessLink
            client={client}
            target={`artifact:${view.id}`}
            href={connectionAccessLink(view.id)}
          />
        </>
      }
      actions={
        <>
          {view.mayUse && !retired && (
            <button type="button" disabled={busy !== null} onClick={test}>
              <Icon name="Test" />
              {words('data.test')}
            </button>
          )}
          {view.mayAdminister && (
            <RowActions
              subject={view.settings.name}
              shown={[]}
              more={[
                {
                  label: retired ? words('data.reinstate') : words('data.retire'),
                  onSelect: () => retire(!retired),
                },
              ]}
            />
          )}
        </>
      }
      strip={[
        credentialCell(view.credential),
        lastTestCell(view),
        {
          key: 'used-by',
          icon: 'Used by',
          tone: 'muted',
          label: words('data.used-by'),
          value:
            uses === 'failed'
              ? words('data.could-not-be-read')
              : usedBy === null
                ? ''
                : words('data.query-definitions-counted', { count: usedBy.definitions }),
          ...(usedBy === null
            ? {}
            : { detail: words('data.and-documents', { count: usedBy.documents }) }),
        },
      ]}
      notice={
        <>
          <TestAnswer tested={tested} />
          <div role="status">
            {retiring?.map((line, at) => (
              <p key={at}>{line}</p>
            ))}
          </div>
        </>
      }
      label={words('data.connection')}
      tabs={tabs}
      chosen={tab}
      link={(key) => connectionLink(view.id, key)}
    >
      {(open) =>
        open === 'credential' ? (
          <section className={styles['card']} aria-label={words('data.credential')}>
            <p>{credentialText(view.credential, type)}</p>
            {view.mayAdminister && !retired && (
              <div className={styles['form']}>
                {s3 && (
                  <>
                    <p className={styles['hint']}>{words('data.a-static-access-key-pair')}</p>
                    <label>
                      {words('data.access-key-id')}
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
                  {secretLabel}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </label>
                <button type="button" disabled={busy !== null} onClick={setCredential}>
                  {!view.credential.set
                    ? words('data.set-2')
                    : view.credential.targetChanged
                      ? words('data.set-again')
                      : words('data.replace')}
                </button>
                <p className={styles['hint']}>{words('data.it-is-sealed-as-soon')}</p>
              </div>
            )}
            <TestAnswer tested={rotation} />
          </section>
        ) : open === 'tables' ? (
          <section className={styles['card']} aria-label={words('data.tables')}>
            <button type="button" disabled={busy !== null} onClick={describe}>
              {words('data.list-tables')}
            </button>
            {typeof tables === 'string' && (
              <div role="status">
                <Lines text={tables} />
              </div>
            )}
            {tables !== null && typeof tables !== 'string' && (
              <>
                <table className={styles['tables']}>
                  <caption>{words('data.tables-and-views')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{words('data.name')}</th>
                      <th scope="col">{words('data.kind')}</th>
                      <th scope="col">{words('data.columns-2')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.relations.map((relation) => (
                      <tr key={`${relation.schema}.${relation.name}`}>
                        <td data-content>{`${relation.schema}.${relation.name}`}</td>
                        <td>{KINDS[relation.kind] ?? relation.kind}</td>
                        <td data-content>
                          {formats().list(
                            relation.columns.map((column) => column.name),
                            { type: 'unit', style: 'short' },
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tables.truncated && <p>{words('data.the-list-was-cut-short')}</p>}
                {leftOutText(tables.leftOut) && <p>{leftOutText(tables.leftOut)}</p>}
              </>
            )}
          </section>
        ) : open === 'used-by' ? (
          uses === null ? null : uses === 'failed' ? (
            <p>{words('data.what-uses-this-connection-could')}</p>
          ) : (
            <div className={styles['lists']}>
              <PagedUses
                heading={words('data.query-definitions-2')}
                pages={words('data.pages-of-query-definitions')}
                uses={uses.definitions}
                link={queryDefinitionLink}
                counted={(others) => words('data.used-by-2', { others })}
              />
              <PagedUses
                heading={words('data.documents')}
                pages={words('data.pages-of-documents')}
                uses={uses.documents}
                link={documentLink}
                counted={(others) => words('data.held-by-you-may-not', { others })}
              />
            </div>
          )
        ) : (
          <section className={styles['card']} aria-label={words('data.settings')}>
            {view.mayAdminister && draft !== null ? (
              <>
                <div className={styles['fields']}>
                  <SettingsFields
                    draft={draft}
                    onChange={setDraft}
                    typeFixed
                    extensions={extensions}
                  />
                </div>
                <footer className={styles['foot']}>
                  <p role="status">{saved}</p>
                  <button type="button" className="primary" disabled={busy !== null} onClick={save}>
                    {words('data.save-version')}
                  </button>
                </footer>
              </>
            ) : (
              <SettingsList settings={view.settings} />
            )}
          </section>
        )
      }
    </DetailPage>
  );
}
