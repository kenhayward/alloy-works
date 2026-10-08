import { createHash } from 'node:crypto';
import {
  ConnectionRefused,
  connectionChangeProblems,
  connectionTarget,
  parseConnection,
  parseConnectionForWrite,
  type ConnectionProblem,
  type ConnectionSettings,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { labelled, labels, recordEvent } from './audit.js';
import {
  checkedLimit,
  countOf,
  facetOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type FacetCount,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { ConnectionInUse } from './definition-references.js';
import { definitionsNaming, type NamingDefinitions } from './queryDefinitions.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A principal as a connection's page names them: by name, or by email where they have none. */
export interface Named {
  readonly id: string;
  readonly name: string | null;
}

/** A connection at its latest version: which it is, its space, and its settings (data.md). */
export interface StoredConnection {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly settings: ConnectionSettings;
}

export type ConnectionAnswer =
  | { readonly answer: 'created' | 'recorded'; readonly connection: StoredConnection }
  | { readonly answer: 'version.unchanged'; readonly connection: StoredConnection }
  /** The latest version is not the one the caller opened from: the connection as it now stands. */
  | { readonly answer: 'version.precondition'; readonly current: StoredConnection }
  /** Settings that do not pass, each problem named (DAT-001, DAT-078); nothing is written. */
  | { readonly answer: 'connection.refused'; readonly problems: readonly ConnectionProblem[] }
  /**
   * A version retiring the connection while a query definition in service names it (DAT-065): those
   * the author may read, by title, and the rest counted. Nothing is cut.
   */
  | { readonly answer: 'connection.in_use'; readonly definitions: NamingDefinitions }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'connection.missing' };

/** Settings as a write takes them, or the problems they are refused with. */
function forWrite(
  value: unknown,
): { readonly settings: ConnectionSettings } | { readonly problems: readonly ConnectionProblem[] } {
  try {
    return { settings: parseConnectionForWrite(value) };
  } catch (error) {
    if (error instanceof ConnectionRefused) return { problems: error.problems };
    throw error;
  }
}

async function storedConnection(
  trx: TenantTransaction,
  version: StoredVersion,
): Promise<StoredConnection> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  return {
    id: version.artifactId,
    space,
    version,
    // Read by the shape alone: a declaration widened later never makes a stored version unreadable.
    settings: parseConnection(version.content),
  };
}

/** A connection at its latest version, or undefined where this tenant holds no connection by that id. */
export async function readConnection(
  trx: TenantTransaction,
  id: string,
): Promise<StoredConnection | undefined> {
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'connection') return undefined;
  return storedConnection(trx, version);
}

/**
 * Makes a connection at 0.1 in a space (DAT-001), from settings that pass the shape and the
 * declaration check. A connection is made in service: one made retired is refused, since retiring is
 * a version of a connection that was in use.
 */
export async function createConnection(
  trx: TenantTransaction,
  input: { readonly author: string; readonly spaceId: string; readonly settings: unknown },
): Promise<ConnectionAnswer> {
  const parsed = forWrite(input.settings);
  if ('problems' in parsed) return { answer: 'connection.refused', problems: parsed.problems };
  if (parsed.settings.retired) {
    return {
      answer: 'connection.refused',
      problems: [
        {
          rule: 'connection_invalid',
          path: 'retired',
          message: 'A connection is made in service; retiring it is a later version',
        },
      ],
    };
  }
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  const version = await createArtifact(trx, {
    spaceId: input.spaceId,
    author: input.author,
    substance: { kind: 'connection', content: parsed.settings },
  });
  const connection = await storedConnection(trx, version);
  await recordConnectionEvent(trx, 'connection.made', connection);
  return { answer: 'created', connection };
}

type ConnectionEvent =
  | 'connection.made'
  | 'connection.changed'
  | 'connection.credential_set'
  | 'connection.tested'
  | 'connection.retired';

/**
 * A connection's act on the log (DAT-007; the AU1 plan, AU1-K), against the version it was done to,
 * by its name then and its space's. Never a value: settings by name, a test by its outcome's code.
 */
