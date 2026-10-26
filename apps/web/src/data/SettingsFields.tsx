import type { ExtensionSetting, ExtensionSettings } from '@alloy-works/domain';

import { connectable, type Extensions, type InstalledExtension } from './extensions.js';
import type { Settings } from './shapes.js';
import { words } from '../words/words.js';

/** The types of source a connection reaches: a PostgreSQL database, an HTTP API, an S3 bucket (D6) or an extension's (EX). */
export type SourceType = Settings['type'];

export const TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  get postgres() {
    return words('data.a-postgresql-database');
  },
  get http() {
    return words('data.an-http-api-2');
  },
  get s3() {
    return words('data.an-s3-bucket-2');
  },
  get extension() {
    return words('data.an-extension-2');
  },
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
  /** An extension's connection: the manifest it is saved against, and its settings as typed (EX-D). */
  readonly extension: ExtensionDraft | null;
}

/**
 * An extension's connection as the form holds it: the snapshot of the manifest it is saved against,
 * that manifest's fields, and each one's value as typed, a number as text and a yes or no a boolean.
 */
export interface ExtensionDraft {
  readonly source: Omit<ExtensionSettings['source'], 'settings'>;
  readonly fields: readonly ExtensionSetting[];
  readonly values: Readonly<Record<string, string | boolean>>;
  /** The endpoint of the version opened, where one was: a move from it needs the secret again. */
  readonly savedEndpoint?: string;
}

/**
 * A snapshot of an installed extension's manifest now (EX-D), keeping each value already typed for a
 * field of the same key and type.
 */
export function extensionDraftOf(
  installed: InstalledExtension,
  kept: ExtensionDraft | null = null,
): ExtensionDraft {
  const { manifest } = installed;
  const values: Record<string, string | boolean> = {};
  for (const field of manifest.settings) {
    const held = kept && Object.hasOwn(kept.values, field.key) ? kept.values[field.key] : undefined;
    const was = kept?.fields.find((each) => each.key === field.key)?.type;
    values[field.key] =
      held !== undefined && was === field.type ? held : field.type === 'boolean' ? false : '';
  }
  return {
    source: {
      extension: installed.id,
      digest: installed.digest,
      endpoint: manifest.endpoint,
      authenticated: manifest.authentication !== 'none',
      capabilities: { ...manifest.capabilities },
    },
    fields: manifest.settings,
    values,
    ...(kept?.savedEndpoint === undefined ? {} : { savedEndpoint: kept.savedEndpoint }),
  };
}

/**
 * An extension connection's settings as saved: its fields read from the values it holds, labelled by
 * their keys, until the manifest it was saved against is read (EX-D).
 */
function extensionDraftFrom(source: ExtensionSettings['source']): ExtensionDraft {
  const { settings: given, ...snapshot } = source;
  return {
    source: snapshot,
    savedEndpoint: snapshot.endpoint,
    fields: Object.entries(given).map(([key, value]) => ({
      key,
      label: key,
      type: typeof value === 'string' ? 'text' : (typeof value as 'number' | 'boolean'),
      required: false,
    })),
    values: Object.fromEntries(
      Object.entries(given).map(([key, value]) => [
        key,
        typeof value === 'number' ? String(value) : value,
      ]),
    ),
  };
}

/** The manifest's own fields, where the one a draft is saved against is the extension's now. */
export function withManifestFields(draft: Draft, extensions: Extensions): Draft {
  if (draft.extension === null || !Array.isArray(extensions)) return draft;
  const { source } = draft.extension;
  const now = extensions.find((each) => each.id === source.extension);
  if (now === undefined || now.digest !== source.digest) return draft;
  return { ...draft, extension: extensionDraftOf(now, draft.extension) };
}

/** The extension's settings as the service takes them, or the first reason not. */
function extensionValues(
  extension: ExtensionDraft,
): Record<string, string | number | boolean> | string {
  const values: Record<string, string | number | boolean> = {};
  for (const field of extension.fields) {
    const typed = Object.hasOwn(extension.values, field.key)
      ? extension.values[field.key]
      : undefined;
    if (field.type === 'boolean') {
      values[field.key] = typed === true;
      continue;
    }
    const text = typeof typed === 'string' ? typed.trim() : '';
    if (text === '') {
      if (field.required) return words('data.is-required', { label: field.label });
      continue;
    }
    if (field.type === 'number') {
      const number = Number(text);
      if (!Number.isFinite(number)) return words('data.is-a-number', { label: field.label });
      values[field.key] = number;
    } else values[field.key] = text;
  }
  return values;
}

