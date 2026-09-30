import type { ConnectionSettings } from '@alloy-works/domain';

/**
 * The connection routes' answers as the pages read them, checked rather than trusted, as the access
 * page's are (access/describe.ts): a page that trusted one would crash on the first member a service
 * of another version left out.
 */

/** A connection's settings: the domain's own shape, which the service checks again on every write. */
export type Settings = ConnectionSettings;

/**
 * Settings as a request body. The generated client spells an absent optional member without `undefined`,
 * where the domain's own type allows it, so the one shape is handed over under the client's name.
 */
export function asBody(settings: Settings): never {
  return settings as never;
}

export interface Named {
  readonly id: string;
  readonly name: string | null;
}

export interface Failure {
  readonly code: string;
  readonly attribution: string;
  readonly message: string;
}

export type Credential =
  { readonly set: false } | { readonly set: true; readonly setBy: Named; readonly setAt: string };

export type Tested =
  | { readonly outcome: 'ok'; readonly findings: readonly string[]; readonly at: string }
  | { readonly outcome: 'failed'; readonly failure: Failure; readonly at: string };

export interface ConnectionView {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly settings: Settings;
  readonly credential: Credential;
  readonly lastTest: {
    readonly outcome: 'ok' | 'failed';
    readonly findings: readonly string[];
    readonly failure?: Failure;
    readonly at: string;
    readonly by: Named;
  } | null;
  readonly mayAdminister: boolean;
  readonly mayUse: boolean;
}

export interface Relation {
  readonly schema: string;
  readonly name: string;
  readonly kind: string;
  readonly columns: readonly { readonly name: string }[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isNamed = (value: unknown): value is Named =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  (value.name === null || typeof value.name === 'string');

const isFailure = (value: unknown): value is Failure =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  typeof value.attribution === 'string' &&
  typeof value.message === 'string';

function isSettings(value: unknown): value is Settings {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.identity)) return false;
  const { source } = value;
  return (
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.retired === 'boolean' &&
    typeof source.host === 'string' &&
    typeof source.port === 'number' &&
    typeof source.database === 'string' &&
    typeof source.account === 'string' &&
    (source.tls === 'require' || source.tls === 'verifyFull')
  );
}

function isCredential(value: unknown): value is Credential {
  if (!isRecord(value)) return false;
  if (value.set === false) return true;
  return value.set === true && isNamed(value.setBy) && typeof value.setAt === 'string';
}

/** A test's answer, as the test route and the credential route give it. */
export function isTested(value: unknown): value is Tested {
  if (!isRecord(value) || typeof value.at !== 'string') return false;
  if (value.outcome === 'ok') {
    return (
      Array.isArray(value.findings) && value.findings.every((each) => typeof each === 'string')
    );
  }
  return value.outcome === 'failed' && isFailure(value.failure);
}

export function isConnectionView(value: unknown): value is ConnectionView {
  if (!isRecord(value)) return false;
  const { space, version, lastTest } = value;
  return (
    typeof value.id === 'string' &&
    isRecord(space) &&
    typeof space.id === 'string' &&
    typeof space.name === 'string' &&
    isRecord(version) &&
    typeof version.id === 'string' &&
    typeof version.number === 'string' &&
    isSettings(value.settings) &&
    isCredential(value.credential) &&
    (lastTest === null ||
      (isRecord(lastTest) &&
        (lastTest.outcome === 'ok' || lastTest.outcome === 'failed') &&
        typeof lastTest.at === 'string' &&
        isNamed(lastTest.by))) &&
    typeof value.mayAdminister === 'boolean' &&
    typeof value.mayUse === 'boolean'
  );
}

export function isRelations(value: unknown): value is {
  readonly relations: readonly Relation[];
  readonly truncated: boolean;
} {
  return (
    isRecord(value) &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.relations) &&
    value.relations.every(
      (each: unknown) =>
        isRecord(each) &&
        typeof each.schema === 'string' &&
        typeof each.name === 'string' &&
        typeof each.kind === 'string' &&
        Array.isArray(each.columns) &&
        each.columns.every(
          (column: unknown) => isRecord(column) && typeof column.name === 'string',
        ),
    )
  );
}

/** The words of a refusal the service sent, where it sent some. */
export function refusalText(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : fallback;
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** A day as a sentence says it: 30 September 2026. */
export function longDate(iso: string): string {
  return LONG_DATE.format(new Date(iso));
}

/** Somebody by name, or as somebody where the service knows none. */
export function nameOf(person: Named): string {
  return person.name ?? 'somebody';
}
