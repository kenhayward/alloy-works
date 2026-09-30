import {
  ConnectionRefused,
  parseConnection,
  parseConnectionForWrite,
  type ConnectionProblem,
  type ConnectionSettings,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
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
  return { answer: 'created', connection: await storedConnection(trx, version) };
}

/**
 * Cuts a connection's next version from the one its administrator opened, from whole settings that
 * pass as a new connection's must (DAT-007). Retiring and reinstating are versions like any other.
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
  const answer = await recordVersion(trx, {
    artifactId: input.id,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: 'connection', content: parsed.settings },
  });
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', connection: await storedConnection(trx, answer.version) };
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

/** Whether a connection's credential is set, and by whom and when: never the value (DAT-004). */
export type CredentialState =
  { readonly set: false } | { readonly set: true; readonly setBy: Named; readonly setAt: Date };

/**
 * Adds a credential row: the sealed value the connector answered, who set it and, by the database's
 * clock, when (DAT-003, DAT-007). It cuts no version (DAT-066). A retired connection takes none.
 */
export async function setConnectionCredential(
  trx: TenantTransaction,
  input: { readonly id: string; readonly sealed: string; readonly by: string },
): Promise<
  | { readonly answer: 'set'; readonly credential: CredentialState & { readonly set: true } }
  | { readonly answer: 'connection.missing' | 'connection.retired' }
> {
  const current = await readConnection(trx, input.id);
  if (!current) return { answer: 'connection.missing' };
  if (current.settings.retired) return { answer: 'connection.retired' };
  await trx
    .insertInto('connection_credential')
    .values({ connection_id: input.id, sealed: input.sealed, set_by: input.by })
    .execute();
  const credential = await credentialOf(trx, input.id);
  if (!credential.set) throw new Error(`The credential of ${input.id} was set and cannot be read`);
  return { answer: 'set', credential };
}

/** The latest credential row's who and when, and nothing of its value. */
export async function credentialOf(trx: TenantTransaction, id: string): Promise<CredentialState> {
  if (!UUID.test(id)) return { set: false };
  const row = await trx
    .selectFrom('connection_credential as c')
    .innerJoin('principal as p', 'p.id', 'c.set_by')
    .select(['c.set_by', 'c.set_at', 'p.display_name', 'p.email'])
    .where('c.connection_id', '=', id)
    .orderBy('c.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return { set: false };
  return {
    set: true,
    setBy: { id: row.set_by, name: row.display_name ?? row.email ?? null },
    setAt: row.set_at,
  };
}

/**
 * The latest sealed value, for the service to hand the connector with a request, and for nothing
 * else: no route answers it, and the service cannot open it.
 */
export async function sealedCredentialOf(
  trx: TenantTransaction,
  id: string,
): Promise<string | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('connection_credential')
    .select('sealed')
    .where('connection_id', '=', id)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.sealed;
}

/** A finding a test may record (D1-M). */
export type ConnectionFinding = 'account_not_read_only';

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

/** Records a test the connector answered, against the connection version it tested (D1-N). */
export async function recordConnectionTest(
  trx: TenantTransaction,
  input: {
    readonly connectionId: string;
    readonly versionId: string;
    readonly by: string;
  } & ConnectionTestRecord,
): Promise<void> {
  await trx
    .insertInto('connection_test')
    .values({
      connection_id: input.connectionId,
      connection_version_id: input.versionId,
      outcome: input.outcome,
      findings: [...input.findings],
      failure: input.failure,
      tested_by: input.by,
    })
    .execute();
}

export type LatestConnectionTest = ConnectionTestRecord & {
  readonly at: Date;
  readonly by: Named;
  /** The connection version it tested. */
  readonly version: string;
};

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
    .where('t.connection_id', '=', id)
    .orderBy('t.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  const heading = {
    at: row.tested_at,
    by: { id: row.tested_by, name: row.display_name ?? row.email ?? null },
    version: row.connection_version_id,
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
  readonly lastTest: { readonly outcome: 'ok' | 'failed'; readonly at: Date } | null;
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
      .select(['latest.type', 'latest.retired'])
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
          .select('connection_id')
          .distinct()
          .where('connection_id', 'in', ids)
          .execute();
  const tests =
    ids.length === 0
      ? []
      : await trx
          .selectFrom('connection_test')
          .select(['connection_id', 'outcome', 'tested_at'])
          .distinctOn('connection_id')
          .where('connection_id', 'in', ids)
          .orderBy('connection_id')
          .orderBy('id', 'desc')
          .execute();
  const set = new Set(credentials.map((row) => row.connection_id));
  const lastTests = new Map(
    tests.map((row) => [row.connection_id, { outcome: row.outcome, at: row.tested_at }]),
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
      credentialSet: set.has(row.id),
      lastTest: lastTests.get(row.id) ?? null,
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: { spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name') },
  };
}
