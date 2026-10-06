import type { Settings } from './shapes.js';

/** What the settings form holds while it is being written: the port as typed. */
export interface Draft {
  readonly name: string;
  readonly description: string;
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly account: string;
  readonly tls: 'require' | 'verifyFull';
  /** Whom it runs as: its own account, or each person by the attribute naming their role (D7-B). */
  readonly runsAs: RunsAs;
}

export type RunsAs = 'service' | 'email' | 'subject';

export const RUNS_AS_LABELS: Readonly<Record<RunsAs, string>> = {
  service: "The connection's account",
  email: 'Each person, by the email they sign in with',
  subject: "Each person, by their identifier at the organisation's sign-in",
};

export function runsAsOf(identity: Settings['identity']): RunsAs {
  return identity.kind === 'endUser' && identity.mechanism === 'asserted'
    ? identity.attribute
    : 'service';
}

export const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  host: '',
  port: '5432',
  database: '',
  account: '',
  tls: 'require',
  runsAs: 'service',
};

export function draftOf(settings: Settings): Draft {
  return {
    name: settings.name,
    description: settings.description,
    host: settings.source.host,
    port: String(settings.source.port),
    database: settings.source.database,
    account: settings.source.account,
    tls: settings.source.tls,
    runsAs: runsAsOf(settings.identity),
  };
}

/**
 * The settings a draft stands for, keeping whether it is retired from the version it was opened at,
 * and its identity where the form's choice still names it. The service checks every rule again.
 */
export function settingsOf(
  draft: Draft,
  kept: Pick<Settings, 'identity' | 'retired'> = { identity: { kind: 'service' }, retired: false },
): Settings {
  return {
    schemaVersion: 1,
    name: draft.name.trim(),
    description: draft.description,
    type: 'postgres',
    source: {
      host: draft.host.trim(),
      port: Number(draft.port),
      database: draft.database,
      account: draft.account,
      tls: draft.tls,
    },
    identity:
      runsAsOf(kept.identity) === draft.runsAs
        ? kept.identity
        : draft.runsAs === 'service'
          ? { kind: 'service' }
          : { kind: 'endUser', mechanism: 'asserted', attribute: draft.runsAs },
    retired: kept.retired,
  };
}

/** What stops a draft being sent, said in a sentence; null where nothing does. */
export function draftProblem(draft: Draft): string | null {
  if (draft.name.trim() === '') return 'A connection needs a name.';
  if (draft.host.trim() === '') return 'A connection needs the host of its source.';
  if (!/^\d{1,5}$/.test(draft.port) || Number(draft.port) < 1 || Number(draft.port) > 65535) {
    return 'A port is a whole number from 1 to 65535.';
  }
  if (draft.database === '') return 'A connection needs the name of its database.';
  if (draft.account === '') return 'A connection needs the account it signs in as.';
  return null;
}

/** What running as each person asks of the source, said beside the choice (the D7 plan, D7-C, D7-D). */
export const RUNS_AS_HINT =
  "Each person's role at the source is named by this, and made by the source's administrator, who grants it to the connection's account. The account must read nothing of its own, and SQL written by hand is not allowed on the connection.";

export const TLS_LABELS: Readonly<Record<Draft['tls'], string>> = {
  require: 'Required',
  verifyFull: "Required, and the source's certificate checked",
};

/**
 * A PostgreSQL source's settings as fields: what anybody who may read the connection sees, and never
 * its password, which has a field of its own.
 */
export function SettingsFields({
  draft,
  onChange,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
}) {
  const field = (key: Exclude<keyof Draft, 'tls' | 'runsAs'>) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...draft, [key]: event.target.value }),
  });
  return (
    <>
      <label>
        Name
        <input {...field('name')} />
      </label>
      <label>
        Description
        <textarea rows={2} {...field('description')} />
      </label>
      <label>
        Host
        <input {...field('host')} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        Port
        <input {...field('port')} inputMode="numeric" />
      </label>
      <label>
        Database
        <input {...field('database')} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        Account
        <input {...field('account')} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        TLS
        <select
          value={draft.tls}
          onChange={(event) => onChange({ ...draft, tls: event.target.value as Draft['tls'] })}
        >
          {(Object.keys(TLS_LABELS) as Draft['tls'][]).map((tls) => (
            <option key={tls} value={tls}>
              {TLS_LABELS[tls]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Runs as
        <select
          value={draft.runsAs}
          onChange={(event) => onChange({ ...draft, runsAs: event.target.value as RunsAs })}
        >
          {(Object.keys(RUNS_AS_LABELS) as RunsAs[]).map((runsAs) => (
            <option key={runsAs} value={runsAs}>
              {RUNS_AS_LABELS[runsAs]}
            </option>
          ))}
        </select>
      </label>
      {draft.runsAs !== 'service' && <p>{RUNS_AS_HINT}</p>}
    </>
  );
}