async function recordConnectionEvent(
  trx: TenantTransaction,
  kind: ConnectionEvent,
  connection: Pick<StoredConnection, 'id' | 'space' | 'settings'> & {
    readonly version: Pick<StoredVersion, 'id'>;
  },
  detail: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'connection', id: connection.id, version: connection.version.id },
      space: connection.space.id,
      detail,
    },
    labels(
      labelled('subject', connection.settings.name, connection.id),
      labelled('space', connection.space.name, connection.space.id),
    ),
  );
}

/** Every setting, by its dotted name, whose value differs between two versions; never the values. */
export function changedSettings(before: unknown, after: unknown, path = ''): string[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys
      .flatMap((key) => changedSettings(before[key], after[key], path ? `${path}.${key}` : key))
      .sort();
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [path];
}

/**
 * A version recorded: retiring it is `connection.retired`, and any other setting it changes is
 * `connection.changed`, naming exactly those (DAT-007).
 */
async function recordConnectionChange(
  trx: TenantTransaction,
  before: ConnectionSettings,
  after: StoredConnection,
): Promise<void> {
  const retiring = after.settings.retired && !before.retired;
  const changed = changedSettings(before, after.settings).filter(
    (name) => !(retiring && name === 'retired'),
  );
  if (changed.length > 0) {
    await recordConnectionEvent(trx, 'connection.changed', after, { settings: changed });
  }
  if (retiring) await recordConnectionEvent(trx, 'connection.retired', after);
}

/**
 * Cuts a connection's next version from the one its administrator opened, from whole settings that
 * pass as a new connection's must (DAT-007). Retiring and reinstating are versions like any other, and
 * retiring one a query definition in service still names is refused, naming the definitions (DAT-065).
 */
export async function recordConnectionVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly settings: unknown;
  },
): Promise<ConnectionAnswer> {
  const current = await readConnection(trx, input.id);
  if (!current) return { answer: 'connection.missing' };
  const parsed = forWrite(input.settings);
  if ('problems' in parsed) return { answer: 'connection.refused', problems: parsed.problems };
  // A connection's type never changes: every definition naming it was written for it (D6-A).
  const changed = connectionChangeProblems(current.settings, parsed.settings);
  if (changed.length > 0) return { answer: 'connection.refused', problems: changed };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'connection', content: parsed.settings },
    });
  } catch (error) {
    if (!(error instanceof ConnectionInUse)) throw error;
    return {
      answer: 'connection.in_use',
      definitions: await definitionsNaming(trx, input.author, input.id, { inService: true }),
    };
  }
  switch (answer.answer) {
    case 'recorded': {
      const connection = await storedConnection(trx, answer.version);
      await recordConnectionChange(trx, current.settings, connection);
      return { answer: 'recorded', connection };
    }
    case 'version.unchanged':
      return {
        answer: 'version.unchanged',
        connection: await storedConnection(trx, answer.current),
      };
    case 'version.precondition':
      return {
        answer: 'version.precondition',
        current: await storedConnection(trx, answer.current),
      };
    case 'artifact.missing':
      return { answer: 'connection.missing' };
  }
}

/**
 * The digest a credential row is bound to (the D1 fix, C3): SHA-256, in hex, of the connection's
 * target - type, host, port, database, account and TLS - at the version it was set against.
 */
export function targetDigest(settings: Pick<ConnectionSettings, 'type' | 'source'>): string {
  return createHash('sha256').update(connectionTarget(settings), 'utf8').digest('hex');
}

/**
 * Whether a connection's credential is set, and by whom and when: never the value (DAT-004). Where
 * the connection's target has changed since, `targetChanged`: it will not be used again, and its
 * password must be set again.
 */
export type CredentialState =
  | { readonly set: false }
  | {
      readonly set: true;
      readonly setBy: Named;
      readonly setAt: Date;
      readonly targetChanged: boolean;
      /**
       * Set before migration 0045 bound credentials to a target: it names none, so it is never used,
       * though nothing about the connection changed (the D1 fix, round two). `targetChanged` is true.
       */
      readonly setBeforeBinding: boolean;
    };

