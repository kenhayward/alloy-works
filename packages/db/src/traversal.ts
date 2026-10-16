import type { ReadableSet } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { deletedAmong } from './deletion.js';
import { IMPACT_LIMIT, IMPACT_MAX_DEPTH, titlesOf as titles } from './impact.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { StoredRelationship } from './relationships.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An artifact a traversal names: its identifier, kind and title or name now. */
export interface Named {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
}

/** One relationship of an artifact, read from its end: which way, and the artifact at the other. */
export interface Neighbour {
  readonly relationship: StoredRelationship;
  /** `out` where the artifact is its from end, `in` where its to end. */
  readonly direction: 'out' | 'in';
  readonly other: Named;
}

interface Row {
  id: string;
  type_id: string;
  from_id: string;
  from_kind: string;
  from_version: string | null;
  to_id: string;
  to_kind: string;
  to_version: string | null;
  field_values: unknown;
  created_by: string;
  created_at: Date;
  changed_at: Date;
  other_id: string;
  other_kind: string;
  other_space: string | null;
  direction: 'out' | 'in';
}

const readableBy = (readable: ReadableSet | undefined, id: string, space: string | null) =>
  readable !== undefined && space !== null && mayReadArtifact(readable, { id, spaceId: space });

/**
 * **Neighbours** (REL-015, REL-051; the R8 plan, R8-F): an artifact's relationships, one hop, by type,
 * by direction and by a field's value, nearest-first by nothing but stable order, at most 1,000. The
 * artifact at the other end of each is one `by` may read: one they may not, or one deleted, is left
 * out, and `cut` says there were (REL-019, REL-020). The caller has decided `by` may read `id`.
 */
export async function neighbours(
  trx: TenantTransaction,
  by: string,
  id: string,
  filter: {
    readonly type?: string;
    readonly direction?: 'out' | 'in';
    readonly field?: { readonly id: string; readonly value: unknown };
  } = {},
): Promise<{
  readonly items: readonly Neighbour[];
  readonly cut: boolean;
  readonly more: boolean;
}> {
  if (!UUID.test(id)) return { items: [], cut: false, more: false };
  const type = filter.type !== undefined && UUID.test(filter.type) ? filter.type : null;
  if (filter.type !== undefined && type === null) return { items: [], cut: false, more: false };
  const values = filter.field ? JSON.stringify({ [filter.field.id]: filter.field.value }) : null;
  const { rows } = await sql<Row>`
    select r.*, case when r.from_id = ${id} then r.to_id else r.from_id end as other_id,
           a.kind as other_kind, a.space_id as other_space,
           case when r.from_id = ${id} then 'out' else 'in' end as direction
      from relationship r
      join artifact a on a.id = case when r.from_id = ${id} then r.to_id else r.from_id end
     where (r.from_id = ${id} or r.to_id = ${id})
       and (${type}::uuid is null or r.type_id = ${type}::uuid)
       and (${filter.direction ?? null}::text is null
            or (${filter.direction ?? null} = 'out' and r.from_id = ${id})
            or (${filter.direction ?? null} = 'in' and r.to_id = ${id}))
       and (${values}::jsonb is null or r.field_values @> ${values}::jsonb)
     order by r.created_at, r.id
     limit ${IMPACT_LIMIT + 1}`.execute(trx);
  const readable = await loadReadableSet(trx, by);
  const deleted = await deletedAmong(
    trx,
    rows.map((row) => row.other_id),
  );
  const shown = rows.filter(
    (row) => !deleted.has(row.other_id) && readableBy(readable, row.other_id, row.other_space),
  );
  const kept = shown.slice(0, IMPACT_LIMIT);
  const named = await titles(
    trx,
    kept.map((row) => row.other_id),
  );
  return {
    items: kept.map((row) => ({
      relationship: {
        id: row.id,
        type: row.type_id,
        from: { artifact: row.from_id, kind: row.from_kind, version: row.from_version },
        to: { artifact: row.to_id, kind: row.to_kind, version: row.to_version },
        values: row.field_values as Record<string, unknown>,
        createdBy: row.created_by,
        createdAt: row.created_at,
        changedAt: row.changed_at,
      },
      direction: row.direction,
      other: { id: row.other_id, kind: row.other_kind, title: named.get(row.other_id) ?? '' },
    })),
    cut: rows.some(
      (row) => !deleted.has(row.other_id) && !readableBy(readable, row.other_id, row.other_space),
    ),
    more: shown.length > IMPACT_LIMIT,
  };
}

/** One step along a path: the artifact reached, and the edge that reached it. */
export interface PathStep extends Named {
  /** The relationship it was reached by, or null where a reference reached it. */
  readonly relationship: string | null;
}