export type RunsAs = 'service' | 'email' | 'subject';

export const RUNS_AS_LABELS: Readonly<Record<RunsAs, string>> = {
  get service() {
    return words('data.the-connection-s-account');
  },
  get email() {
    return words('data.each-person-by-the-email');
  },
  get subject() {
    return words('data.each-person-by-their-identifier');
  },
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
  extension: null,
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
  if (settings.type === 'extension') {
    return { ...common, extension: extensionDraftFrom(settings.source) };
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
  if (draft.type === 'extension' && draft.extension !== null) {
    // Called as its own account alone (EX-F); a value the form cannot read is the draft's problem.
    const values = extensionValues(draft.extension);
    return {
      ...common,
      type: 'extension',
      source: { ...draft.extension.source, settings: typeof values === 'string' ? {} : values },
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
  if (draft.name.trim() === '') return words('data.a-connection-needs-a-name');
  if (draft.type === 'extension') {
    if (draft.extension === null) return words('data.choose-the-extension-it-reaches');
    const values = extensionValues(draft.extension);
    return typeof values === 'string' ? values : null;
  }
  if (draft.type === 'http') {
    if (!/^https?:\/\/[^/?#]+/.test(draft.baseUrl.trim())) {
      return words('data.a-base-url-starts-http');
    }
    if (draft.secretHeader.trim() === '') return words('data.a-connection-needs-the-header');
    return null;
  }
  if (draft.type === 's3') {
    if (!/^https?:\/\/[^/?#]+$/.test(draft.endpoint.trim())) {
      return words('data.an-endpoint-starts-http-or');
    }
    if (draft.region.trim() === '') return words('data.a-connection-needs-the-region');
    if (draft.bucket.trim() === '') return words('data.a-connection-needs-the-name');
    return null;
  }
  if (draft.host.trim() === '') return words('data.a-connection-needs-the-host');
  if (!/^\d{1,5}$/.test(draft.port) || Number(draft.port) < 1 || Number(draft.port) > 65535) {
    return words('data.a-port-is-a-whole');
  }
  if (draft.database === '') return words('data.a-connection-needs-the-name-2');
  if (draft.account === '') return words('data.a-connection-needs-the-account');
  return null;
}

/** What running as each person asks of the source, said beside the choice (the D7 plan, D7-C, D7-D). */
export const RUNS_AS_HINT =
  "Each person's role at the source is named by this, and made by the source's administrator, who grants it to the connection's account. The account must read nothing of its own, and SQL written by hand is not allowed on the connection.";

/** How an S3 bucket is addressed, said beside the choice (the D6 plan, D6-C). */
export const PATH_STYLE_LABELS = {
  get virtual() {
    return words('data.by-its-name-before-the');
  },
  get path() {
    return words('data.in-the-endpoint-s-path');
  },
} as const;

/** What an S3 connection's key pair is, said beside its fields. */
export const KEY_PAIR_HINT =
  "A static access key pair. Give it read access to this bucket alone: the store's own policy decides what the connection may read.";

/** What an HTTP connection's secret is, said beside its header (the D6 plan, D6-D). */
export const SECRET_HEADER_HINT =
  'The secret is sent as this header, exactly as it is set: write "Bearer" and a space before a token where the API asks for one. It is never put in a URL.';

export const TLS_LABELS: Readonly<Record<Draft['tls'], string>> = {
  get require() {
    return words('data.required');
  },
  get verifyFull() {
    return words('data.required-and-the-source-s');
  },
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
  extensions = null,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
  readonly typeFixed?: boolean;
  /** The extensions installed, which an extension's connection is made against (EX-D). */
  readonly extensions?: Extensions;
}) {
  const field = (
    key: Exclude<keyof Draft, 'tls' | 'runsAs' | 'type' | 'pathStyle' | 'extension'>,
  ) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...draft, [key]: event.target.value }),
  });
  return (
    <>
      {typeFixed ? null : (
        <label>
          {words('data.type')}
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
        {words('data.name')}
        <input {...field('name')} />
      </label>
      <label>
        {words('data.description')}
        <textarea rows={2} {...field('description')} />
      </label>
      {draft.type === 'extension' ? (
        <ExtensionFields
          draft={draft}
          onChange={onChange}
          typeFixed={typeFixed}
          extensions={extensions}
        />
      ) : draft.type === 's3' ? (
        <>
          <label>
            {words('data.endpoint')}
            <input {...field('endpoint')} autoComplete="off" spellCheck={false} inputMode="url" />
          </label>
          <label>
            {words('data.region')}
            <input {...field('region')} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            {words('data.bucket')}
            <input {...field('bucket')} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            {words('data.addressed')}
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
            {words('data.base-url')}
            <input {...field('baseUrl')} autoComplete="off" spellCheck={false} inputMode="url" />
          </label>
          <label>
            {words('data.secret-header')}
            <input {...field('secretHeader')} autoComplete="off" spellCheck={false} />
          </label>
          <p>{SECRET_HEADER_HINT}</p>
        </>
      ) : (
        <>
          <label>
            {words('data.host')}
            <input {...field('host')} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            {words('data.port')}
            <input {...field('port')} inputMode="numeric" />
          </label>
          <label>
            {words('data.database')}
            <input {...field('database')} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            {words('data.account')}
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
            {words('data.runs-as')}
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

/** What is said where the extensions cannot be listed, by why. */
const UNLISTED: Readonly<Record<'refused' | 'failed', string>> = {
  get refused() {
    return words('data.only-somebody-who-administers-the');
  },
  get failed() {
    return words('data.the-extensions-could-not-be');
  },
};

/**
 * An extension's half of the settings (the EX plan, EX-D): the extension chosen when the connection is
 * made, then its manifest's fields; and, on a saved one whose extension has a newer manifest, the
 * choice to save against it, its endpoint, settings and capabilities with it.
 */
function ExtensionFields({
  draft,
  onChange,
  typeFixed,
  extensions,
}: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
  readonly typeFixed: boolean;
  readonly extensions: Extensions;
}) {
  const held = draft.extension;
  const listed = Array.isArray(extensions) ? extensions : [];
  const latest =
    held === null ? undefined : listed.find((each) => each.id === held.source.extension);
  const newer = typeFixed && latest !== undefined && latest.digest !== held?.source.digest;
  const setValue = (key: string, value: string | boolean) =>
    held !== null &&
    onChange({ ...draft, extension: { ...held, values: { ...held.values, [key]: value } } });
  return (
    <>
      {!typeFixed &&
        (extensions === 'refused' || extensions === 'failed' ? (
          <p>{UNLISTED[extensions]}</p>
        ) : (
          <label>
            {words('data.extension')}
            <select
              value={held?.source.extension ?? ''}
              onChange={(event) => {
                const chosen = listed.find((each) => each.id === event.target.value);
                onChange({
                  ...draft,
                  extension: chosen === undefined ? null : extensionDraftOf(chosen),
                });
              }}
            >
              <option value="">{words('data.choose-an-extension')}</option>
              {connectable(listed).map((each) => (
                <option key={each.id} value={each.id}>
                  {`${each.manifest.name} ${each.manifest.version}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      {held !== null && (
        <>
          <p>{words('data.its-calls-go-to', { endpoint: held.source.endpoint })}</p>
          {held.fields.map((field) => {
            const label = field.required
              ? words('data.required-2', { label: field.label })
              : field.label;
            const value = held.values[field.key];
            return field.type === 'boolean' ? (
              <label key={field.key}>
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => setValue(field.key, event.target.checked)}
                />
                {label}
              </label>
            ) : (
              <label key={field.key}>
                {label}
                <input
                  value={typeof value === 'string' ? value : ''}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setValue(field.key, event.target.value)}
                />
              </label>
            );
          })}
        </>
      )}
      {newer && latest !== undefined && held !== null && (
        <>
          <p>
            {words('data.has-a-newer-manifest-this', {
              name: latest.manifest.name,
              version: latest.manifest.version,
            })}
          </p>
          <button
            type="button"
            onClick={() => onChange({ ...draft, extension: extensionDraftOf(latest, held) })}
          >
            {words('data.use-the-latest-manifest')}
          </button>
        </>
      )}
      {typeFixed && draft.extension !== null && moved(draft.extension, latest) && (
        <p>
          {words('data.its-endpoint-moves-to-so', { endpoint: draft.extension.source.endpoint })}
        </p>
      )}
    </>
  );
}

/** Whether a draft now stands on the latest manifest, whose endpoint the saved one did not. */
const moved = (draft: ExtensionDraft, latest: InstalledExtension | undefined) =>
  latest !== undefined &&
  draft.source.digest === latest.digest &&
  draft.savedEndpoint !== undefined &&
  draft.savedEndpoint !== draft.source.endpoint;
