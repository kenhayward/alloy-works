import {
  assetRightsSchema,
  parseAssetVersion,
  type AssetAlternative,
  type AssetFormat,
  type AssetRights,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { notArchivedAs } from './archival.js';
import { notDeletedAs } from './deletion.js';
import {
  checkedLimit,
  countOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';

/** An image as a library lists it (the AL plan, AL-J): its latest version, and its rights now. */
export interface LibraryAsset {
  readonly id: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly name: string | null;
  readonly alternative: AssetAlternative | null;
  readonly format: AssetFormat;
  readonly width: number;
  readonly height: number;
  readonly rights: AssetRights;
  /** The licence its rights declare, by its name now; null where none is declared. */
  readonly licence: { readonly id: string; readonly name: string } | null;
  /** Whether its grant's last day has passed. */
  readonly expired: boolean;
  /** Whether a component, a baseline or a publication holds it (AST-018, AST-050). */
  readonly used: boolean;
  readonly changedAt: Date;
}

export interface LibraryFilter {
  /** Words found in its name, description, format, licence or source, case aside. */
  readonly q?: string | undefined;
  readonly format?: AssetFormat | undefined;
  readonly licence?: string | undefined;
  readonly rights?: 'undeclared' | 'expired' | undefined;
  readonly orientation?: 'landscape' | 'portrait' | 'square' | undefined;
  readonly unused?: boolean | undefined;
  /** The SHA-256 of its bytes, hex: an upload's duplicate (AST-029). */
  readonly sha256?: string | undefined;
  /** The day an expiry is judged on, `YYYY-MM-DD`; today, in UTC, when absent. */
  readonly today?: string | undefined;
}

/** A pattern's own characters, escaped, so a search finds only what was typed. */
const literal = (words: string) => `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * **A space's images** (AST-028; the AL plan, AL-J), those a principal may read, a page at a time by
 * keyset over the sort asked for and then the id, as of the walk's first page: each at its latest
 * version with its rights now. A dataset's images are left out, being the environment's own data
 * (pre-flight 10), as are deleted and archived ones. Undefined when the tenant holds no such principal.
 */
export async function listAssets(
  trx: TenantTransaction,
  principalId: string,
  spaceId: string,
  request: ListingRequest<SortOf<'assets'>> = { limit: 100 },
  filter: LibraryFilter = {},
): Promise<(Listed<LibraryAsset> & { readonly total: number }) | undefined> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'name';
  const { types, order: byDefault } = listingSorts.assets[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const today = filter.today ?? new Date().toISOString().slice(0, 10);
  const name = sql<string>`coalesce(latest.content ->> 'name', '')`;
  const used = sql<boolean>`(exists (select from reference r where r.to_id = a.id)
    or exists (select from baseline_pin p where p.artifact_id = a.id)
    or exists (select from publication_asset u where u.asset_id = a.id))`;
  const expired = sql<boolean>`coalesce(rights.rights ->> 'expires' < ${today}, false)`;
  const base = () => {
    let query = trx
      .selectFrom('artifact as a')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select(['v.id as version_id', 'v.revision_no', 'v.version_no', 'v.created_at'])
            .select('v.content')
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('asset_rights as r')
            .select('r.rights')
            .whereRef('r.asset_id', '=', 'a.id')
            .orderBy('r.recorded_at', 'desc')
            .orderBy('r.id', 'desc')
            .limit(1)
            .as('rights'),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as l')
            .select(sql<string>`l.content ->> 'name'`.as('name'))
            .where(sql<boolean>`l.artifact_id::text = rights.rights ->> 'licence'`)
            .orderBy('l.revision_no', 'desc')
            .orderBy('l.version_no', 'desc')
            .limit(1)
            .as('licence'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 'latest.content', 'rights.rights', 'licence.name as licence_name'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(used.as('used'))
      .select(expired.as('expired'))
      .select(sortColumns([sort === 'name' ? sql`lower(${name})` : sql`latest.created_at`]))
      .where('a.kind', '=', 'asset')
      .where('a.space_id', '=', spaceId)
      .where((eb) => readableArtifacts(eb, readable))
      .where(notDeletedAs('a'))
      .where(notArchivedAs('a', snapshot))
      .where(
        sql<boolean>`not exists (select from asset_upload u
                                  where u.asset_id = a.id and u.origin = 'dataset')`,
      );
    if (filter.format)
      query = query.where(sql<boolean>`latest.content ->> 'format' = ${filter.format}`);
    if (filter.licence) {
      query = query.where(sql<boolean>`rights.rights ->> 'licence' = ${filter.licence}`);
    }
    if (filter.rights === 'undeclared') {
      query = query.where(
        sql<boolean>`coalesce(rights.rights ->> 'kind', 'undeclared') = 'undeclared'`,
      );
    }
    if (filter.rights === 'expired') query = query.where(expired);
    if (filter.orientation) {
      const width = sql`(latest.content ->> 'width')::int`;
      const height = sql`(latest.content ->> 'height')::int`;
      query = query.where(
        filter.orientation === 'landscape'
          ? sql<boolean>`${width} > ${height}`
          : filter.orientation === 'portrait'
            ? sql<boolean>`${width} < ${height}`
            : sql<boolean>`${width} = ${height}`,
      );
    }
    if (filter.unused) query = query.where(sql<boolean>`not ${used}`);
    if (filter.sha256) {
      query = query.where(
        sql<boolean>`latest.content ->> 'object' like ${`%/sha256/${filter.sha256}`}`,
      );
    }
    if (filter.q !== undefined && filter.q.trim() !== '') {
      const pattern = literal(filter.q.trim());
      query = query.where(
        sql<boolean>`(latest.content ->> 'name' ilike ${pattern}
          or latest.content -> 'alternative' ->> 'text' ilike ${pattern}
          or latest.content ->> 'format' ilike ${pattern}
          or licence.name ilike ${pattern}
          or rights.rights -> 'source' ->> 'text' ilike ${pattern})`,
      );
    }
    return query;
  };
  const { rows, next } = await keysetPage<{
    id: string;
    content: unknown;
    rights: unknown;
    licence_name: string | null;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
    used: boolean;
    expired: boolean;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after, request.language);
  return {
    items: rows.map((row) => {
      const content = parseAssetVersion(row.content);
      const rights = assetRightsSchema.parse(row.rights ?? { kind: 'undeclared' });
      return {
        id: row.id,
        version: { id: row.version_id, number: `${row.revision_no}.${row.version_no}` },
        name: content.name ?? null,
        alternative: content.alternative,
        format: content.format,
        width: content.width,
        height: content.height,
        rights,
        licence:
          rights.kind === 'declared' && row.licence_name !== null
            ? { id: rights.licence, name: row.licence_name }
            : null,
        expired: row.expired,
        used: row.used,
        changedAt: new Date(row.created_at),
      };
    }),
    next,
    snapshot,
    total: await countOf(trx, base()),
  };
}
