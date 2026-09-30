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
}

export const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  host: '',
  port: '5432',
  database: '',
  account: '',
  tls: 'require',
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
  };
}

/**
 * The settings a draft stands for, keeping what the form does not show - the identity - from the
 * version it was opened at, and whether it is retired. The service checks every rule again.
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
    identity: kept.identity,
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
  const field = (key: Exclude<keyof Draft, 'tls'>) => ({
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
    </>
  );
}
