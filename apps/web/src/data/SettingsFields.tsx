import type { Settings } from './shapes.js';

/** The types of source a connection reaches: a PostgreSQL database, an HTTP API or an S3 bucket (D6). */
export type SourceType = Settings['type'];

export const TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  postgres: 'A PostgreSQL database',
  http: 'An HTTP API',
  s3: 'An S3 bucket',
};

/** What the settings form holds while it is being written: the port as typed. */
export interface Draft {
  readonly type: SourceType;
  readonly name: string;
  readonly description: string;
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly account: string;
  readonly tls: 'require' | 'verifyFull';
  /** An HTTP source's base URL, and the header its secret is sent in (the D6 plan, D6-D). */
  readonly baseUrl: string;
  readonly secretHeader: string;
  /** An S3 source's endpoint, region, bucket and how the bucket is addressed (the D6 plan, D6-C). */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly pathStyle: boolean;
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
  type: 'postgres',
  name: '',
  description: '',
  host: '',
  port: '5432',
  database: '',
  account: '',
  tls: 'require',
  baseUrl: 'https://',
  secretHeader: 'authorization',
  endpoint: 'https://',
  region: 'us-east-1',
  bucket: '',
  pathStyle: false,
  runsAs: 'service',
};

export function draftOf(settings: Settings): Draft {
  const common = {
    ...EMPTY_DRAFT,
    type: settings.type,
    name: settings.name,
    description: settings.description,
    runsAs: runsAsOf(settings.identity),
  };
  if (settings.type === 'http') {
    return {
      ...common,
      baseUrl: settings.source.baseUrl,
      secretHeader: settings.source.secretHeader,
    };
  }
  if (settings.type === 's3') {
    return { ...common, ...settings.source };
  }
  return {
    ...common,
    host: settings.source.host,
    port: String(settings.source.port),
    database: settings.source.database,
    account: settings.source.account,
    tls: settings.source.tls,
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
  const common = {
    schemaVersion: 1 as const,
    name: draft.name.trim(),
    description: draft.description,
    retired: kept.retired,
  };
  if (draft.type === 'http') {
    // An HTTP connection runs as its own secret alone (ADR-0041).
    return {
      ...common,
      type: 'http',
      source: { baseUrl: draft.baseUrl.trim(), secretHeader: draft.secretHeader.trim() },
      identity: { kind: 'service' },
    };
  }
  if (draft.type === 's3') {
    // An S3 connection reads as its key pair alone: a store has no person's identity (DAT-077).
    return {
      ...common,
      type: 's3',
      source: {
        endpoint: draft.endpoint.trim(),
        region: draft.region.trim(),
        bucket: draft.bucket.trim(),
        pathStyle: draft.pathStyle,
      },
      identity: { kind: 'service' },
    };
  }
  return {
    ...common,
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
  };
}

/** What stops a draft being sent, said in a sentence; null where nothing does. */
export function draftProblem(draft: Draft): string | null {
  if (draft.name.trim() === '') return 'A connection needs a name.';
  if (draft.type === 'http') {
    if (!/^https?:\/\/[^/?#]+/.test(draft.baseUrl.trim())) {
      return 'A base URL starts http:// or https:// and names its host.';
    }
    if (draft.secretHeader.trim() === '')
      return 'A connection needs the header its secret is sent in.';
    return null;
  }
  if (draft.type === 's3') {
    if (!/^https?:\/\/[^/?#]+$/.test(draft.endpoint.trim())) {
      return 'An endpoint starts http:// or https:// and names its host, and its port if it needs one, as https://storage.example.com:9000.';
    }
    if (draft.region.trim() === '') return 'A connection needs the region of its bucket.';
    if (draft.bucket.trim() === '') return 'A connection needs the name of its bucket.';
    return null;
  }
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

/** How an S3 bucket is addressed, said beside the choice (the D6 plan, D6-C). */
export const PATH_STYLE_LABELS = {
  virtual: 'By its name before the endpoint, as AWS addresses buckets',
  path: "In the endpoint's path, as MinIO and SeaweedFS do by default",
} as const;

/** What an S3 connection's key pair is, said beside its fields. */
export const KEY_PAIR_HINT =
  "A static access key pair. Give it read access to this bucket alone: the store's own policy decides what the connection may read.";

/** What an HTTP connection's secret is, said beside its header (the D6 plan, D6-D). */
export const SECRET_HEADER_HINT =
  'The secret is sent as this header, exactly as it is set: write "Bearer" and a space before a token where the API asks for one. It is never put in a URL.';

export const TLS_LABELS: Readonly<Record<Draft['tls'], string>> = {
  require: 'Required',
  verifyFull: "Required, and the source's certificate checked",
};

/**
 * A source's settings as fields, by its type: what anybody who may read the connection sees, and
 * never its password or secret, which has a field of its own. A connection's type is chosen when it
 * is made and never changes, so a saved one's is shown and not offered.
 */
export function SettingsFields({
  draft,
  onChange,
  typeFixed = false,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
  readonly typeFixed?: boolean;
}) {
  const field = (key: Exclude<keyof Draft, 'tls' | 'runsAs' | 'type' | 'pathStyle'>) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...draft, [key]: event.target.value }),
  });
  return (
    <>
      {typeFixed ? null : (
        <label>
          Type
          <select
            value={draft.type}
            onChange={(event) => onChange({ ...draft, type: event.target.value as SourceType })}
          >
            {(Object.keys(TYPE_LABELS) as SourceType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Name
        <input {...field('name')} />
      </label>
      <label>
        Description
        <textarea rows={2} {...field('description')} />
      </label>
      {draft.type === 's3' ? (
        <>
          <label>
            Endpoint
            <input {...field('endpoint')} autoComplete="off" spellCheck={false} inputMode="url" />
          </label>
          <label>
            Region
            <input {...field('region')} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            Bucket
            <input {...field('bucket')} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            Addressed
            <select
              value={draft.pathStyle ? 'path' : 'virtual'}
              onChange={(event) => onChange({ ...draft, pathStyle: event.target.value === 'path' })}
            >
              <option value="virtual">{PATH_STYLE_LABELS.virtual}</option>
              <option value="path">{PATH_STYLE_LABELS.path}</option>
            </select>
          </label>
        </>
      ) : draft.type === 'http' ? (
        <>
          <label>
            Base URL
            <input {...field('baseUrl')} autoComplete="off" spellCheck={false} inputMode="url" />
          </label>
          <label>
            Secret header
            <input {...field('secretHeader')} autoComplete="off" spellCheck={false} />
          </label>
          <p>{SECRET_HEADER_HINT}</p>
        </>
      ) : (
        <>
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
      )}
    </>
  );
}
