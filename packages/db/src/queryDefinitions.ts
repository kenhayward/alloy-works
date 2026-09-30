import {
  DefinitionRefused,
  parseQueryDefinition,
  parseQueryDefinitionForWrite,
  type DefinitionProblem,
  type QueryDefinition,
  type TenantLimits,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { latestDefinitionsNaming } from './definition-references.js';
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

/**
 * Query definitions (data.md, "The query definition"; the D2 plan, task 2): an authored artifact in
 * one space, naming exactly one connection, every change a version on the chain every artifact uses.
 * Who may make or change one is the route's to decide; what one may hold, and what it may name, is
 * checked here and on every path a version is written by.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A query definition at its latest version, with the connection it names as that stands now. */
export interface StoredQueryDefinition {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly definition: QueryDefinition;
  /** The connection it names, at its latest version; null where that is no connection any more. */
  readonly connection: {
    readonly id: string;
    readonly name: string;
    readonly retired: boolean;
  } | null;
}

export type QueryDefinitionAnswer =
  | {
      readonly answer: 'created' | 'recorded' | 'version.unchanged';
      readonly definition: StoredQueryDefinition;
    }
  /** The latest version is not the one the caller opened from: the definition as it now stands. */
  | { readonly answer: 'version.precondition'; readonly current: StoredQueryDefinition }
  /** A definition that does not pass, each problem named; nothing is written. */
  | { readonly answer: 'definition.refused'; readonly problems: readonly DefinitionProblem[] }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'definition.missing' };

async function stored(
  trx: TenantTransaction,
  version: StoredVersion,
): Promise<StoredQueryDefinition> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  // Read by the shape alone: a check widened later never makes a stored version unreadable.
  const definition = parseQueryDefinition(version.content);
  const named = await latestVersion(trx, definition.connection);
  const content = named?.content as { readonly name?: unknown; readonly retired?: unknown };
  return {
    id: version.artifactId,
    space,
    version,
    definition,
    connection:
      named?.kind === 'connection' &&
      typeof content.name === 'string' &&
      typeof content.retired === 'boolean'
        ? { id: definition.connection, name: content.name, retired: content.retired }
        : null,
  };
}

/** A query definition at its latest version, or undefined where this tenant holds none by that id. */
export async function readQueryDefinition(
  trx: TenantTransaction,
  id: string,
): Promise<StoredQueryDefinition | undefined> {
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'queryDefinition') return undefined;
  return stored(trx, version);
}

/** A write's refusal as an answer, or the error it was. */
function refusal(error: unknown): QueryDefinitionAnswer {
  if (error instanceof DefinitionRefused) {
    return { answer: 'definition.refused', problems: error.problems };
  }
  throw error;
}

/** A definition as a write takes it, or the problems it is refused with. */
function forWrite(
  value: unknown,
): { readonly definition: QueryDefinition } | { readonly problems: readonly DefinitionProblem[] } {
  try {
    return { definition: parseQueryDefinitionForWrite(value) };
  } catch (error) {
    if (error instanceof DefinitionRefused) return { problems: error.problems };
    throw error;
  }
}

/**
 * Makes a query definition at 0.1 in a space (DAT-009), from a definition that passes the shape and
 * every check, naming a connection of the tenant in service - which `createArtifact` itself checks.
 */
export async function createQueryDefinition(
  trx: TenantTransaction,
  input: { readonly author: string; readonly spaceId: string; readonly definition: unknown },
): Promise<QueryDefinitionAnswer> {
  const parsed = forWrite(input.definition);
  if ('problems' in parsed) return { answer: 'definition.refused', problems: parsed.problems };
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  try {
    const version = await createArtifact(trx, {
      spaceId: input.spaceId,
      author: input.author,
      substance: { kind: 'queryDefinition', content: parsed.definition },
    });
    return { answer: 'created', definition: await stored(trx, version) };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * Cuts a definition's next version from the one its author opened (VER-057): whole, passing as a new
 * one must, and naming a connection in service. Retiring and reinstating are versions like any other.
 */
export async function recordQueryDefinitionVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly definition: unknown;
  },
): Promise<QueryDefinitionAnswer> {
  const current = await readQueryDefinition(trx, input.id);
  if (!current) return { answer: 'definition.missing' };
  const parsed = forWrite(input.definition);
  if ('problems' in parsed) return { answer: 'definition.refused', problems: parsed.problems };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'queryDefinition', content: parsed.definition },
    });
  } catch (error) {
    return refusal(error);
  }
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', definition: await stored(trx, answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', definition: await stored(trx, answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: await stored(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'definition.missing' };
  }
}

/** One query definition as a listing shows it. */
export interface QueryDefinitionSummary {
  readonly id: string;
  readonly title: string;
  readonly retired: boolean;
  readonly space: { readonly id: string; readonly name: string };
  /** The connection it names, by its latest name; null where that is no connection any more. */
  readonly connection: { readonly id: string; readonly name: string } | null;
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  /** When its latest version was made. */
  readonly changedAt: Date;
}