/**
 * Adds a credential row: the sealed value the connector answered, who set it, by the database's clock
 * when (DAT-003, DAT-007), and the digest of the target it was sealed for - `sealedFor`, the settings
 * the caller handed the connector, never the latest version's as read here, which a version saved
 * while the connector sealed would have moved (the D1 fix, round two). A later version pointing
 * elsewhere, that one included, leaves it unusable and says so. It cuts no version (DAT-066). A
 * retired connection takes none.
 */
export async function setConnectionCredential(
  trx: TenantTransaction,
  input: {
    readonly id: string;
    readonly sealed: string;
    readonly by: string;
    readonly sealedFor: Pick<ConnectionSettings, 'type' | 'source'>;
  },
): Promise<
  | {
      readonly answer: 'set';
      readonly credential: CredentialState & { readonly set: true };
      /** The row's own number, which a test made with it records. */
      readonly credentialId: string;
    }
  | { readonly answer: 'connection.missing' | 'connection.retired' }
> {
  const current = await readConnection(trx, input.id);
  if (!current) return { answer: 'connection.missing' };
  if (current.settings.retired) return { answer: 'connection.retired' };
  const row = await trx
    .insertInto('connection_credential')
    .values({
      connection_id: input.id,
      sealed: input.sealed,
      set_by: input.by,
      target_digest: targetDigest(input.sealedFor),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const credential = await credentialOf(trx, input.id);
  if (!credential.set) throw new Error(`The credential of ${input.id} was set and cannot be read`);
  // That it was set, against the version it was set for; never its value, sealed or not (DAT-007).
  await recordConnectionEvent(trx, 'connection.credential_set', current);
  return { answer: 'set', credential, credentialId: String(row.id) };
}

async function latestCredential(trx: TenantTransaction, id: string) {
  return trx
    .selectFrom('connection_credential as c')
    .innerJoin('principal as p', 'p.id', 'c.set_by')
    .select([
      'c.id',
      'c.sealed',
      'c.set_by',
      'c.set_at',
      'c.target_digest',
      'p.display_name',
      'p.email',
    ])
    .where('c.connection_id', '=', id)
    .orderBy('c.id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/** The latest credential row's who and when, and whether its target still holds; never its value. */
export async function credentialOf(trx: TenantTransaction, id: string): Promise<CredentialState> {
  if (!UUID.test(id)) return { set: false };
  const row = await latestCredential(trx, id);
  if (!row) return { set: false };
  const current = await readConnection(trx, id);
  return {
    set: true,
    setBy: { id: row.set_by, name: row.display_name ?? row.email ?? null },
    setAt: row.set_at,
    targetChanged: !current || row.target_digest !== targetDigest(current.settings),
    setBeforeBinding: row.target_digest === null,
  };
}

/**
 * The latest sealed value, for the service to hand the connector with a request and for nothing
 * else - no route answers it, and the service cannot open it - and only while the connection's
 * latest version has the target it was set for (the D1 fix, C3); with its row's number, which the
 * test made with it records.
 */
export async function usableCredentialOf(
  trx: TenantTransaction,
  id: string,
): Promise<
  | { readonly answer: 'usable'; readonly sealed: string; readonly credentialId: string }
  | { readonly answer: 'missing' | 'target_changed' | 'unbound' }
> {
  if (!UUID.test(id)) return { answer: 'missing' };
  const row = await latestCredential(trx, id);
  if (!row) return { answer: 'missing' };
  if (row.target_digest === null) return { answer: 'unbound' };
  const current = await readConnection(trx, id);
  if (!current || row.target_digest !== targetDigest(current.settings)) {
    return { answer: 'target_changed' };
  }
  return { answer: 'usable', sealed: row.sealed, credentialId: String(row.id) };
}

/** A finding a test may record (D1-M; the D7 plan, D7-D, by 0054). */
export type ConnectionFinding = 'account_not_read_only' | 'account_holds_privilege';

/** The failures a test may record: its own four (the D1 plan's stored-shape check, row 13). */
export type ConnectionTestFailure =
  'connection_failed' | 'timeout' | 'connector_error' | 'source_unsupported';

export type ConnectionTestRecord =
  | {
      readonly outcome: 'ok';
      readonly findings: readonly ConnectionFinding[];
      readonly failure: null;
    }
  | {
      readonly outcome: 'failed';
      readonly findings: readonly [];
      readonly failure: ConnectionTestFailure;
    };

/**
 * Records a test the connector answered, against the connection version it tested (D1-N) and the
 * credential row it was made with (the D1 fix, round two), and answers when, by the database's clock.
 */
export async function recordConnectionTest(
  trx: TenantTransaction,
  input: {
    readonly connectionId: string;
    readonly versionId: string;
    readonly credentialId: string;
    readonly by: string;
  } & ConnectionTestRecord,
): Promise<Date> {
  const row = await trx
    .insertInto('connection_test')
    .values({
      connection_id: input.connectionId,
      connection_version_id: input.versionId,
      credential_id: input.credentialId,
      outcome: input.outcome,
      findings: [...input.findings],
      failure: input.failure,
      tested_by: input.by,
    })
    .returning('tested_at')
    .executeTakeFirstOrThrow();
  // Against the version it tested, by that version's name: a newer one may have been cut meanwhile.
  const tested = await trx
    .selectFrom('artifact_version as v')
    .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['v.content', 's.id as space_id', 's.name as space_name'])
    .where('v.id', '=', input.versionId)
    .executeTakeFirstOrThrow();
  await recordConnectionEvent(
    trx,
    'connection.tested',
    {
      id: input.connectionId,
      version: { id: input.versionId },
      space: { id: tested.space_id, name: tested.space_name },
      settings: parseConnection(tested.content),
    },
    {
      outcome: input.outcome,
      findings: [...input.findings],
      ...(input.failure === null ? {} : { failure: input.failure }),
    },
  );
  return row.tested_at;
}

export type LatestConnectionTest = ConnectionTestRecord & {
  readonly at: Date;
  readonly by: Named;
  /** The connection version it tested. */
  readonly version: string;
  /**
   * Whether it was made with the credential set now: a test of an earlier credential, answered after
   * a newer one was set, is no test of the one in use, as a test of an earlier version is none of the
   * latest (the D1 fix, round two).
   */
  readonly credentialCurrent: boolean;
};

/** Whether a test row was made with its connection's latest credential row, as SQL reads it. */
const CREDENTIAL_CURRENT = sql<boolean>`coalesce(t.credential_id = (
    select max(c.id) from connection_credential c where c.connection_id = t.connection_id), false)`;

/** The latest test of a connection, or undefined where none has been recorded. */
export async function latestConnectionTest(
  trx: TenantTransaction,
  id: string,
): Promise<LatestConnectionTest | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('connection_test as t')
    .innerJoin('principal as p', 'p.id', 't.tested_by')
    .select([
      't.outcome',
      't.findings',
      't.failure',
      't.tested_at',
      't.tested_by',
      't.connection_version_id',
      'p.display_name',
      'p.email',
    ])
    .select(CREDENTIAL_CURRENT.as('credential_current'))
    .where('t.connection_id', '=', id)
    .orderBy('t.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  const heading = {
    at: row.tested_at,
    by: { id: row.tested_by, name: row.display_name ?? row.email ?? null },
    version: row.connection_version_id,
    credentialCurrent: row.credential_current,
  };
  return row.outcome === 'ok'
    ? {
        outcome: 'ok',
        findings: row.findings as ConnectionFinding[],
        failure: null,
        ...heading,
      }
    : {
        outcome: 'failed',
        findings: [],
        failure: row.failure as ConnectionTestFailure,
        ...heading,
      };
}

/** One connection as a listing shows it. */
export interface ConnectionSummary {
  readonly id: string;
  readonly name: string;
  readonly type: ConnectionSettings['type'];
  readonly retired: boolean;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  /** When its latest version was made. */
  readonly changedAt: Date;
  readonly credentialSet: boolean;
  /**
   * The last test, the version it tested, which need not be the latest (the D1 fix, C7), and whether
   * it was made with the credential set now.
   */
  readonly lastTest: {
    readonly outcome: 'ok' | 'failed';
    readonly at: Date;
    readonly version: string;
    readonly credentialCurrent: boolean;
  } | null;
}

/**
 * The connections a principal may read, a page at a time by keyset over the sort asked for and then
 * the id, as of the snapshot the walk's first page took, filtered by the readable set inside the query
 * - as `listReadableTemplates` pages. Undefined when the tenant holds no such principal.
 */
export async function listReadableConnections(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'connections'>> = { limit: 100 },
  filter: { readonly spaces?: readonly string[] } = {},
): Promise<
  | (Listed<ConnectionSummary> & {
      readonly total: number;
      readonly facets: { readonly spaces: readonly FacetCount[] };
    })
  | undefined
> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'name';
  const { types, order: byDefault } = listingSorts.connections[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const base = (leaving?: 'spaces') =>
    trx
      .selectFrom('artifact as a')
      .innerJoin('space as s', 's.id', 'a.space_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select([
              'v.id as version_id',
              'v.revision_no',
              'v.version_no',
              'v.created_at',
              sql<string>`v.content ->> 'name'`.as('name'),
              sql<string>`v.content ->> 'type'`.as('type'),
              sql<boolean>`(v.content ->> 'retired')::boolean`.as('retired'),
              sql<ConnectionSettings['source']>`v.content -> 'source'`.as('source'),
            ])
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.name'])
      .select(['latest.type', 'latest.retired', 'latest.source'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(sortColumns([sort === 'name' ? sql`latest.name` : sql`latest.created_at`]))
      .where('a.kind', '=', 'connection')
      .where((eb) => readableArtifacts(eb, readable))
      .$if(filter.spaces !== undefined && leaving !== 'spaces', (query) =>
        filter.spaces!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('a.space_id', 'in', [...filter.spaces!]),
      );
  const { rows, next } = await keysetPage<{
    id: string;
    name: string;
    type: ConnectionSettings['type'];
    retired: boolean;
    source: ConnectionSettings['source'];
    space_id: string;
    space_name: string;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after);
  // Whether each has a credential, and its last test: read for the page's rows alone.
  const ids = rows.map((row) => row.id);
  const credentials =
    ids.length === 0
      ? []
      : await trx
          .selectFrom('connection_credential')
          .select(['connection_id', 'target_digest'])
          .distinctOn('connection_id')
          .where('connection_id', 'in', ids)
          .orderBy('connection_id')
          .orderBy('id', 'desc')
          .execute();
  const tests =
    ids.length === 0
      ? []
      : await trx
          .selectFrom('connection_test as t')
          .select(['t.connection_id', 't.outcome', 't.tested_at', 't.connection_version_id'])
          .select(CREDENTIAL_CURRENT.as('credential_current'))
          .distinctOn('t.connection_id')
          .where('t.connection_id', 'in', ids)
          .orderBy('t.connection_id')
          .orderBy('t.id', 'desc')
          .execute();
  // Set, and for the target the latest version names: a credential for another is no credential.
  const latestDigest = new Map(credentials.map((row) => [row.connection_id, row.target_digest]));
  const lastTests = new Map(
    tests.map((row) => [
      row.connection_id,
      {
        outcome: row.outcome,
        at: row.tested_at,
        version: row.connection_version_id,
        credentialCurrent: row.credential_current,
      },
    ]),
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      retired: row.retired,
      space: { id: row.space_id, name: row.space_name },
      version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
      changedAt: new Date(row.created_at),
      credentialSet:
        latestDigest.get(row.id) === targetDigest({ type: row.type, source: row.source }),
      lastTest: lastTests.get(row.id) ?? null,
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: { spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name') },
  };
}