/** The artifacts one hop from each of these, along relationships (of `types`, if named) and references. */
async function adjacent(
  trx: TenantTransaction,
  ids: readonly string[],
  types: readonly string[] | null,
): Promise<{ from: string; to: string; via: string | null; kind: string; space: string | null }[]> {
  const { rows } = await sql<{
    from: string;
    to: string;
    via: string | null;
    kind: string;
    space: string | null;
  }>`
    with edge as (
      select r.from_id as a, r.to_id as b, r.id::text as via from relationship r
       where (r.from_id = any(${[...ids]}::uuid[]) or r.to_id = any(${[...ids]}::uuid[]))
         and (${types === null}::boolean or r.type_id = any(${types ?? []}::uuid[]))
      union all
      select x.from_id, x.to_id, null from reference x
       where ${types === null}::boolean
         and (x.from_id = any(${[...ids]}::uuid[]) or x.to_id = any(${[...ids]}::uuid[]))
    ), stepped as (
      select a as "from", b as "to", via from edge where a = any(${[...ids]}::uuid[])
      union all
      select b, a, via from edge where b = any(${[...ids]}::uuid[])
    )
    select s."from", s."to", s.via, t.kind, t.space_id as space
      from stepped s join artifact t on t.id = s."to"
     order by s."from", s."to", s.via nulls first`.execute(trx);
  return rows;
}

/**
 * **A shortest path** (REL-029; R8-F): one shortest chain of relationships and references between two
 * artifacts, in either direction along each, no longer than `depth`, along named relationship types
 * alone where `types` names any (and then no reference). Searched from both ends at once, the smaller
 * side grown first; an artifact `by` may not read, or one deleted, is never stepped onto, and `cut`
 * says one was met (REL-019, REL-020). The caller has decided `by` may read both ends.
 */
export async function shortestPath(
  trx: TenantTransaction,
  by: string,
  from: string,
  to: string,
  depth: number,
  types: readonly string[] | null = null,
): Promise<{ readonly path: readonly PathStep[] | null; readonly cut: boolean }> {
  if (!Number.isInteger(depth) || depth < 1 || depth > IMPACT_MAX_DEPTH) {
    throw new Error(`A path declares a depth from 1 to ${IMPACT_MAX_DEPTH}, not ${depth}`);
  }
  if (!UUID.test(from) || !UUID.test(to) || (types ?? []).some((each) => !UUID.test(each))) {
    return { path: null, cut: false };
  }
  const readable = await loadReadableSet(trx, by);
  // Each side: every artifact it has reached, and the artifact and edge it was reached from.
  type Side = Map<string, { parent: string | null; via: string | null }>;
  const sides: [Side, Side] = [
    new Map([[from, { parent: null, via: null }]]),
    new Map([[to, { parent: null, via: null }]]),
  ];
  const frontiers: [string[], string[]] = [[from], [to]];
  let cut = false;
  let meet: string | null = from === to ? from : null;
  for (let hops = 0; hops < depth && meet === null; hops += 1) {
    const grow = frontiers[0].length <= frontiers[1].length ? 0 : 1;
    if (frontiers[grow].length === 0) break;
    const edges = await adjacent(trx, frontiers[grow], types);
    const deleted = await deletedAmong(
      trx,
      edges.map((edge) => edge.to),
    );
    const next: string[] = [];
    for (const edge of edges) {
      if (sides[grow].has(edge.to)) continue;
      if (deleted.has(edge.to)) continue;
      if (!readableBy(readable, edge.to, edge.space)) {
        cut = true;
        continue;
      }
      sides[grow].set(edge.to, { parent: edge.from, via: edge.via });
      next.push(edge.to);
      if (sides[1 - grow]!.has(edge.to)) {
        meet = edge.to;
        break;
      }
    }
    frontiers[grow] = next;
  }
  if (meet === null) return { path: null, cut };
  // Back from the meeting artifact to each end, the second side's links read the other way.
  const head: { id: string; via: string | null }[] = [];
  for (let at: string | null = meet; at !== null; at = sides[0].get(at)!.parent) {
    head.unshift({ id: at, via: sides[0].get(at)!.via });
  }
  const tail: { id: string; via: string | null }[] = [];
  let via = sides[1].get(meet)!.via;
  for (let at = sides[1].get(meet)!.parent; at !== null; at = sides[1].get(at)!.parent) {
    tail.push({ id: at, via });
    via = sides[1].get(at)!.via;
  }
  const steps = [...head, ...tail];
  const kinds = new Map(
    (
      await trx
        .selectFrom('artifact')
        .select(['id', 'kind'])
        .where(
          'id',
          'in',
          steps.map((each) => each.id),
        )
        .execute()
    ).map((row) => [row.id, row.kind]),
  );
  const named = await titles(
    trx,
    steps.map((each) => each.id),
  );
  return {
    path: steps.map((each, at) => ({
      id: each.id,
      kind: kinds.get(each.id) ?? '',
      title: named.get(each.id) ?? '',
      relationship: at === 0 ? null : each.via,
    })),
    cut,
  };
}