/**
 * The query definitions a principal may read, a page at a time by keyset over the sort asked for and
 * then the id, as of the snapshot the walk's first page took, filtered by the readable set inside the
 * query - as `listReadableConnections` pages - and by space and connection where asked. Undefined when
 * the tenant holds no such principal.
 */
export async function listReadableQueryDefinitions(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'queryDefinitions'>> = { limit: 100 },
  filter: { readonly spaces?: readonly string[]; readonly connection?: string } = {},
): Promise<
  | (Listed<QueryDefinitionSummary> & {
      readonly total: number;
      readonly facets: { readonly spaces: readonly FacetCount[] };
    })
  | undefined
> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'title';
  const { types, order: byDefault } = listingSorts.queryDefinitions[sort];
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
              sql<string>`v.content ->> 'title'`.as('title'),
              sql<string>`v.content ->> 'connection'`.as('connection'),
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
      .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
      .select(['latest.connection', 'latest.retired'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(sortColumns([sort === 'title' ? sql`latest.title` : sql`latest.created_at`]))
      .where('a.kind', '=', 'queryDefinition')
      .where((eb) => readableArtifacts(eb, readable))
      .$if(filter.connection !== undefined, (query) =>
        query.where(sql<boolean>`latest.connection = ${filter.connection!}`),
      )
      .$if(filter.spaces !== undefined && leaving !== 'spaces', (query) =>
        filter.spaces!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('a.space_id', 'in', [...filter.spaces!]),
      );
  const { rows, next } = await keysetPage<{
    id: string;
    title: string;
    connection: string;
    retired: boolean;
    space_id: string;
    space_name: string;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after);
  // Each connection's latest name, read for the page's rows alone.
  const connectionIds = [...new Set(rows.map((row) => row.connection))].filter((id) =>
    UUID.test(id),
  );
  const names =
    connectionIds.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .select(['artifact_id', sql<string>`content ->> 'name'`.as('name')])
          .distinctOn('artifact_id')
          .where('artifact_id', 'in', connectionIds)
          .where('kind', '=', 'connection')
          .orderBy('artifact_id')
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .execute();
  const named = new Map(names.map((row) => [row.artifact_id, row.name]));
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      retired: row.retired,
      space: { id: row.space_id, name: row.space_name },
      connection: named.has(row.connection)
        ? { id: row.connection, name: named.get(row.connection)! }
        : null,
      version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
      changedAt: new Date(row.created_at),
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: { spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name') },
  };
}

/** The definitions naming a connection: those a principal may read, and how many more there are. */
export interface NamingDefinitions {
  readonly readable: readonly {
    readonly id: string;
    readonly title: string;
    readonly retired: boolean;
  }[];
  readonly others: number;
}

/**
 * The query definitions whose latest version names a connection (D2-O; DAT-064's where-used, for a
 * connection): those the principal may read by title, and the rest counted, never named. With
 * `inService`, only those not retired, as a refusal to retire the connection counts them (DAT-065).
 */
export async function definitionsNaming(
  trx: TenantTransaction,
  principalId: string,
  connectionId: string,
  options: { readonly inService?: boolean } = {},
): Promise<NamingDefinitions> {
  const naming = (await latestDefinitionsNaming(trx, connectionId)).filter(
    (each) => !options.inService || !each.retired,
  );
  const readable = await loadReadableSet(trx, principalId);
  const mayRead = (each: { readonly id: string; readonly spaceId: string }) =>
    readable !== undefined &&
    (readable.included.includes(each.id) ||
      (readable.spaces.includes(each.spaceId) && !readable.excluded.includes(each.id)));
  const shown = naming.filter(mayRead);
  return {
    readable: shown.map(({ id, title, retired }) => ({ id, title, retired })),
    others: naming.length - shown.length,
  };
}

/** The tenant's lowered limits (D2-N): each null where the tenant has not lowered it. */
export async function dataPolicy(trx: TenantTransaction): Promise<Required<TenantLimits>> {
  const row = await trx
    .selectFrom('data_policy')
    .select(['rows', 'bytes', 'seconds'])
    .executeTakeFirstOrThrow();
  return { rows: row.rows, bytes: row.bytes, seconds: row.seconds };
}

/** Sets the tenant's lowered limits, each null to lower none; the table holds each to its ceiling. */
export async function setDataPolicy(
  trx: TenantTransaction,
  limits: {
    readonly rows: number | null;
    readonly bytes: number | null;
    readonly seconds: number | null;
  },
): Promise<void> {
  await trx
    .updateTable('data_policy')
    .set({ rows: limits.rows, bytes: limits.bytes, seconds: limits.seconds })
    .execute();
}
